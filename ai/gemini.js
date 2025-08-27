/**
 * @file This file contains the AI provider logic for interacting with the Google Gemini API.
 * It handles API requests, model selection, fallback, and error handling, including
 * the new failure-based cooldown mechanism.
 */

const geminiProvider = {
    // NOTE: These are examples. The Gemini API supports various models.
    // The rate is requests per minute.
    KNOWN_MODELS_INFO: {
        'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', rate: 5 },
        'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', rate: 10 },
        'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash-Lite', rate: 15 },
        'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', rate: 15 },
        'gemini-2.0-flash-lite': { name: 'Gemini 2.0 Flash-Lite', rate: 30 }
    },
    DEFAULT_FALLBACK_CHAIN: [
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro'
    ],
    API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    FAILURE_THRESHOLD: 4, // Number of consecutive failures to trigger a 24h cooldown.

    /**
     * Retrieves all necessary settings from local storage.
     */
    async getSettings() {
        return await chrome.storage.local.get([
            'geminiApiKey',
            'geminiModel',
            'geminiPrompt',
            'explanationPrompt',
            'modelCyclingEnabled',
            'modelFallbackChain',
            'permanentlyInvalidModels'
        ]);
    },

    /**
     * Translates a single piece of text.
     * @param {string} text The text to translate.
     * @returns {Promise<{translation: string, modelUsed: string}>}
     */
    async translateSingle(text) {
        const { geminiPrompt, ...settings } = await this.getSettings();
        const prompt = `${geminiPrompt}\n\n${text}`;
        const result = await this.executeRequest(prompt, settings);
        return { translation: result.responseText, modelUsed: result.modelUsed };
    },

    /**
     * Translates a batch of texts.
     * @param {string[]} texts An array of texts to translate.
     * @returns {Promise<Array<{translation: string, modelUsed: string}>>}
     */
    async translateBatch(texts) {
        const translations = [];
        for (const text of texts) {
            // This will throw if a text cannot be translated after all fallbacks,
            // which is the expected behavior for the background script.
            const result = await this.translateSingle(text);
            translations.push(result);
        }
        return translations;
    },

    /**
     * Generates an explanation for a piece of text.
     * @param {string} text The text to explain.
     * @returns {Promise<{explanation: string, modelUsed: string}>}
     */
    async explain(text) {
        const { explanationPrompt, ...settings } = await this.getSettings();
        const prompt = `${explanationPrompt}\n\n${text}`;
        const result = await this.executeRequest(prompt, settings);
        return { explanation: result.responseText, modelUsed: result.modelUsed };
    },

    /**
     * A generic request executor that handles model selection, fallback, and retries.
     * @param {string} prompt The full prompt to send to the API.
     * @param {object} settings The user's current settings.
     * @returns {Promise<{responseText: string, modelUsed: string}>}
     */
    async executeRequest(prompt, settings) {
        const {
            geminiApiKey,
            geminiModel,
            modelCyclingEnabled,
            modelFallbackChain,
            permanentlyInvalidModels = []
        } = settings;

        if (!geminiApiKey) throw new Error("API key not set.");

        const modelsToTry = modelCyclingEnabled
            ? (modelFallbackChain?.length > 0 ? modelFallbackChain : this.DEFAULT_FALLBACK_CHAIN)
            : [geminiModel];

        const validModelsToTry = modelsToTry.filter(m => !permanentlyInvalidModels.includes(m));

        if (validModelsToTry.length === 0) {
            throw new Error(modelCyclingEnabled ? "[AllModelsFailed] No valid models in fallback chain." : "[SingleModelFailed] Selected model is unavailable.");
        }

        let lastError = null;
        for (const model of validModelsToTry) {
            try {
                const resultData = await this.makeApiCall(geminiApiKey, model, prompt);
                const responseText = resultData.candidates[0].content.parts[0].text;
                return { responseText, modelUsed: model };
            } catch (error) {
                console.error(`[YT-TL] Model ${model} failed:`, error.message);
                lastError = error;
            }
        }

        const baseError = modelCyclingEnabled ? "[AllModelsFailed]" : "[SingleModelFailed]";
        throw new Error(`${baseError} ${lastError ? lastError.message : 'All models failed.'}`);
    },

    /**
     * Makes the actual fetch call to the Gemini API and handles cooldowns.
     * @param {string} apiKey The user's API key.
     * @param {string} model The model to use for the request.
     * @param {string} prompt The prompt to send.
     * @returns {Promise<object>} The JSON response from the API.
     */
    async makeApiCall(apiKey, model, prompt) {
        const cooldownKeys = [`failureCooldown_${model}`, `dailyLimit_${model}`];
        const { [cooldownKeys[0]]: failureCooldown, [cooldownKeys[1]]: dailyLimit } = await chrome.storage.local.get(cooldownKeys);
        const now = Date.now();

        if (dailyLimit?.expiry && now < dailyLimit.expiry) throw new Error(`Model ${model} is on daily quota cooldown.`);
        if (failureCooldown?.expiry && now < failureCooldown.expiry) throw new Error(`Model ${model} is on 24h cooldown due to repeated failures.`);

        const endpoint = `${this.API_BASE_URL}/${model}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            });
            const data = await response.json();

            if (!response.ok) {
                const errorMessage = data.error?.message || `HTTP error! status: ${response.status}`;
                if (errorMessage.includes("exceeded your current quota")) {
                    await chrome.storage.local.set({ [`dailyLimit_${model}`]: { expiry: Date.now() + 24 * 60 * 60 * 1000 } });
                }
                throw new Error(errorMessage);
            }

            await this.resetFailureCount(model);
            return data;
        } catch (error) {
            await this.handleFailure(model, error);
            throw error;
        }
    },

    /**
     * Increments the failure count for a model and sets a cooldown if the threshold is reached.
     * @param {string} model The model that failed.
     * @param {Error} error The error that occurred.
     */
    async handleFailure(model, error) {
        if (error.message.includes("exceeded your current quota")) return;

        const key = `failureCount_${model}`;
        const { [key]: currentCount = 0 } = await chrome.storage.local.get(key);
        const newCount = currentCount + 1;

        console.log(`[YT-TL Failure Tracker] Failure count for ${model} is now ${newCount}.`);

        if (newCount >= this.FAILURE_THRESHOLD) {
            const cooldownKey = `failureCooldown_${model}`;
            await chrome.storage.local.set({
                [cooldownKey]: { expiry: Date.now() + 24 * 60 * 60 * 1000 },
                [key]: 0
            });
            console.log(`[YT-TL Failure Tracker] Model ${model} has failed ${newCount} times. Placing on 24-hour cooldown.`);
        } else {
            await chrome.storage.local.set({ [key]: newCount });
        }
    },

    /**
     * Resets the failure count for a model upon a successful API call.
     * @param {string} model The model that succeeded.
     */
    async resetFailureCount(model) {
        const key = `failureCount_${model}`;
        const { [key]: currentCount } = await chrome.storage.local.get(key);
        if (currentCount > 0) {
            await chrome.storage.local.remove(key);
            console.log(`[YT-TL Failure Tracker] Reset failure count for ${model}.`);
        }
    },
};