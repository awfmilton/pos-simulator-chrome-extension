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
        const target = this.lastFocusedElement || document.activeElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            target.value = data.value;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            if (data.simulateEnter) {
                target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }
        } else {
            console.warn('[CS] No focused input element found to inject data.');
        }
    }
}

new POSContentScript();
