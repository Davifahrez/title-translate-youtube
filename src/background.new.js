// This is the version of background.new.js that was working without caching.
// It includes the fix for translateSingle and simplified prompts.

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const RATE_LIMIT_WINDOW = 60 * 1000; // 60 seconds in milliseconds

const GEMINI_MODEL_RATE_LIMITS = {
    "gemini-2.5-pro": 5,
    "gemini-2.5-flash": 10,
    "gemini-2.5-flash-lite": 15,
    "gemini-2.0-flash": 15,
    "gemini-2.0-flash-lite": 30,
    "gemini-2.5-flash-live": 3,
    "gemini-2.5-flash-preview-native-audio-dialog": 1,
    "gemini-2.5-flash-experimental-native-audio-thinking-dialog": 1,
    "gemini-2.0-flash-live": 3,
    "gemini-2.5-flash-preview-tts": 3,
    "gemini-2.0-flash-preview-image-generation": 10,
    "gemma-3-3n": 30, // Added Gemma model
    "gemini-embedding": 100,
    "gemini-1.5-flash": 15,
    "gemini-1.5-flash-8b": 15
};

// Helper to get the effective max requests based on the selected model
async function getEffectiveMaxRequests() {
    const { geminiModel } = await chrome.storage.local.get('geminiModel');
    const model = geminiModel || 'gemini-1.5-flash'; // Default to gemini-1.5-flash if not set
    return GEMINI_MODEL_RATE_LIMITS[model] || 10; // Default to 10 if model not found in map
}

async function checkAndRecordRequest(numRequests = 1) {
    const { requestTimestamps } = await chrome.storage.local.get('requestTimestamps');
    let timestamps = Array.isArray(requestTimestamps) ? requestTimestamps : [];

    const now = Date.now();
    // Filter out timestamps older than the window
    timestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);

    const maxRequestsForModel = await getEffectiveMaxRequests();

    // Calculate how many requests we can still make
    const availableRequests = maxRequestsForModel - timestamps.length;

    // If we don't have enough available requests for the current batch
    if (numRequests > availableRequests) {
        // Calculate the time to wait until enough requests "expire" from the window
        // We need to wait until (numRequests - availableRequests) oldest requests fall out of the window
        const requestsToWaitOn = numRequests - availableRequests;
        if (timestamps.length >= requestsToWaitOn) {
            const timeToWait = (timestamps[requestsToWaitOn - 1] + RATE_LIMIT_WINDOW) - now;
            if (timeToWait > 0) {
                console.warn(`Rate limit approaching. Waiting for ${timeToWait}ms before making requests.`);
                await new Promise(resolve => setTimeout(resolve, timeToWait));
                // After waiting, re-filter timestamps as time has passed
                timestamps = timestamps.filter(ts => Date.now() - ts < RATE_LIMIT_WINDOW);
            }
        } else {
            // This case should ideally not be hit if logic is sound, but as a fallback
            // if somehow numRequests is greater than maxRequestsForModel and timestamps are few
            const timeToWait = RATE_LIMIT_WINDOW; // Wait for a full window
            console.warn(`Rate limit exceeded. Waiting for ${timeToWait}ms before making requests.`);
            await new Promise(resolve => setTimeout(resolve, timeToWait));
            timestamps = timestamps.filter(ts => Date.now() - ts < RATE_LIMIT_WINDOW);
        }
    }

    // Record the new requests
    for (let i = 0; i < numRequests; i++) {
        timestamps.push(Date.now());
    }
    await chrome.storage.local.set({ requestTimestamps: timestamps });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translateBatch') {
        handleBatchRequest(request.texts)
            .then(translations => sendResponse({ translations }))
            .catch(error => sendResponse({ error: error.message }));
    } else if (request.action === 'translateSingle') {
        handleSingleRequest(request.text)
            .then(translation => sendResponse({ translation }))
            .catch(error => sendResponse({ error: error.message }));
    } else if (request.action === 'explain') {
        handleExplainRequest(request.text)
            .then(explanation => sendResponse({ explanation }))
            .catch(error => sendResponse({ error: error.message }));
    }
    return true; // Indicates that the response is sent asynchronously
});

