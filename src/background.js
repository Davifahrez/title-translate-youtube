importScripts('database.js', 'sql-wasm.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
        handleRequest(request.text, 'translate', 'translation', sendResponse);
    } else if (request.action === 'explain') {
        handleRequest(request.text, 'explain', 'explanation', sendResponse);
    }
    return true; // Indicates that the response is sent asynchronously
});

async function handleRequest(text, type, responseKey, sendResponse) {
    try {
        let result = await getCachedResult(text, type);
        if (result) {
            sendResponse({ [responseKey]: result });
            return;
        }

        result = await callGemini(text, type);
        await setCachedResult(text, type, result);
        sendResponse({ [responseKey]: result });

    } catch (error) {
        sendResponse({ error: error.message });
    }
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
        // Strict prompt for a direct, single translation
        prompt = `Provide a direct, literal English translation of the following text. Do not provide explanations, alternatives, or any text other than the translation itself. Text: "${text}"`;
    } else {
        prompt = `Provide a detailed grammatical breakdown and explanation of the following text, suitable for a language learner. Explain the meaning of the words and the overall sentence structure. Text: "${text}"`;
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
