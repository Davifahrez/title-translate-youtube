const titleSelectors = [
    'a#video-title', // General video title link
    'h1.ytd-video-primary-info-renderer yt-formatted-string', // Watch page title
    '#video-title.ytd-rich-grid-media', // Titles in rich grids (homepage, search)
    'h3.yt-lockup-metadata-view-model-wiz__heading-reset', // Video title on the video page
    'a.yt-lockup-metadata-view-model-wiz__title', // Another video title element
    'yt-formatted-string.style-scope.ytd-watch-metadata' // Video title on watch page (yt-formatted-string)
].join(', ');

const commentSelector = 'yt-formatted-string#content-text'; // Selector for comment text
const allTranslatableSelectors = [titleSelectors, commentSelector].join(', ');

let popupElement = null;
let currentHoveredElement = null;
let hidePopupTimeout = null;
let isPopupPinned = false;
let isRequestInProgress = false;
const TRANSLATING_DELAY = 100; // milliseconds
let hoverTimeout = null;
const HOVER_DEBOUNCE_DELAY = 50; // ms, a short delay to prevent firing on rapid mouse-overs
const ANIMATION_DURATION = 200; // ms, should match CSS transition duration
const EXPLANATION_RATE_LIMIT = 1000; // 1 second in milliseconds
let lastExplanationRequestTimestamps = {};
let translationCache = {};
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function updateTextWithFade(element, newText) {
    return new Promise(resolve => {
        if (!element || element.textContent === newText) {
            resolve();
            return;
        }

        const transitionDuration = 150; // ms
        element.style.transition = `opacity ${transitionDuration}ms ease-in-out`;
        element.style.opacity = '0';

        setTimeout(() => {
            element.textContent = newText;
            element.style.opacity = '1';
            resolve();
        }, transitionDuration);
    });
}

