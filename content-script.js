// POS Peripheral Simulator - Content Script
// Handles DOM interaction with the target POS application

class POSContentScript {
    constructor() {
        this.targetSelector = null;
        this.domObserver = null;
        this.lastFocusedElement = null;

        this.init();
    }

    init() {
        console.log('POS Peripheral Simulator Content Script loaded');

        this.setupMessageListener();
        this.setupDOMObserver();
        this.trackFocusedElements();

        // Notify service worker that content script is ready
        chrome.runtime.sendMessage({
            action: 'CONTENT_SCRIPT_READY',
            url: window.location.href
        }).catch(() => {
            // Service worker might not be ready yet
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open
        });
    }

    setupDOMObserver() {
        // Use MutationObserver to watch for DOM changes in SPAs
        this.domObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.scanForInputElements(node);
                        }
                    });
                }
            });
        });

        this.domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial scan
        this.scanForInputElements(document.body);
    }

    trackFocusedElements() {
        // Track the currently focused element
        document.addEventListener('focusin', (event) => {
            if (this.isInputElement(event.target)) {
                this.lastFocusedElement = event.target;
                console.log('Focused element updated:', event.target);
            }
        }, true);
    }

    scanForInputElements(container) {
        // Look for common POS input elements
        const inputSelectors = [
            'input[type="text"]',
            'input[type="number"]',
            'input[placeholder*="barcode"]',
            'input[placeholder*="scan"]',
            'input[placeholder*="card"]',
            'input[placeholder*="magnetic"]',
            'input[id*="barcode"]',
            'input[id*="scan"]',
            'input[id*="card"]',
            'input[class*="barcode"]',
            'input[class*="scan"]',
            'input[class*="card"]',
            'textarea'
        ];

        inputSelectors.forEach(selector => {
            const elements = container.querySelectorAll(selector);
            elements.forEach(element => {
                if (!element.dataset.posSimulatorRegistered) {
                    element.dataset.posSimulatorRegistered = 'true';
                    console.log('Registered input element:', element);
                }
            });
        });
    }

    handleMessage(request, sender, sendResponse) {
        try {
            console.log('Content script received message:', request);

            switch (request.action) {
                case 'INJECT_INPUT':
                    this.injectInput(request.data);
                    break;

                case 'FIND_INPUT_ELEMENTS':
                    const elements = this.findInputElements();
                    sendResponse({ success: true, elements: elements });
                    return;

                case 'GET_PAGE_INFO':
                    const pageInfo = {
                        url: window.location.href,
                        title: document.title,
                        inputs: this.findInputElements().length
                    };
                    sendResponse({ success: true, data: pageInfo });
                    return;

                default:
                    console.warn('Unknown content script action:', request.action);
            }

            sendResponse({ success: true });
        } catch (error) {
            console.error('Error in content script:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    injectInput(data) {
        const targetElement = this.findTargetElement(data.type);

        if (!targetElement) {
            console.warn('No suitable target element found for input injection');
            return false;
        }

        console.log('Injecting input into:', targetElement);

        // Method 1: Direct value injection (most reliable for modern frameworks)
        this.setElementValue(targetElement, data.value);

        // Method 2: Simulate typing for additional compatibility
        if (data.simulateTyping) {
            this.simulateTyping(targetElement, data.value);
        }

        // Method 3: Trigger Enter key if requested
        if (data.simulateEnter) {
            setTimeout(() => {
                this.simulateEnterKey(targetElement);
            }, 100);
        }

        return true;
    }

    findTargetElement(inputType) {
        // Priority order for finding target elements
        const strategies = [
            () => this.lastFocusedElement,
            () => document.activeElement,
            () => this.findByInputType(inputType),
            () => this.findFirstVisibleInput()
        ];

        for (const strategy of strategies) {
            const element = strategy();
            if (element && this.isInputElement(element) && this.isElementVisible(element)) {
                return element;
            }
        }

        return null;
    }

    findByInputType(inputType) {
        const typeMap = {
            'barcode': ['barcode', 'scan', 'product', 'sku', 'item'],
            'msr': ['card', 'magnetic', 'stripe', 'msr', 'payment'],
            'general': ['input', 'data', 'value']
        };

        const keywords = typeMap[inputType] || typeMap['general'];

        for (const keyword of keywords) {
            // Try to find by various attributes
            const selectors = [
                `input[placeholder*="${keyword}"]`,
                `input[id*="${keyword}"]`,
                `input[name*="${keyword}"]`,
                `input[class*="${keyword}"]`
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && this.isElementVisible(element)) {
                    return element;
                }
            }
        }

        return null;
    }

    findFirstVisibleInput() {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea');

        for (const input of inputs) {
            if (this.isElementVisible(input) && !input.disabled && !input.readOnly) {
                return input;
            }
        }

        return null;
    }

    findInputElements() {
        const elements = [];
        const inputs = document.querySelectorAll('input, textarea, [contenteditable]');

        inputs.forEach(input => {
            if (this.isInputElement(input) && this.isElementVisible(input)) {
                elements.push({
                    tagName: input.tagName,
                    type: input.type || 'text',
                    id: input.id,
                    className: input.className,
                    placeholder: input.placeholder,
                    name: input.name
                });
            }
        });

        return elements;
    }

    isInputElement(element) {
        if (!element) return false;

        const tagName = element.tagName.toLowerCase();
        const inputTypes = ['text', 'number', 'search', 'tel', 'url', 'email', 'password', ''];

        return (
            tagName === 'input' && inputTypes.includes(element.type || '') ||
            tagName === 'textarea' ||
            element.contentEditable === 'true'
        );
    }

    isElementVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.offsetWidth > 0 &&
            element.offsetHeight > 0
        );
    }

    setElementValue(element, value) {
        // Save original value
        const originalValue = element.value;

        // Set the value directly
        element.value = value;

        // Trigger input events to notify React/Angular/Vue frameworks
        const events = [
            new Event('input', { bubbles: true }),
            new Event('change', { bubbles: true }),
            new Event('keyup', { bubbles: true }),
            new Event('blur', { bubbles: true })
        ];

        events.forEach(event => {
            try {
                element.dispatchEvent(event);
            } catch (error) {
                console.warn('Error dispatching event:', error);
            }
        });

        // Focus the element to ensure it's active
        try {
            element.focus();
        } catch (error) {
            console.warn('Error focusing element:', error);
        }

        console.log(`Value injected: "${originalValue}" -> "${value}"`);
    }

    simulateTyping(element, text) {
        // Simulate individual keystrokes for better compatibility
        element.focus();

        const events = [];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const keyCode = char.charCodeAt(0);

            events.push(
                new KeyboardEvent('keydown', { 
                    key: char, 
                    keyCode: keyCode, 
                    bubbles: true, 
                    isTrusted: false 
                }),
                new KeyboardEvent('keypress', { 
                    key: char, 
                    keyCode: keyCode, 
                    bubbles: true, 
                    isTrusted: false 
                }),
                new KeyboardEvent('keyup', { 
                    key: char, 
                    keyCode: keyCode, 
                    bubbles: true, 
                    isTrusted: false 
                })
            );
        }

        // Dispatch events with small delays
        let delay = 0;
        events.forEach(event => {
            setTimeout(() => {
                try {
                    element.dispatchEvent(event);
                } catch (error) {
                    console.warn('Error dispatching typing event:', error);
                }
            }, delay);
            delay += 10;
        });
    }

    simulateEnterKey(element) {
        const enterEvents = [
            new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
            new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }),
            new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true })
        ];

        enterEvents.forEach(event => {
            try {
                element.dispatchEvent(event);
            } catch (error) {
                console.warn('Error dispatching Enter key event:', error);
            }
        });

        // Also try triggering form submission
        const form = element.closest('form');
        if (form) {
            try {
                form.dispatchEvent(new Event('submit', { bubbles: true }));
            } catch (error) {
                console.warn('Error dispatching form submit event:', error);
            }
        }
    }
}

// Initialize content script
const posContentScript = new POSContentScript();

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    if (posContentScript.domObserver) {
        posContentScript.domObserver.disconnect();
    }
});
