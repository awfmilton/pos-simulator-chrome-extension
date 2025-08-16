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

class POSContentScript {
    constructor() {
        this.lastFocusedElement = null;
        this.port = null;
        this.init();
    }

    init() {
        this.connectToServiceWorker();
        this.trackFocusedElements();
        this.setupWindowListener();
    }

    connectToServiceWorker() {
        this.port = chrome.runtime.connect({ name: 'content-script' });
        console.log('[CS] Attempting to connect to service worker...');

        this.port.onMessage.addListener((request) => {
            if (request.action === 'INJECT_INPUT') {
                this.injectInput(request.data);
            }
        });

        this.port.onDisconnect.addListener(() => {
            console.error('[CS] Disconnected from service worker. Attempting to reconnect in 5 seconds...');
            this.port = null;
            setTimeout(() => this.connectToServiceWorker(), 5000);
        });
    }

    setupWindowListener() {
        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data.type) {
                return;
            }

            if (event.data.type === 'POS_SIMULATOR_RAW_DATA') {
                if (this.port) {
                    try {
                        this.port.postMessage({
                            type: 'RAW_DATA_FROM_PAGE',
                            source: event.data.source,
                            payload: event.data.payload,
                            deviceType: event.data.deviceType,
                            brand: event.data.brand // Forward the brand
                        });
                    } catch (error) {
                        console.error('[CS] Error posting message to service worker port:', error);
                    }
                } else {
                    console.warn('[CS] Port not connected. Cannot send message:', event.data);
                }
            }
        }, false);
    }

    trackFocusedElements() {
        document.addEventListener('focusin', (event) => {
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                this.lastFocusedElement = event.target;
            }
        }, true);
    }

    injectInput(data) {
        const targetElement = this.findTargetElement(data.type);
        if (!targetElement) {
            console.error('[CS] INJECTION FAILED: No suitable target element found.');
            return;
        }
        targetElement.value = data.value;
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        if (data.simulateEnter) {
            setTimeout(() => {
                 targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 100);
        }
    }

    findTargetElement(inputType) {
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

    isInputElement(element) {
        if (!element) return false;
        const tagName = element.tagName.toLowerCase();
        const inputTypes = ['text', 'number', 'search', 'tel', 'url', 'email', 'password', ''];
        return (tagName === 'input' && inputTypes.includes(element.type || '')) || tagName === 'textarea' || element.isContentEditable;
    }

    isElementVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetWidth > 0 && element.offsetHeight > 0;
    }

    findByInputType(inputType) {
        const keywords = {
            'barcode': ['barcode', 'scan', 'product', 'sku', 'item'],
            'msr': ['card', 'magnetic', 'stripe', 'msr', 'payment'],
            'general': ['input', 'data', 'value']
        }[inputType] || ['input'];
        for (const keyword of keywords) {
            const selector = `input[placeholder*="${keyword}" i], input[id*="${keyword}" i], input[name*="${keyword}" i], textarea[placeholder*="${keyword}" i]`;
            const element = document.querySelector(selector);
            if (element && this.isElementVisible(element)) return element;
        }
        return null;
    }

    findFirstVisibleInput() {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea');
        return Array.from(inputs).find(input => this.isElementVisible(input) && !input.disabled && !input.readOnly);
    }
}

// Inject the interceptor first
injectScript(chrome.runtime.getURL('interceptor.js'));
// Then initialize the content script logic
new POSContentScript();