async function showTranslationPopup(element, translation, modelUsed) {
    // If the popup was hidden while a translation was in progress, don't show it.
    if (!currentHoveredElement && !isPopupPinned) {
        return;
    }

    if (!popupElement) {
        const response = await fetch(chrome.runtime.getURL('src/hover_popup.html'));
        const htmlContent = await response.text();
        popupElement = document.createElement('div');
        popupElement.innerHTML = htmlContent;
        popupElement.classList.add('yt-translator-popup');

        const result = await chrome.storage.local.get('darkMode');
        if (result.darkMode) {
            popupElement.classList.add('dark-mode');
        } else {
            popupElement.classList.remove('dark-mode');
        }

        document.body.appendChild(popupElement);

        const closeButton = popupElement.querySelector('#yt-translator-close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', hideTranslationPopup);
        }

        const explainButton = popupElement.querySelector('#yt-translator-explain-btn');
        if (explainButton) {
            explainButton.addEventListener('click', async () => {
                // Capture a reference to the current popup. If the user closes it,
                // the global `popupElement` will become null, and we can detect the change.
                const currentPopup = popupElement;

                const originalText = popupElement.dataset.originalText;
                if (originalText) {
                    const now = Date.now();
                    const lastRequestTime = lastExplanationRequestTimestamps[originalText] || 0;

                    if (now - lastRequestTime < EXPLANATION_RATE_LIMIT) {
                        console.log(`Rate limit: Cannot request explanation for "${originalText}" again so soon.`);
                        return;
                    }
                    lastExplanationRequestTimestamps[originalText] = now;

                    const explanationDiv = currentPopup.querySelector('#yt-translator-explanation');
                    const explanationTitle = explanationDiv.querySelector('h2');
                    const explanationTextElement = currentPopup.querySelector('#yt-translator-explanation-text');
                    const isRedo = explainButton.textContent === 'Redo Explanation';
                    const footer = currentPopup.querySelector('.yt-translator-footer');

                    // Set loading state
                    isRequestInProgress = true;
                    explainButton.disabled = true;
                    footer.classList.add('loading');

                    try {
                        // Show "Generating..." message
                        await updateTextWithFade(explanationTextElement, 'Generating explanation...');
                        explanationTitle.textContent = 'Explanation';
                        explanationTitle.classList.remove('cached');
                        explanationDiv.classList.add('visible');

                        // Use a promise-based approach to handle the response and errors cleanly
                        const response = await new Promise((resolve, reject) => {
                            chrome.runtime.sendMessage({ action: 'explain', text: originalText, force: isRedo }, (res) => {
                                if (chrome.runtime.lastError) {
                                    reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                    resolve(res);
                                }
                            });
                        });
                        
                        // After awaiting, check if the popup context is still valid.
                        // If the user closed the popup, the global `popupElement` will be null.
                        if (popupElement !== currentPopup) {
                            console.log('[YT-TL] Explanation response received, but popup was closed. Ignoring.');
                            return; // The 'finally' block will still execute to reset state.
                        }

                        if (response.error) {
                            await updateTextWithFade(explanationTextElement, `Error: ${response.error}`);
                            explainButton.textContent = 'Explain';
                        } else if (response.explanation) {
                            await updateTextWithFade(explanationTextElement, response.explanation);
                            explanationTitle.textContent = response.fromCache ? 'Explanation (Cached)' : 'Explanation'; // Keep this for cached status
                            if (response.fromCache) {
                                explanationTitle.classList.add('cached');
                            }
                            explainButton.textContent = 'Redo Explanation';

                            // Update model display for explanation
                            const explanationModel = response.modelUsed;
                            const translationModel = currentPopup.dataset.translationModel;
                            const { showModelUsed } = await chrome.storage.local.get({ showModelUsed: true });
                            const tlModelSpan = currentPopup.querySelector('#yt-translator-translation-model-info');
                            const exModelSpan = currentPopup.querySelector('#yt-translator-explanation-model-info');

                            if (showModelUsed) {
                                if (translationModel) {
                                    tlModelSpan.textContent = `TL: ${translationModel}`;
                                } else {
                                    tlModelSpan.textContent = ''; // Should not happen if translation occurred
                                }
                                if (explanationModel) {
                                    exModelSpan.textContent = `EX: ${explanationModel}`;
                                } else {
                                    exModelSpan.textContent = ''; // Should not happen if explanation occurred
                                }
                            }
                        } else {
                            await updateTextWithFade(explanationTextElement, 'No explanation found.');
                            explainButton.textContent = 'Explain';
                        }
                    } catch (error) {
                        console.error('Error requesting explanation:', error);
                        // Only update the UI if the popup hasn't been closed.
                        if (popupElement === currentPopup) {
                            await updateTextWithFade(explanationTextElement, `Error: ${error.message}`);
                            explainButton.textContent = 'Explain';
                        }
                    } finally {
                        // Always reset the request-in-progress flag to prevent the extension from getting stuck.
                        isRequestInProgress = false;
                        // After an explanation, the popup's primary interaction is complete.
                        // We can "un-pin" it to allow the user to immediately translate another title
                        // without the popup blocking the hover event.
                        isPopupPinned = false;

                        // Only update the UI if the popup we started with is still active.
                        if (popupElement === currentPopup) {
                            footer.classList.remove('loading');
                            explainButton.disabled = false;
                        }
                    }
                }
            });
        }

        popupElement.addEventListener('mouseover', () => {
            clearTimeout(hidePopupTimeout);
            isPopupPinned = true;
        });
        popupElement.addEventListener('mouseleave', () => {
            isPopupPinned = false; // Always un-pin when mouse leaves.
            if (isRequestInProgress) {
                return; // But don't schedule a hide if a request is active.
            }
            hidePopupTimeout = setTimeout(hideTranslationPopup, 300);
        });
    }

    const originalText = element.textContent.trim();
    popupElement.dataset.originalText = originalText;
    popupElement.dataset.translationModel = modelUsed;

    const { showModelUsed } = await chrome.storage.local.get({ showModelUsed: false });
    const tlModelSpan = popupElement.querySelector('#yt-translator-translation-model-info');
    const exModelSpan = popupElement.querySelector('#yt-translator-explanation-model-info');

    const translationTextElement = popupElement.querySelector('#yt-translator-text');
    if (translationTextElement) {
        updateTextWithFade(translationTextElement, translation);
    }

    if (showModelUsed && modelUsed && tlModelSpan) {
        tlModelSpan.textContent = `TL: ${modelUsed}`;
    }
    exModelSpan.textContent = ''; // Always clear explanation model on new popup

    const explanationDiv = popupElement.querySelector('#yt-translator-explanation');
    if (explanationDiv) {
        explanationDiv.classList.remove('visible');
        const explanationTitle = explanationDiv.querySelector('h2');
        explanationTitle.textContent = 'Explanation';
        explanationTitle.classList.remove('cached');
        explanationDiv.querySelector('#yt-translator-explanation-text').textContent = '';
    }
    const explainButton = popupElement.querySelector('#yt-translator-explain-btn');
    if (explainButton) {
        explainButton.textContent = 'Explain';
    }

    const rect = element.getBoundingClientRect();
    popupElement.style.position = 'absolute';
    popupElement.style.left = `${rect.left + window.scrollX}px`;
    popupElement.style.top = `${rect.bottom + window.scrollY + 5}px`;
    popupElement.style.zIndex = '10000';

    requestAnimationFrame(() => {
        if (popupElement) {
            popupElement.classList.add('visible');
        }
    });
}

