document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('model');
    const translationPromptInput = document.getElementById('translationPrompt');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const explanationCacheToggle = document.getElementById('explanationCacheToggle');
    const modelCyclingToggle = document.getElementById('modelCyclingToggle');
    const showModelToggle = document.getElementById('showModelToggle');
    const explanationPromptInput = document.getElementById('explanationPrompt');
    const commentTranslationToggle = document.getElementById('commentTranslationToggle');
    const fallbackListContainer = document.getElementById('fallback-list-container');
    const saveButton = document.getElementById('saveButton');
    const revalidateButton = document.getElementById('revalidateButton');
    const clearCooldownsButton = document.getElementById('clearCooldownsButton');
    const statusDiv = document.getElementById('status');

    let knownModels = {}; // To store models fetched from background
    let defaultFallbackChain = [];

    // Function to apply or remove dark mode class
    function applyDarkMode(isDarkMode) {
        if (isDarkMode) {
            document.documentElement.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
    }

    async function updateModelDisplay() {
        const allStorage = await chrome.storage.local.get(['modelFallbackChain', 'permanentlyInvalidModels', 'modelCyclingEnabled']);
        const { modelFallbackChain, permanentlyInvalidModels = [], modelCyclingEnabled = false } = allStorage;
        const now = Date.now();
        const modelsOnCooldown = new Set();
        const modelsOnFailureCooldown = new Set();
        const invalidModels = new Set(permanentlyInvalidModels);

        for (const key in allStorage) {
            if (key.startsWith('dailyLimit_')) {
                const limitInfo = allStorage[key];
                if (limitInfo && limitInfo.expiry && now < limitInfo.expiry) {
                    const modelName = key.substring('dailyLimit_'.length);
                    modelsOnCooldown.add(modelName);
                }
            }
            if (key.startsWith('failureCooldown_')) {
                const cooldownInfo = allStorage[key];
                if (cooldownInfo && cooldownInfo.expiry && now < cooldownInfo.expiry) {
                    const modelName = key.substring('dailyLimit_'.length);
                    modelsOnCooldown.add(modelName);
                }
            }
        }

        // Update the primary model dropdown
        for (const option of modelSelect.options) {
            const modelId = option.value;
            const rateLimit = knownModels[modelId]?.rate || '?';

            // Reset text content to base name first by removing existing parenthetical info
            const baseName = option.dataset.baseName || option.textContent.split(' (')[0];
            if (!option.dataset.baseName) {
                option.dataset.baseName = baseName; // Store the original name
            }

            let label = `${baseName} (${rateLimit}/min)`;

            if (invalidModels.has(modelId)) {
                option.disabled = true;
                label += ' (Unavailable)';
                option.style.color = '#999';
            } else if (modelsOnFailureCooldown.has(modelId)) {
                option.disabled = true;
                label += ' (On Cooldown - 24h)';
                option.style.color = '#999';
            } else if (modelsOnCooldown.has(modelId)) {
                option.disabled = true;
                label += ' (On Cooldown)';
                option.style.color = '#999';
            } else {
                option.disabled = false;
                option.style.color = '';
            }
            option.textContent = label;
        }

        // Update the draggable fallback list
        const currentFallbackModels = modelFallbackChain || getDefaultFallbackChain();
        fallbackListContainer.innerHTML = ''; // Clear existing list

        // Grey out the container if model cycling is disabled
        if (modelCyclingEnabled) {
            fallbackListContainer.classList.remove('disabled');
        } else {
            fallbackListContainer.classList.add('disabled');
        }

        currentFallbackModels.forEach(modelId => {
            const item = document.createElement('div');
            item.classList.add('fallback-item');
            item.dataset.model = modelId;

            const handle = document.createElement('span');
            handle.classList.add('drag-handle');
            handle.textContent = '⠿'; // Drag handle icon
            item.appendChild(handle);

            const label = document.createElement('span');
            label.textContent = modelId;
            item.appendChild(label);

            if (invalidModels.has(modelId)) {
                item.classList.add('cooldown'); // Using 'cooldown' style for disabled look
                item.draggable = false;
                const unavailableLabel = document.createElement('span');
                unavailableLabel.classList.add('cooldown-label');
                unavailableLabel.textContent = '(Unavailable)';
                item.appendChild(unavailableLabel);
            } else if (modelsOnFailureCooldown.has(modelId)) {
                item.classList.add('cooldown');
                item.draggable = false;
                const cooldownLabel = document.createElement('span');
                cooldownLabel.classList.add('cooldown-label');
                cooldownLabel.textContent = '(Cooldown - 24h)';
                item.appendChild(cooldownLabel);
            } else if (modelsOnCooldown.has(modelId)) {
                item.classList.add('cooldown');
                item.draggable = false;
                const cooldownLabel = document.createElement('span');
                cooldownLabel.classList.add('cooldown-label');
                cooldownLabel.textContent = '(On Cooldown)';
                item.appendChild(cooldownLabel);
            } else {
                item.draggable = modelCyclingEnabled; // Only draggable if the feature is enabled
            }

            fallbackListContainer.appendChild(item);
        });
    }

    function getDefaultFallbackChain() {
        return defaultFallbackChain;
    }

    // Function to populate the UI elements that depend on the model list
    function populateModelElements() {
        // Populate primary model dropdown
        modelSelect.innerHTML = ''; // Clear existing options
        for (const modelId in knownModels) {
            const modelInfo = knownModels[modelId];
            const option = document.createElement('option');
            option.value = modelId;
            option.textContent = modelInfo.name;
            option.dataset.baseName = modelInfo.name; // Store base name for updates
            modelSelect.appendChild(option);
        }

        // Set default selected model if needed, then load saved settings
        modelSelect.value = 'gemini-2.5-flash';
        loadAndDisplaySettings();
    }

    // New function to load settings
    async function loadAndDisplaySettings() {
        chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'geminiPrompt', 'darkMode', 'explanationCache', 'modelCyclingEnabled', 'showModelUsed', 'explanationPrompt', 'modelFallbackChain', 'commentTranslationEnabled'], (result) => {
            if (result.geminiApiKey) {
                apiKeyInput.value = result.geminiApiKey;
            }
            if (result.geminiModel && modelSelect.querySelector(`option[value="${result.geminiModel}"]`)) {
                modelSelect.value = result.geminiModel;
            }
            translationPromptInput.value = result.geminiPrompt || "Directly translate this title to English. Output only the translation, nothing else.";

            const isDarkMode = result.darkMode !== undefined ? result.darkMode : window.matchMedia('(prefers-color-scheme: dark)').matches;
            darkModeToggle.checked = isDarkMode;
            applyDarkMode(isDarkMode);

            explanationCacheToggle.checked = result.explanationCache !== undefined ? result.explanationCache : true;
            modelCyclingToggle.checked = result.modelCyclingEnabled !== undefined ? result.modelCyclingEnabled : false; // Default to OFF
            showModelToggle.checked = result.showModelUsed !== undefined ? result.showModelUsed : true; // Default to ON
            commentTranslationToggle.checked = result.commentTranslationEnabled !== undefined ? result.commentTranslationEnabled : false; // Default to OFF

            explanationPromptInput.value = result.explanationPrompt || "Translate this Japanese sentence into natural English. Then, provide a breakdown of the N4-level grammar and key vocabulary, including kanji with furigana.";            
            // This will now use the populated `knownModels`
            updateModelDisplay();
        });
    }

    // Fetch models from background script on load
    chrome.runtime.sendMessage({ action: 'getKnownModels' }, (response) => {
        if (response?.models) {
            knownModels = response.models;
            defaultFallbackChain = response.defaultChain || [];
            populateModelElements();
        } else if (response?.error) {
            console.error("Background script error:", response.error);
            showStatus(`Error loading models: ${response.error}`, 'error', 10000); // Show for longer
        } else {
            console.error("Could not fetch model list from background script.");
            showStatus('Could not fetch model list from background script. Check extension logs.', 'error', 10000);
        }
    });

    // Save settings
    saveButton.addEventListener('click', async () => {
        const newApiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const translationPrompt = translationPromptInput.value.trim();
        const darkMode = darkModeToggle.checked;
        const explanationCache = explanationCacheToggle.checked;
        const modelCycling = modelCyclingToggle.checked;
        const showModelUsed = showModelToggle.checked;
        const explanationPrompt = explanationPromptInput.value.trim();
        const commentTranslationEnabled = commentTranslationToggle.checked;

        const modelFallbackChain = Array.from(
            fallbackListContainer.querySelectorAll('.fallback-item')
        ).map(item => item.dataset.model);

        if (!newApiKey) {
            showStatus('Please enter an API key.', 'error');
            return;
        }

        // Check if API key has changed to trigger validation
        const { geminiApiKey: oldApiKey } = await chrome.storage.local.get('geminiApiKey');

        const settingsToSave = {
            geminiApiKey: newApiKey,
            geminiModel: model,
            geminiPrompt: translationPrompt,
            darkMode: darkMode,
            explanationCache: explanationCache,
            modelCyclingEnabled: modelCycling,
            showModelUsed: showModelUsed,
            explanationPrompt: explanationPrompt,
            modelFallbackChain: modelFallbackChain,
            commentTranslationEnabled: commentTranslationEnabled
        };

        chrome.storage.local.set(settingsToSave, () => {
            if (newApiKey !== oldApiKey) {
                showStatus('API key changed. Validating models...', 'info');
                saveButton.disabled = true;
                revalidateButton.disabled = true;
                chrome.runtime.sendMessage({ action: 'validateModels', apiKey: newApiKey }, (response) => {
                    saveButton.disabled = false;
                    revalidateButton.disabled = false;
                    if (chrome.runtime.lastError) {
                        showStatus(`Validation failed: ${chrome.runtime.lastError.message}`, 'error');
                        return;
                    }
                    if (response?.error) {
                        showStatus(`Validation failed: ${response.error}`, 'error');
                        updateModelDisplay();
                        return;
                    }
                    if (response?.permanentlyInvalidModels) {
                        const invalidCount = response.permanentlyInvalidModels.length;
                        showStatus(`Settings saved. ${invalidCount > 0 ? `${invalidCount} model(s) unavailable.` : 'All models are available.'}`, 'success');
                        updateModelDisplay(); // Refresh UI with validation results
                    } else {
                        showStatus('Settings saved, but model validation returned an unexpected response.', 'error');
                    }
                });
            } else {
                showStatus('Settings saved successfully!', 'success');
            }
        });
    });

    // Re-validate models
    revalidateButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showStatus('Please enter an API key to re-validate.', 'error');
            return;
        }

        showStatus('Re-validating models...', 'info');
        saveButton.disabled = true;
        revalidateButton.disabled = true;

        chrome.runtime.sendMessage({ action: 'validateModels', apiKey: apiKey }, (response) => {
            saveButton.disabled = false;
            revalidateButton.disabled = false;

            if (chrome.runtime.lastError) {
                showStatus(`Validation failed: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            if (response?.error) {
                showStatus(`Validation failed: ${response.error}`, 'error');
                updateModelDisplay();
                return;
            }
            if (response?.permanentlyInvalidModels) {
                const invalidCount = response.permanentlyInvalidModels.length;
                showStatus(`Validation complete. ${invalidCount > 0 ? `${invalidCount} model(s) unavailable.` : 'All models are available.'}`, 'success');
                updateModelDisplay(); // Refresh UI with validation results
            } else {
                showStatus('Validation returned an unexpected response.', 'error');
            }
        });
    });

    // Listen for dark mode toggle changes
    darkModeToggle.addEventListener('change', () => {
        applyDarkMode(darkModeToggle.checked);
    });

    // Listen for model fallback toggle to update UI immediately
    modelCyclingToggle.addEventListener('change', () => {
        updateModelDisplay();
    });

    // Clear all model cooldowns
    clearCooldownsButton.addEventListener('click', () => {
        showStatus('Clearing all model cooldowns...', 'info');
        chrome.runtime.sendMessage({ action: 'clearCooldowns' }, (response) => {
            if (chrome.runtime.lastError) {
                showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            if (response?.success) {
                showStatus(`Cooldowns cleared for ${response.clearedCount} model(s).`, 'success');
                updateModelDisplay(); // Refresh the UI to show models as available again
            } else {
                showStatus(`Error clearing cooldowns: ${response?.error || 'Unknown error'}`, 'error');
            }
        });
    });

    function showStatus(message, type, duration = 3000) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, duration);
    }

    // --- Drag and Drop Logic (integrated into the main listener) ---
    let draggedItem = null;

    fallbackListContainer.addEventListener('dragstart', e => {
        if (e.target.classList.contains('fallback-item')) {
            draggedItem = e.target;
            setTimeout(() => e.target.classList.add('dragging'), 0);
        }
    });

    fallbackListContainer.addEventListener('dragend', e => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
        }
    });

    fallbackListContainer.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getDragAfterElement(fallbackListContainer, e.clientY);
        if (draggedItem) {
            if (afterElement == null) {
                fallbackListContainer.appendChild(draggedItem);
            } else {
                fallbackListContainer.insertBefore(draggedItem, afterElement);
            }
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.fallback-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
});