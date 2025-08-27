# YouTube Title Translator

A simple and lightweight Chrome extension to translate YouTube video titles in real-time by hovering over them. Powered by Google's Gemini API.

## Features

- **Real-Time Translation**: Hover over any video title on YouTube to see its English translation.
- **Seamless UI**: The translation appears in a small, non-intrusive popup directly below the title.
- **Customizable Model**: Choose between Gemini 1.5 Flash and Gemini Pro for translation.
- **Secure**: Your Gemini API key is stored locally and securely using `chrome.storage.local`.
- **Manifest V3**: Built on the latest Chrome Extension platform for better performance and security.

## Installation

1.  **Download**: Go to the [Releases page](https://github.com/Davifahrez/title-translate-youtube/releases) and download the latest `yt-tl.crx` file.
2.  **Open Chrome Extensions**: Open Chrome and navigate to `chrome://extensions/`.
3.  **Enable Developer Mode**: Turn on the "Developer mode" toggle in the top-right corner.
4.  **Install the Extension**: Drag and drop the downloaded `yt-tl.crx` file onto the `chrome://extensions/` page. Confirm any prompts to add the extension.

## Setup

1.  **Get a Gemini API Key**:
    *   Go to the [Google AI for Developers](https://ai.google.dev/) website.
    *   Click on "Get API key in Google AI Studio" and follow the instructions to create your key.
2.  **Configure the Extension**:
    *   Click the YouTube Title Translator extension icon in your Chrome toolbar.
    *   Enter your Gemini API key into the input field.
    *   Select your preferred Gemini model from the dropdown.
    *   Click "Save Settings".

## Usage

Once installed and configured, simply go to YouTube. Hover your mouse over any video title on the homepage, in search results, or on a watch page, and a popup with the English translation will appear after a brief moment.

## Privacy

This extension operates entirely on your browser. Your API key is stored locally and is only used to communicate directly with the Google Gemini API. No data is collected, stored, or shared by the extension.
