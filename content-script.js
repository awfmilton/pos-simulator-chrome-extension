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

// 2. Establish a long-lived connection with the service worker
let port;

function connectToServiceWorker() {
    port = chrome.runtime.connect({ name: 'content-script' });
    console.log('[CS] Attempting to connect to service worker...');

    port.onDisconnect.addListener(() => {
        console.error('[CS] Disconnected from service worker. Attempting to reconnect in 5 seconds...');
        port = null;
        setTimeout(connectToServiceWorker, 5000); // Retry connection after a delay
    });

    // The POSContentScript class will handle incoming messages on this port
    // This is set up below.
}

// Initial connection attempt
connectToServiceWorker();


// 3. Listen for messages from the injected script (main world) and forward them
window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data.type) {
        return;
    }

    if (event.data.type === 'POS_SIMULATOR_RAW_DATA') {
        if (port) {
            try {
                // Forward the message to the service worker via the persistent port
                port.postMessage({
                    type: 'RAW_DATA_FROM_PAGE',
                    source: event.data.source,
                    payload: event.data.payload,
                    deviceType: event.data.deviceType
                });
            } catch (error) {
                console.error('[CS] Error posting message to service worker port:', error);
                // The port might have been disconnected just before the send.
                // The onDisconnect handler will attempt to reconnect.
            }
        } else {
            console.warn('[CS] Port not connected. Cannot send message:', event.data);
        }
    }
}, false);


// 4. The class for handling commands FROM the service worker remains largely the same
class POSContentScript {
    constructor() {
        this.lastFocusedElement = null;
        this.init();
    }

    init() {
        this.setupMessageListener();
        this.trackFocusedElements();
    }

    setupMessageListener() {
        // Listen for messages from the service worker (via the port or one-off messages)
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'PING') {
                sendResponse({ type: 'PONG' });
            } else if (request.action === 'INJECT_INPUT') {
                this.injectInput(request.data);
                sendResponse({ success: true });
            }
            return true;
        });

        // Also listen for messages coming through the long-lived port
        if (port) {
            port.onMessage.addListener((request) => {
                 if (request.action === 'INJECT_INPUT') {
                    this.injectInput(request.data);
                }
            });
        }
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

new POSContentScript();
