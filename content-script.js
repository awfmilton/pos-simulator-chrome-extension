// --- WebUSB Interception Logic ---
(function() {
    // --- Polyfill and Intercept WebUSB ---
    console.log('[CS] Setting up WebUSB interception...');
    if (!navigator.usb) {
        console.log('[CS] Polyfilling navigator.usb');
        navigator.usb = {};
    }

    const fakeDevice = {
        vendorId: 0x04b8, // Epson
        productId: 0x0202, // TM-T20II
        productName: 'Virtual ESC/POS Printer',
        manufacturerName: 'POS Simulator',
        serialNumber: '1234567890',
        opened: false,

        open: async function() {
            console.log('[CS-USB] FAKE.open() called');
            this.opened = true;
            return Promise.resolve();
        },

        close: async function() {
            console.log('[CS-USB] FAKE.close() called');
            this.opened = false;
            return Promise.resolve();
        },

        selectConfiguration: async function(configValue) {
            console.log(`[CS-USB] FAKE.selectConfiguration(${configValue}) called`);
            return Promise.resolve();
        },

        claimInterface: async function(interfaceNumber) {
            console.log(`[CS-USB] FAKE.claimInterface(${interfaceNumber}) called`);
            return Promise.resolve();
        },

        transferOut: async function(endpointNumber, data) {
            console.log(`[CS-USB-LOG] Step 3: transferOut called with ${data.byteLength} bytes.`);
            const payloadArray = Array.from(new Uint8Array(data));

            console.log('[CS-USB-LOG] Step 4: Sending RAW_ESCPOS_DATA to service worker.');
            chrome.runtime.sendMessage({
                type: 'RAW_ESCPOS_DATA',
                payload: payloadArray
            }).catch(error => console.error('[CS-USB-LOG] Error sending print data to service worker:', error));

            return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
        },

        // Add other required methods to avoid errors
        releaseInterface: async function(interfaceNumber) {
            console.log(`[CS-USB] FAKE.releaseInterface(${interfaceNumber}) called`);
            return Promise.resolve();
        },

        reset: async function() {
            console.log(`[CS-USB] FAKE.reset() called`);
            return Promise.resolve();
        }
    };

    // Store original function
    const originalRequestDevice = navigator.usb.requestDevice.bind(navigator.usb);

    // Override requestDevice
    navigator.usb.requestDevice = function(options) {
        console.log('[CS-USB-LOG] Step 1: Intercepted navigator.usb.requestDevice call.');
        console.log('[CS-USB-LOG] Step 2: Returning fake USB device.');
        // Immediately resolve with the fake device, bypassing the dialog
        return Promise.resolve(fakeDevice);
    };

    console.log('[CS] WebUSB API (requestDevice) has been intercepted.');


    // --- Polyfill and Intercept WebSerial ---
    console.log('[CS] Setting up WebSerial interception...');
    if (!navigator.serial) {
        console.log('[CS] Polyfilling navigator.serial');
        navigator.serial = {};
    }
    const fakeSerialPort = {
            getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
            opened: false,
            writable: null,
            readable: null,

            open: async function(options) {
                console.log('[CS-Serial] FAKE.open() called with options:', options);
                this.opened = true;

                this.writable = new WritableStream({
                    write(chunk) {
                        console.log(`[CS-Serial-LOG] Step 3: WritableStream.write called with ${chunk.byteLength} bytes.`);
                        const payloadArray = Array.from(new Uint8Array(chunk));

                        console.log('[CS-Serial-LOG] Step 4: Sending RAW_SERIAL_DATA to service worker.');
                        chrome.runtime.sendMessage({
                            type: 'RAW_SERIAL_DATA',
                            payload: payloadArray
                        }).catch(error => console.error('[CS-Serial-LOG] Error sending serial data:', error));
                    },
                    close() {
                        console.log('[CS-Serial] FAKE WritableStream closed.');
                    },
                    abort(err) {
                        console.error('[CS-Serial] FAKE WritableStream aborted:', err);
                    }
                });

                this.readable = new ReadableStream({
                    start(controller) {
                        console.log('[CS-Serial] FAKE ReadableStream started.');
                    }
                });

                return Promise.resolve();
            },

            close: async function() {
                console.log('[CS-Serial] FAKE.close() called');
                this.opened = false;
                if (this.writable) this.writable.close().catch(()=>{});
                if (this.readable) this.readable.cancel().catch(()=>{});
                this.writable = null;
                this.readable = null;
                return Promise.resolve();
            }
        };

        navigator.serial.requestPort = async (options) => {
            console.log('[CS-Serial-LOG] Step 1: Intercepted navigator.serial.requestPort call.');
            console.log('[CS-Serial-LOG] Step 2: Returning fake SerialPort.');
            return Promise.resolve(fakeSerialPort);
        };

        console.log('[CS] WebSerial API (requestPort) has been intercepted.');
    }
    // --- End of WebSerial Interception ---

    // --- Polyfill and Intercept Web Bluetooth ---
    console.log('[CS] Setting up Web Bluetooth interception...');
    if (!navigator.bluetooth) {
        console.log('[CS] Polyfilling navigator.bluetooth');
        navigator.bluetooth = {};
    }
    const fakeCharacteristic = {
            writeValue: async function(value) {
                console.log(`[CS-BT-LOG] Step 3: Characteristic.writeValue called with ${value.byteLength} bytes.`);
                const payloadArray = Array.from(new Uint8Array(value));

                console.log('[CS-BT-LOG] Step 4: Sending RAW_BLUETOOTH_DATA to service worker.');
                chrome.runtime.sendMessage({
                    type: 'RAW_BLUETOOTH_DATA',
                    payload: payloadArray
                }).catch(error => console.error('[CS-BT-LOG] Error sending bluetooth data:', error));
                return Promise.resolve();
            }
        };

        const fakeService = {
            getCharacteristic: async function(characteristic) {
                console.log('[CS-BT] FAKE Service.getCharacteristic called with:', characteristic);
                return Promise.resolve(fakeCharacteristic);
            }
        };

        const fakeServer = {
            connected: false,
            connect: async function() {
                console.log('[CS-BT] FAKE Server.connect called');
                this.connected = true;
                return Promise.resolve(this);
            },
            getPrimaryService: async function(service) {
                console.log('[CS-BT] FAKE Server.getPrimaryService called with:', service);
                return Promise.resolve(fakeService);
            },
            disconnect: function() {
                console.log('[CS-BT] FAKE Server.disconnect called');
                this.connected = false;
            }
        };

        const fakeBluetoothDevice = {
            id: 'FAKE_BT_DEVICE_ID',
            name: 'Virtual Bluetooth Printer',
            gatt: fakeServer,
        };

        navigator.bluetooth.requestDevice = async (options) => {
            console.log('[CS-BT-LOG] Step 1: Intercepted navigator.bluetooth.requestDevice call.');
            console.log('[CS-BT-LOG] Step 2: Returning fake BluetoothDevice.');
            return Promise.resolve(fakeBluetoothDevice);
        };

        console.log('[CS] Web Bluetooth API (requestDevice) has been intercepted.');
    }
    // --- End of Web Bluetooth Interception ---

})();
// --- End of WebUSB Interception ---


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
        console.log('[CS] POS Peripheral Simulator Content Script loaded on', window.location.href);

        this.setupMessageListener();
        this.setupDOMObserver();
        this.trackFocusedElements();

        // Notify service worker that content script is ready
        chrome.storage.local.get('posSimulatorSettings', (result) => {
            const settings = result.posSimulatorSettings || {};
            if (!settings.targetUrl || window.location.href.startsWith(settings.targetUrl)) {
                console.log('[CS] Page matches target URL, notifying service worker.');
                chrome.runtime.sendMessage({
                    action: 'CONTENT_SCRIPT_READY',
                    url: window.location.href
                }).catch((error) => {
                    console.warn('[CS] Could not notify service worker, it might not be ready yet.', error);
                });
            } else {
                console.log('[CS] Page does not match target URL, running in idle mode.');
            }
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
                console.log('[CS] Focused element updated:', event.target);
            }
        }, true);
    }

    scanForInputElements(container) {
        // console.log('[CS] Scanning for input elements in:', container);
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
                    console.log('[CS] Registered input element:', element);
                }
            });
        });
    }

    handleMessage(request, sender, sendResponse) {
        try {
            console.log('[CS] Received message:', request);

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
                    console.warn('[CS] Unknown content script action:', request.action);
            }

            sendResponse({ success: true });
        } catch (error) {
            console.error('[CS] Error in content script:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    injectInput(data) {
        console.log('[CS] Attempting to inject input:', data);
        const targetElement = this.findTargetElement(data.type);

        if (!targetElement) {
            console.warn('[CS] No suitable target element found for input injection.');
            return false;
        }

        console.log('[CS] Injecting input into:', targetElement);

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
                console.warn('[CS] Error dispatching event:', error);
            }
        });

        // Focus the element to ensure it's active
        try {
            element.focus();
        } catch (error) {
            console.warn('[CS] Error focusing element:', error);
        }

        console.log(`[CS] Value injected: "${originalValue}" -> "${value}"`);
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
