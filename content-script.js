/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
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
            if (request.action === 'UPDATE_SCALE_ON_PAGE') {
                this.updateScaleOnPage(request.data);
            }
            if (request.action === 'NFC_PAYMENT') {
                this.handleNFCPayment(request.data);
            }
            if (request.action === 'CHIP_INSERT') {
                this.handleChipInsert(request.data);
            }
            if (request.action === 'CHIP_REMOVE') {
                this.handleChipRemove(request.data);
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
            if (!event.data || !event.data.type) return;

            const t = event.data.type;
            // Route simulator events perfectly without mutating them
            if (t.startsWith('POS_SIMULATOR') || t === 'NETWORK_INTERCEPT' || t === 'HARDWARE_COMMAND') {
                if (this.port) {
                    this.port.postMessage(event.data);
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
        console.log('[CS] Injecting input:', data);
        
        switch (data.type) {
            case 'barcode':
                this.injectBarcodeInput(data);
                break;
            case 'keyboard':
                this.injectKeyboardInput(data);
                break;
            case 'msr':
                this.injectMSRInput(data);
                break;
            case 'nfc':
                this.injectNFCInput(data);
                break;
            case 'chip_insert':
            case 'chip_remove':
                this.injectChipInput(data);
                break;
            default:
                this.injectLegacyInput(data);
        }
    }

    injectBarcodeInput(data) {
        const targetElement = this.findTargetElement('barcode');
        if (!targetElement) {
            console.error('[CS] BARCODE INJECTION FAILED: No suitable target element found.');
            return;
        }
        
        targetElement.value = data.value;
        this.dispatchInputEvents(targetElement);
        
        if (data.simulateEnter) {
            setTimeout(() => {
                targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 100);
        }
    }

    injectKeyboardInput(data) {
        const targetElement = this.findTargetElement('keyboard') || document.activeElement;
        if (!targetElement || !this.isInputElement(targetElement)) {
            console.error('[CS] KEYBOARD INJECTION FAILED: No suitable target element found.');
            return;
        }

        // Simulate actual keyboard event
        const keyEvent = new KeyboardEvent('keydown', {
            key: data.keyData.key,
            code: data.keyData.code,
            keyCode: data.keyData.keyCode,
            which: data.keyData.which,
            shiftKey: data.keyData.shiftKey,
            ctrlKey: data.keyData.ctrlKey,
            altKey: data.keyData.altKey,
            metaKey: data.keyData.metaKey,
            bubbles: true,
            cancelable: true
        });

        targetElement.dispatchEvent(keyEvent);

        // For printable characters, also update the value
        if (data.keyData.key.length === 1) {
            const currentPos = targetElement.selectionStart || 0;
            const currentValue = targetElement.value || '';
            const newValue = currentValue.slice(0, currentPos) + data.keyData.key + currentValue.slice(currentPos);
            
            targetElement.value = newValue;
            targetElement.setSelectionRange(currentPos + 1, currentPos + 1);
            this.dispatchInputEvents(targetElement);
        }
    }

    injectMSRInput(data) {
        // Try to find MSR-specific inputs first
        let track1Element = document.querySelector('input[name*="track1"], input[id*="track1"], input[placeholder*="track1"]');
        let track2Element = document.querySelector('input[name*="track2"], input[id*="track2"], input[placeholder*="track2"]');
        
        // If no specific MSR inputs found, use the general target element
        if (!track1Element && !track2Element) {
            const targetElement = this.findTargetElement('msr');
            if (targetElement && data.track2) {
                // For general POS systems, usually track2 is sufficient
                targetElement.value = data.track2;
                this.dispatchInputEvents(targetElement);
                return;
            }
        }

        // Inject track data into specific fields
        if (track1Element && data.track1) {
            track1Element.value = data.track1;
            this.dispatchInputEvents(track1Element);
        }
        
        if (track2Element && data.track2) {
            track2Element.value = data.track2;
            this.dispatchInputEvents(track2Element);
        }

        // Dispatch custom MSR event for advanced POS systems
        window.dispatchEvent(new CustomEvent('pos-msr-swipe', {
            detail: {
                track1: data.track1,
                track2: data.track2,
                timestamp: data.timestamp
            }
        }));
    }

    injectNFCInput(data) {
        // Dispatch NFC tap event for POS systems
        window.dispatchEvent(new CustomEvent('pos-nfc-tap', {
            detail: {
                cardData: data.cardData,
                timestamp: data.timestamp,
                applicationId: data.cardData.applicationId,
                transactionCounter: data.cardData.transactionCounter
            }
        }));

        // Also try to inject into payment fields if available
        const amountElement = document.querySelector('input[name*="amount"], input[id*="amount"], input[type="number"]');
        if (amountElement && !amountElement.value) {
            // Don't override existing amounts, just trigger the NFC event
            console.log('[CS] NFC tap simulated for payment terminal detection');
        }
    }

    injectChipInput(data) {
        const eventType = data.type === 'chip_insert' ? 'pos-chip-insert' : 'pos-chip-remove';
        
        window.dispatchEvent(new CustomEvent(eventType, {
            detail: {
                cardData: data.cardData,
                timestamp: data.timestamp,
                cryptogram: data.cardData?.cryptogram
            }
        }));

        console.log(`[CS] ${eventType} event dispatched`);
    }

    injectLegacyInput(data) {
        // Fallback to original injection method for backward compatibility
        const targetElement = this.findTargetElement(data.type);
        if (!targetElement) {
            console.error('[CS] LEGACY INJECTION FAILED: No suitable target element found.');
            return;
        }
        
        targetElement.value = data.value;
        this.dispatchInputEvents(targetElement);
        
        if (data.simulateEnter) {
            setTimeout(() => {
                targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 100);
        }
    }

    dispatchInputEvents(element) {
        // Dispatch all necessary events for framework compatibility
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
        // For React and other frameworks
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, element.value);
        }
        
        element.dispatchEvent(new Event('input', { bubbles: true }));
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

    updateScaleOnPage(data) {
        window.postMessage({
            type: 'UPDATE_SCALE_VARIABLES',
            ...data
        }, '*');
    }

    // ===== NEW PAYMENT HANDLERS =====
    
    handleNFCPayment(data) {
        console.log('[CS] Handling NFC payment broadcast:', data);
        
        // Broadcast NFC event to page context for payment terminal emulation
        window.postMessage({
            type: 'POS_NFC_DETECTED',
            cardData: data,
            timestamp: Date.now()
        }, '*');
        
        // Also dispatch as custom event
        window.dispatchEvent(new CustomEvent('pos-nfc-payment-detected', {
            detail: data
        }));
    }

    handleChipInsert(data) {
        console.log('[CS] Handling chip insert broadcast:', data);
        
        // Broadcast chip insert event to page context
        window.postMessage({
            type: 'POS_CHIP_INSERTED',
            cardData: data,
            timestamp: Date.now()
        }, '*');
        
        // Dispatch as custom event
        window.dispatchEvent(new CustomEvent('pos-chip-card-inserted', {
            detail: data
        }));
    }

    handleChipRemove(data) {
        console.log('[CS] Handling chip remove broadcast:', data);
        
        // Broadcast chip remove event to page context
        window.postMessage({
            type: 'POS_CHIP_REMOVED',
            timestamp: Date.now()
        }, '*');
        
        // Dispatch as custom event
        window.dispatchEvent(new CustomEvent('pos-chip-card-removed', {
            detail: data
        }));
    }
}

// Inject the interceptor first
injectScript(chrome.runtime.getURL('interceptor.js'));
// Then initialize the content script logic
new POSContentScript();