async function handleExplainRequest(text) {
    try {
        await checkAndRecordRequest();
        let result = await callGemini(text, 'explain');
        return result;
    } catch (error) {
        throw error;
    }
}

async function handleSingleRequest(text) {
    const cachedData = await getCachedTranslation(text);
    if (cachedData) {
        return cachedData;
    }

    try {
        await checkAndRecordRequest();
        let result = await callGemini(text, 'translate');
        await setCachedTranslation(text, result); // Only cache if successful
        return result;
    } catch (error) {
        // Do NOT cache the error message
        throw error; // Re-throw the error so it's handled by the onMessage listener
    }
}

async function handleBatchRequest(texts) {
    const translations = {};
    const textsToTranslate = [];

    for (const text of texts) {
        const cachedData = await getCachedTranslation(text);
        if (cachedData) {
            translations[text] = cachedData;
        } else {
            textsToTranslate.push(text);
        }
    }

    if (textsToTranslate.length > 0) {
        await checkAndRecordRequest(textsToTranslate.length);
        const newTranslations = await callGeminiBatch(textsToTranslate);
        for (const text of textsToTranslate) {
            const translation = newTranslations[text];
            translations[text] = translation;
            await setCachedTranslation(text, translation);
        }
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
        return cached.translation;
    }
    return null;
}

async function setCachedTranslation(text, translation) {
    const key = `cache_${utf8ToBase64(text)}`;
    const value = { translation, timestamp: Date.now() };
    await chrome.storage.local.set({ [key]: value });
}



async function callGemini(text, type) {
    const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);

    if (!geminiApiKey) {
        throw new Error('API key not set. Please set it in the extension popup.');
    }

    const model = geminiModel || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

    let prompt;
    if (type === 'translate') {
        // Strict prompt for a direct, literal English translation
        prompt = `Provide a direct, literal English translation of the following text. Do not provide explanations, alternatives, or any text other than the translation itself. Text: "${text}"`;
    } else if (type === 'explain') {
        // Prompt for grammatical breakdown and explanation for language learners (concise version)
        prompt = `Explain the grammar and meaning of the following text for a language learner in a brief paragraph. Avoid detailed breakdowns or lists. Text: "${text}"`;
    } else {
        // Default or fallback prompt if type is not recognized
        prompt = `Process the following text: "${text}"`;
    }

    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: type === 'translate' ? 0 : 0.5,
            maxOutputTokens: 1000
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            const errorDetails = data.error ? data.error.message : 'Unknown API error.';
            console.error('API Error Response:', data);
            throw new Error(`API Error: ${errorDetails}`);
        }

        if (data && data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];
                if (part.text) {
                    return part.text.trim();
                }
            }
        }

        console.error('Invalid API response structure:', data);
        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new Error(`Request blocked by API: ${data.promptFeedback.blockReason}`);
        }

        throw new Error('Invalid response from API. No translation found.');

    } catch (error) {
        console.error('Translation failed:', error);
        throw error;
    }
}

async function callGeminiBatch(texts) {
    const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);

    if (!geminiApiKey) {
        throw new Error('API key not set. Please set it in the extension popup.');
    }

    const model = geminiModel || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

    const prompt = `Provide a direct, literal English translation for the following text. Do not include the original text or any other explanations.\n\n${texts.join('\n')}`;

    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 1000
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            const errorDetails = data.error ? data.error.message : 'Unknown API error.';
            console.error('API Error Response:', data);
            throw new Error(`API Error: ${errorDetails}`);
        }

        if (data && data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];
                if (part.text) {
                    const translatedTexts = part.text.trim().split('\n');
                    const translations = {};
                    texts.forEach((text, index) => {
                        const translation = translatedTexts[index] ? translatedTexts[index].replace(/^\d+\.\s*/, '') : text;
                        translations[text] = translation;
                    });
                    return translations;
                }
            }
        }

        console.error('Invalid API response structure:', data);
        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new Error(`Request blocked by API: ${data.promptFeedback.blockReason}`);
        }

        throw new Error('Invalid response from API. No translations found.');

    } catch (error) {
        console.error('Translation failed:', error);
        throw error;
    }
}