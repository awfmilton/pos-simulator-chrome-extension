// content-script.js

// 1. Inject the interceptor script into the main world
function injectScript(filePath) {
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', filePath);
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => {
        script.remove(); // Clean up the DOM after execution
    };
    console.log('[CS] Injected script:', filePath);
}

injectScript(chrome.runtime.getURL('interceptor.js'));

// 2. Listen for messages from the injected script (main world)
window.addEventListener('message', (event) => {
    // We only accept messages from ourselves
    if (event.source !== window || !event.data.type) {
        return;
    }

    if (event.data.type === 'POS_SIMULATOR_RAW_DATA') {
        console.log('[CS] Received data from interceptor:', event.data.source);
        // 3. Forward the message to the service worker
        chrome.runtime.sendMessage({
            type: 'RAW_DATA_FROM_PAGE', // Use a new message type
            source: event.data.source,
            payload: event.data.payload
        }).catch(error => {
            console.error('[CS] Error sending message to service worker:', error);
        });
    }
}, false);


// --- All the existing DOM interaction logic remains below ---

class POSContentScript {
    constructor() {
        this.lastFocusedElement = null;
        this.init();
    }

    init() {
        console.log('[CS] POSContentScript part loaded.');
        this.setupMessageListener();
        this.trackFocusedElements();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });
    }

    trackFocusedElements() {
        document.addEventListener('focusin', (event) => {
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                this.lastFocusedElement = event.target;
            }
        }, true);
    }

    handleMessage(request, sender, sendResponse) {
        if (request.action === 'INJECT_INPUT') {
            this.injectInput(request.data);
            sendResponse({ success: true });
        }
    }

    injectInput(data) {
        console.log('[CS] Attempting to inject input:', data);
        const targetElement = this.findTargetElement(data.type);

        if (!targetElement) {
            console.error('[CS] INJECTION FAILED: No suitable target element found for input injection.');
            return false;
        }

        console.log('[CS] Injecting input into:', targetElement);

        targetElement.value = data.value;
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));

        if (data.simulateEnter) {
            setTimeout(() => {
                 targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 100);
        }
        return true;
    }

    findTargetElement(inputType) {
        console.log('[CS] Finding target element for input type:', inputType);
        const strategies = [
            { name: 'lastFocusedElement', fn: () => this.lastFocusedElement },
            { name: 'activeElement', fn: () => document.activeElement },
            { name: 'findByInputType', fn: () => this.findByInputType(inputType) },
            { name: 'findFirstVisibleInput', fn: () => this.findFirstVisibleInput() }
        ];

        for (const strategy of strategies) {
            const element = strategy.fn();
            console.log(`[CS] Trying strategy '${strategy.name}': found element`, element);
            if (element && this.isInputElement(element) && this.isElementVisible(element)) {
                console.log(`[CS] Strategy '${strategy.name}': SUCCESS. Using element:`, element);
                return element;
            }
        }
        console.warn('[CS] All target-finding strategies failed.');
        return null;
    }

    isInputElement(element) {
        if (!element) return false;
        const tagName = element.tagName.toLowerCase();
        const inputTypes = ['text', 'number', 'search', 'tel', 'url', 'email', 'password', ''];
        return (
            (tagName === 'input' && inputTypes.includes(element.type || '')) ||
            tagName === 'textarea' ||
            element.isContentEditable
        );
    }

    isElementVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetWidth > 0 && element.offsetHeight > 0;
    }

    findByInputType(inputType) {
        const typeMap = {
            'barcode': ['barcode', 'scan', 'product', 'sku', 'item'],
            'msr': ['card', 'magnetic', 'stripe', 'msr', 'payment'],
            'general': ['input', 'data', 'value']
        };
        const keywords = typeMap[inputType] || typeMap['general'];
        for (const keyword of keywords) {
            const selectors = [
                `input[placeholder*="${keyword}" i]`,
                `input[id*="${keyword}" i]`,
                `input[name*="${keyword}" i]`,
                `input[class*="${keyword}" i]`,
                `textarea[placeholder*="${keyword}" i]`,
                `textarea[id*="${keyword}" i]`,
                `textarea[name*="${keyword}" i]`,
                `textarea[class*="${keyword}" i]`
            ];
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && this.isElementVisible(element)) {
                    console.log(`[CS] Found element with selector '${selector}' via keyword '${keyword}'`);
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
}

new POSContentScript();
