importScripts('../ai/gemini.js');

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[YT-TL DEBUG] Received action: ${request.action}`, { request });

    const actionHandler = async () => {
        // This check is crucial. If gemini.js failed to load, this will provide a clear error.
        if (typeof geminiProvider === 'undefined' || !geminiProvider.KNOWN_MODELS_INFO) {
            throw new Error("The AI provider script (gemini.js) failed to load or initialize correctly. The extension cannot function.");
        }

        switch (request.action) {
            case 'translateBatch':
                return { translations: await handleBatchRequest(request.texts) };
            case 'translateSingle':
                return await handleSingleRequest(request.text);
            case 'explain':
                return await handleExplainRequest(request.text, request.force);
            case 'validateModels':
                return await handleValidateModels(request.apiKey);
            case 'getKnownModels':
                return {
                    models: geminiProvider.KNOWN_MODELS_INFO,
                    defaultChain: geminiProvider.DEFAULT_FALLBACK_CHAIN
                };
            case 'clearCooldowns':
                return await handleClearCooldowns();
            default:
                throw new Error(`Unknown action received: ${request.action}`);
        }
    };

    actionHandler()
        .then(responsePayload => {
            console.log(`[YT-TL DEBUG] Sending success response for ${request.action}:`, responsePayload);
            sendResponse(responsePayload);
        })
        .catch(error => {
            console.error(`YT-TL: Final error in action '${request.action}':`, error);
            const userMessage = getFriendlyErrorMessage(error);
            sendResponse({ error: userMessage });
        });

    return true; // Indicates that the response is sent asynchronously
});

function getFriendlyErrorMessage(error) {
    const errorMessage = error.message || '';
    if (errorMessage.includes("exceeded your current quota") || errorMessage.includes("cooldown")) {
        return "Daily API quota exceeded. Please check your AI provider's plan and billing.";
    }
    if (errorMessage.includes("Rate limit on")) {
        const waitMatch = errorMessage.match(/Try again in (\d+)s/);
        return waitMatch ? `Per-minute limit hit. Please wait ${waitMatch[1]}s.` : "Per-minute rate limit hit. Please wait a moment.";
    }
    if (errorMessage.includes("API key")) return "Invalid API key. Please check your settings.";
    if (errorMessage.includes("Network error") || errorMessage.includes("timed out")) return "Network error. Please check your connection and try again.";
    if (errorMessage.includes("[AllModelsFailed]")) return "All models failed (fallback was on). Check API key, network, and quota.";
    if (errorMessage.includes("[SingleModelFailed]")) return "The selected model failed. Check API key/quota or try enabling fallback.";
    if (errorMessage.includes("maximum output length")) return "Model reached its output limit. This is a temporary issue, not a daily quota error.";
    if (errorMessage.includes("blocked")) return "Request was blocked by the API, possibly due to safety settings.";
    if (errorMessage.includes("AI provider script")) return errorMessage; // Pass the specific error through
    return "An unexpected error occurred. Please try again.";
}

async function handleValidateModels(apiKey) {
    if (!apiKey) {
        throw new Error("API key is required for validation.");
    }
    const modelsToTest = Object.keys(geminiProvider.KNOWN_MODELS_INFO);
    const permanentlyInvalidModels = [];
    const testPrompt = "This is a test call to verify API access to this model.";

    // Clear previous permanent invalidations for this new key test
    await chrome.storage.local.remove('permanentlyInvalidModels');

    const results = await Promise.allSettled(
        modelsToTest.map(model => geminiProvider.makeApiCall(apiKey, model, testPrompt))
    );

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const model = modelsToTest[index];
            const errorMessage = result.reason.message;
            console.log(`[YT-TL Validation] Model ${model} failed: ${errorMessage}`);
            // Check for errors that indicate the model is permanently unavailable for this key
            if (errorMessage.includes("permission denied") ||
                errorMessage.includes("API key not valid") ||
                errorMessage.includes("not found for API key") ||
                errorMessage.includes("User location is not supported")) {
                permanentlyInvalidModels.push(model);
            }
            // Note: Quota errors are handled inside makeApiCall (sets temporary cooldown) and are not added here.
        }
    });

    await chrome.storage.local.set({ permanentlyInvalidModels });
    console.log('[YT-TL Validation] Permanently invalid models:', permanentlyInvalidModels);
    return { permanentlyInvalidModels };
}


async function handleExplainRequest(text, force = false) {
    const { explanationCache } = await chrome.storage.local.get({ explanationCache: true });

    if (explanationCache && !force) {
        const cachedResult = await getCachedExplanation(text);
        if (cachedResult) {
            return { explanation: cachedResult.explanation, fromCache: true, modelUsed: cachedResult.modelUsed };
        }
    }

    // Delegate to the provider
    const { explanation, modelUsed } = await geminiProvider.explain(text);

    if (explanationCache) {
        await setCachedExplanation(text, explanation, modelUsed);
    }
    return { explanation, fromCache: false, modelUsed: modelUsed };
}

async function handleSingleRequest(text) {
    const cachedData = await getCachedTranslation(text);
    if (cachedData) {
        return cachedData;
    }

    // Delegate to the provider
    const { translation, modelUsed } = await geminiProvider.translateSingle(text);
    await setCachedTranslation(text, translation, modelUsed);
    return { translation, modelUsed };
}

async function handleBatchRequest(texts) {
    console.log('[YT-TL DEBUG] Starting handleBatchRequest for', texts.length, 'items.');
    const translations = {};
    const textsToTranslate = [];

    for (const text of texts) {
        const cachedData = await getCachedTranslation(text);
        if (cachedData) {
            console.log(`[YT-TL DEBUG] Cache HIT for: "${text}"`);
            translations[text] = cachedData;
        } else {
            console.log(`[YT-TL DEBUG] Cache MISS for: "${text}"`);
            textsToTranslate.push(text);
        }
    }

    if (textsToTranslate.length > 0) {
        console.log('[YT-TL DEBUG] Fetching new translations for', textsToTranslate.length, 'items.');
        // Delegate to the provider, which returns an array of translation objects
        const newTranslationsArray = await geminiProvider.translateBatch(textsToTranslate);

        textsToTranslate.forEach((text, index) => {
            const { translation, modelUsed } = newTranslationsArray[index];
            translations[text] = { translation, modelUsed };
            // Caching is fire-and-forget, no need to await here
            setCachedTranslation(text, translation, modelUsed);
        });
    }
    
    return texts.map(text => translations[text]);
}

function utf8ToBase64(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
}

async function getCachedTranslation(text) {
    const key = `cache_${utf8ToBase64(text)}`; // UTF-8 safe Base64 encode
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        return { translation: cached.translation, modelUsed: cached.modelUsed };
    }
    return null;
}

async function setCachedTranslation(text, translation, modelUsed) {
    const key = `cache_${utf8ToBase64(text)}`;
    const value = { translation, modelUsed, timestamp: Date.now() };
    await chrome.storage.local.set({ [key]: value });
}

async function getCachedExplanation(text) {
    const key = `cache_explain_${utf8ToBase64(text)}`; // Use a different prefix
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        return { explanation: cached.explanation, modelUsed: cached.modelUsed };
    }
    return null;
}

async function setCachedExplanation(text, explanation, modelUsed) {
    const key = `cache_explain_${utf8ToBase64(text)}`;
    const value = { explanation, modelUsed, timestamp: Date.now() };
    await chrome.storage.local.set({ [key]: value });
}

async function handleClearCooldowns() {
    const allStorage = await chrome.storage.local.get(null);
    const keysToRemove = [];
    for (const key in allStorage) {
        if (key.startsWith('dailyLimit_') || key.startsWith('failureCooldown_') || key.startsWith('failureCount_')) {
            keysToRemove.push(key);
        }
    }

    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log('[YT-TL] Cleared cooldowns and failure counts for keys:', keysToRemove);
        const cooldownKeyCount = keysToRemove.filter(k => k.startsWith('dailyLimit_') || k.startsWith('failureCooldown_')).length;
        return { success: true, clearedCount: cooldownKeyCount };
    } else {
        console.log('[YT-TL] No active cooldowns to clear.');
        return { success: true, clearedCount: 0 };
    }
}
