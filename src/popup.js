document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('model');
    const darkModeToggle = document.getElementById('darkModeToggle'); // Get the new toggle
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');

    // Function to apply or remove dark mode class
    function applyDarkMode(isDarkMode) {
        if (isDarkMode) {
            document.documentElement.classList.add('dark-mode'); // Change to document.documentElement
        } else {
            document.documentElement.classList.remove('dark-mode'); // Change to document.documentElement
        }
    }

    // Load saved settings
    chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'darkMode'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
        if (result.geminiModel) {
            modelSelect.value = result.geminiModel;
        }
        // Load dark mode preference
        const isDarkMode = result.darkMode !== undefined ? result.darkMode : window.matchMedia('(prefers-color-scheme: dark)').matches;
        darkModeToggle.checked = isDarkMode;
        applyDarkMode(isDarkMode);
    });

    // Save settings
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const darkMode = darkModeToggle.checked; // Get dark mode preference

        if (!apiKey) {
            showStatus('Please enter an API key.', 'error');
            return;
        }

        chrome.storage.local.set({ geminiApiKey: apiKey, geminiModel: model, darkMode: darkMode }, () => {
            showStatus('Settings saved successfully!', 'success');
        });
    });

    // Listen for dark mode toggle changes
    darkModeToggle.addEventListener('change', () => {
        applyDarkMode(darkModeToggle.checked);
    });

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
});