function hideTranslationPopup() {
    if (popupElement) {
        const p = popupElement;
        p.classList.remove('visible');
        setTimeout(() => {
            p.remove();
        }, ANIMATION_DURATION);
        popupElement = null;
    }
    currentHoveredElement = null;
    isPopupPinned = false;
    isRequestInProgress = false;
    clearTimeout(hidePopupTimeout);
}

function handleMouseOver(event) {
    const targetElement = event.target.closest(allTranslatableSelectors);

    if (!targetElement) {
        return;
    }

    clearTimeout(hidePopupTimeout); // Cancel any pending hide actions

    // If the mouse is already over the element that triggered the popup, do nothing.
    if (currentHoveredElement === targetElement) {
        return;
    }

    currentHoveredElement = targetElement;

    // Use a short delay to avoid flickering when moving the mouse over elements.
    setTimeout(() => {
        // If the mouse has moved to another element, don't show the popup.
        if (currentHoveredElement !== targetElement) {
            return;
        }
        showPopupForElement(targetElement);
    }, 100);
}

function handleMouseOut(event) {
    // If the mouse is leaving the element but entering the popup, don't hide it.
    if (popupElement && popupElement.contains(event.relatedTarget)) {
        return;
    }

    // Hide the popup after a short delay, allowing the user to move the mouse into it.
    hidePopupTimeout = setTimeout(() => {
        hideTranslationPopup();
    }, 200);
}

async function showPopupForElement(element) {
    const text = element.textContent.trim();
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

    if (!text || !japaneseRegex.test(text)) {
        return;
    }

    // Show "Translating..." immediately.
    showTranslationPopup(element, 'Translating...');

    try {
        const cachedData = translationCache[text];
        if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION)) {
            console.log(`[Content Script] Using cached translation for: "${text}"`);
            showTranslationPopup(element, cachedData.translation, cachedData.modelUsed);
            return;
        }

        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'translateSingle', text: text }, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || 'Message passing failed.'));
                } else {
                    resolve(res);
                }
            });
        });

        if (!response) {
            throw new Error("Received an empty response from the background script.");
        }

        if (response.error) {
            throw new Error(response.error);
        }

        if (response.translation) {
            translationCache[text] = { translation: response.translation, modelUsed: response.modelUsed, timestamp: Date.now() };
            // Check if the popup is still meant for the same element.
            if (currentHoveredElement === element) {
                showTranslationPopup(element, response.translation, response.modelUsed);
            }
        } else {
            hideTranslationPopup();
        }
    } catch (error) {
        console.error('Translation error:', error.message);
        if (currentHoveredElement === element) {
            showTranslationPopup(element, `Error: ${error.message}`);
        }
    }
}

// Helper function to attach listeners to a title element, preventing duplicates.
function attachListenersToTitle(titleElement) {
    if (!titleElement.dataset.hasHoverListener) {
        titleElement.addEventListener('mouseenter', handleMouseOver);
        titleElement.addEventListener('mouseleave', handleMouseOut);
        titleElement.dataset.hasHoverListener = 'true';
    }
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // Ensure it's an element
                    // Case 1: The added node itself is a title.
                    if (node.matches(allTranslatableSelectors)) {
                        attachListenersToTitle(node);
                    }
                    // Case 2: The added node contains title elements.
                    node.querySelectorAll(allTranslatableSelectors).forEach(attachListenersToTitle);
                }
            });
        }
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Initial run for titles already on the page when the script loads.
document.querySelectorAll(allTranslatableSelectors).forEach(attachListenersToTitle);

// --- NEW EVENT HANDLERS FOR ROBUSTNESS ---

// 1. Hide popup when tab becomes hidden to prevent it from getting stuck.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        hideTranslationPopup();
    }
});

// 2. Hide popup when the original element is scrolled out of view.
let scrollDebounceTimeout;
document.addEventListener('scroll', () => {
    clearTimeout(scrollDebounceTimeout);
    scrollDebounceTimeout = setTimeout(() => {
        if (popupElement && !isPopupPinned && currentHoveredElement) {
            const rect = currentHoveredElement.getBoundingClientRect();
            const isOutOfView = rect.bottom < 0 || rect.top > window.innerHeight;
            if (isOutOfView) {
                hideTranslationPopup();
            }
        }
    }, 150); // A reasonable debounce delay to avoid performance issues.
}, true); // Use capture phase to catch events on all scrollable containers.