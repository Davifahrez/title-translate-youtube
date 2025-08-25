const titleSelectors = [
    'a#video-title', // General video title link
    'h1.ytd-video-primary-info-renderer yt-formatted-string', // Watch page title
    '#video-title.ytd-rich-grid-media', // Titles in rich grids (homepage, search)
    'h3.yt-lockup-metadata-view-model-wiz__heading-reset', // Video title on the video page
    'a.yt-lockup-metadata-view-model-wiz__title', // Another video title element
    'yt-formatted-string.style-scope.ytd-watch-metadata', // Video title on watch page (yt-formatted-string)
].join(', ');

let popupElement = null;
let currentHoveredElement = null;
let hidePopupTimeout = null;
const TRANSLATING_DELAY = 100; // milliseconds

async function showTranslationPopup(element, translation) {
    if (!popupElement) {
        const response = await fetch(chrome.runtime.getURL('src/hover_popup.html'));
        const htmlContent = await response.text();
        popupElement = document.createElement('div');
        popupElement.innerHTML = htmlContent;
        popupElement.classList.add('yt-translator-popup');
        document.body.appendChild(popupElement);

        // Apply dark mode to the popup if enabled
        const result = await chrome.storage.local.get('darkMode'); // Make this await
        if (result.darkMode) {
            popupElement.classList.add('dark-mode');
        } else {
            popupElement.classList.remove('dark-mode');
        }

        const closeButton = popupElement.querySelector('#yt-translator-close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', hideTranslationPopup);
        }

        const explainButton = popupElement.querySelector('#yt-translator-explain-btn');
        if (explainButton) {
            explainButton.addEventListener('click', async () => {
                const originalText = popupElement.dataset.originalText; // Get original text from data attribute
                if (originalText) {
                    const explanationDiv = popupElement.querySelector('#yt-translator-explanation');
                    const explanationTextElement = popupElement.querySelector('#yt-translator-explanation-text');
                    explanationTextElement.textContent = 'Generating explanation...';
                    explanationDiv.style.display = 'block'; // Show explanation section

                    try {
                        const response = await chrome.runtime.sendMessage({ action: 'explain', text: originalText });
                        if (response.error) {
                            explanationTextElement.textContent = `Error: ${response.error}`;
                        } else if (response.explanation) {
                            explanationTextElement.textContent = response.explanation;
                        } else {
                            explanationTextElement.textContent = 'No explanation found.';
                        }
                    } catch (error) {
                        console.error('Error requesting explanation:', error);
                        explanationTextElement.textContent = `Error: ${error.message}`;
                    }
                }
            });
        }

        popupElement.addEventListener('mouseover', () => {
            clearTimeout(hidePopupTimeout);
        });
        popupElement.addEventListener('mouseout', () => {
            hidePopupTimeout = setTimeout(hideTranslationPopup, 100);
        });
    }

    // Store the original text in a data attribute on the popup element
    popupElement.dataset.originalText = element.textContent.trim();

    const translationTextElement = popupElement.querySelector('#yt-translator-text');
    if (translationTextElement) {
        translationTextElement.textContent = translation;
    }

    // Hide explanation section by default when showing a new translation
    const explanationDiv = popupElement.querySelector('#yt-translator-explanation');
    if (explanationDiv) {
        explanationDiv.style.display = 'none';
        popupElement.querySelector('#yt-translator-explanation-text').textContent = '';
    }

    const rect = element.getBoundingClientRect();
    popupElement.style.position = 'absolute';
    popupElement.style.left = `${rect.left + window.scrollX}px`;
    popupElement.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popupElement.style.zIndex = '9999';
}

function hideTranslationPopup() {
    if (popupElement) {
        popupElement.remove();
        popupElement = null;
    }
    currentHoveredElement = null;
    clearTimeout(hidePopupTimeout);
}

function handleMouseOver(event) {
    const titleElement = event.target.closest(titleSelectors);
    if (titleElement && titleElement !== currentHoveredElement) {
        currentHoveredElement = titleElement;
        clearTimeout(hidePopupTimeout);

        const text = titleElement.textContent.trim();
        // Regular expression to detect Japanese characters (Hiragana, Katakana, Kanji)
        const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

        if (text && japaneseRegex.test(text)) { // Only proceed if text exists and contains Japanese characters
            let showTranslatingTimeout = setTimeout(() => {
                showTranslationPopup(titleElement, 'Translating...');
            }, TRANSLATING_DELAY); // Show "Translating..." after a short delay

            chrome.runtime.sendMessage({ action: 'translateSingle', text: text }, (response) => {
                clearTimeout(showTranslatingTimeout); // Clear the "Translating..." timeout

                if (chrome.runtime.lastError) {
                    console.warn('Ignoring message response: Extension context invalidated or other error.', chrome.runtime.lastError);
                    // Provide user feedback that the extension might be reloading
                    showTranslationPopup(titleElement, 'Extension is reloading or temporarily unavailable. Please try again in a moment.');
                    return;
                }
                if (response.error) {
                    console.error('Translation error:', response.error);
                    showTranslationPopup(titleElement, `Error: ${response.error}`);
                    return;
                }
                if (response.translation) {
                    showTranslationPopup(titleElement, response.translation);
                } else {
                    hideTranslationPopup();
                }
            });
        } else {
            // If no Japanese text, do not show "Translating..." and hide any existing popup
            hideTranslationPopup();
        }
    }
}

function handleMouseOut(event) {
    // If the mouse is moving to the popup, don't hide it yet
    if (popupElement && popupElement.contains(event.relatedTarget)) {
        return;
    }
    clearTimeout(hidePopupTimeout); // Ensure any existing timeout is cleared
    // Start a timeout to hide the popup
    hidePopupTimeout = setTimeout(() => {
        hideTranslationPopup();
        currentHoveredElement = null; // Reset current hovered element when popup hides
    }, 200); // Increased delay to 200ms
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // Element node
                    const titles = node.querySelectorAll(titleSelectors);
                    titles.forEach(title => {
                        if (!title.dataset.hasHoverListener) {
                            title.addEventListener('mouseover', handleMouseOver);
                            title.addEventListener('mouseout', handleMouseOut);
                            title.dataset.hasHoverListener = 'true';
                        }
                    });
                }
            });
        }
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

document.querySelectorAll(titleSelectors).forEach(title => {
    if (!title.dataset.hasHoverListener) {
        title.addEventListener('mouseover', handleMouseOver);
        title.addEventListener('mouseout', handleMouseOut);
        title.dataset.hasHoverListener = 'true';
    }
});