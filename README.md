# YouTube Title Translator

A simple and lightweight Chrome extension to translate YouTube video titles in real-time by hovering over them. Powered by a configurable AI API.

## Features

*   **Modular AI Architecture:**
    *   The core AI interaction logic has been extracted into a dedicated `ai/gemini.js` file.
    *   This module handles API calls, model selection, intelligent fallback mechanisms, and advanced error handling, including a new cooldown system for failing models.

*   **Enhanced Configuration and Customization:**
    *   **Custom Prompts:** Users can now customize the prompts used for both translation and explanation, allowing for more tailored AI responses.
    *   **Explanation Caching:** Option to enable or disable caching for explanations to improve performance.
    *   **Model Fallback Control:** Users can enable or disable automatic model fallback, where the extension cycles through a list of models if the primary one fails.
    *   **Custom Fallback Chain:** A new drag-and-drop interface in the popup allows users to define and reorder their preferred model fallback chain.
    *   **Display Model Used:** Option to show or hide the name of the AI model used for each translation.
    *   **Comment Translation:** New setting to enable or disable translation for YouTube comments.

*   **Revamped User Interface:**
    *   The extension popup has been transformed into a comprehensive control panel.
    *   It dynamically displays the real-time status of each AI model (e.g., available, on cooldown, permanently unavailable).
    *   Provides intuitive controls for all new features.

*   **Improved API Management Tools:**
    *   **Automated Model Validation:** The extension now automatically validates the availability of AI models for the user's provided API key.
    *   **Manual Cooldown Clearing:** A new button allows users to manually clear any active model cooldowns.

*   **Sophisticated Error Handling:**
    *   The error reporting is more detailed and user-friendly, providing specific messages for various failure scenarios (e.g., quota limits, invalid API keys, network issues).

*   **Streamlined Permissions:**
    *   The `"offscreen"` permission has been removed from the `manifest.json`, simplifying the extension's permissions and reducing its footprint.

## Installation

1.  **Download**: Go to the [Releases page](https://github.com/Davifahrez/title-translate-youtube/releases) and download the latest `Title.Translate.x.x.x.crx` file.
2.  **Open Chrome Extensions**: Open Chrome and navigate to `chrome://extensions/`.
3.  **Enable Developer Mode**: Turn on the "Developer mode" toggle in the top-right corner.
4.  **Install the Extension**: Drag and drop the downloaded `yt-tl.crx` file onto the `chrome://extensions/` page. Confirm any prompts to add the extension.

## Setup

1.  **Get an API Key**:
    *   Go to your AI provider's website (e.g., Google AI for Developers).
    *   Click on "Get API key in Google AI Studio" and follow the instructions to create your key.
2.  **Configure the Extension**:
    *   Click the YouTube Title Translator extension icon in your Chrome toolbar.
    *   Enter your API key into the input field.
    *   Select your preferred model from the dropdown.
    *   Click "Save Settings".

## Usage

Once installed and configured, simply go to YouTube. Hover your mouse over any video title on the homepage, in search results, or on a watch page, and a popup with the English translation will appear after a brief moment.

## Privacy

This extension operates entirely on your browser. Your API key is stored locally and is only used to communicate directly with the AI provider's API. No data is collected, stored, or shared by the extension.
