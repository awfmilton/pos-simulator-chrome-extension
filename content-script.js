/*
 * tbay.tk Virtual Peripheral Simulator
 * Developed by: Alexander Milton — https://tbay.tk
 */
// content-script.js

// ── Verbose-logging gate ─────────────────────────────────────────────────────
// Traces are gated behind the operator's debug toggle (terminal_debug_enabled
// in the POS page's localStorage). console.warn/error are never gated.
function _csDebug() {
    try { return localStorage.getItem('terminal_debug_enabled') === '1'; }
    catch (e) { return false; }
}
function dlog(...args) { if (_csDebug()) console.log(...args); }

// 1. Inject the interceptor script into the main world
function injectScript(filePath) {
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', filePath);
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => {
        script.remove(); // Clean up the DOM after execution
    };
    dlog('[CS] Injected script:', filePath);
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
        // If the extension was reloaded/updated, chrome.runtime is invalidated
        // and connect() throws synchronously. Guard it so the reconnect loop
        // survives, and stop retrying only when the context is truly dead.
        if (!chrome.runtime || !chrome.runtime.id) {
            console.warn('[CS] Extension context invalidated — stopping reconnect until page reload.');
            return;
        }
        try {
            this.port = chrome.runtime.connect({ name: 'content-script' });
        } catch (e) {
            console.warn('[CS] connect() failed, retrying in 5s:', e && e.message);
            this.port = null;
            setTimeout(() => this.connectToServiceWorker(), 5000);
            return;
        }
        dlog('[CS] Attempting to connect to service worker...');

        // Immediately broadcast current POS terminal state so the side panel
        // can update the status light if it was already open before this page loaded.
        this._broadcastTerminalState();
        // And announce that this tab is a POS page (drives autodetect green light).
        this._announcePosPage();

        this.port.onMessage.addListener((request) => {
            if (request.action === 'INJECT_INPUT') {
                this.injectInput(request.data);
            }
            if (request.action === 'UPDATE_SCALE_ON_PAGE') {
                this.updateScaleOnPage(request.data);
            }
            if (request.action === 'UPDATE_DISPLAY_ON_PAGE') {
                this.updateDisplayOnPage(request.data);
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
            // ── Terminal simulator response ───────────────────────────────────
            // Sent by service-worker when the panel operator clicks Approve/Decline/Timeout.
            // Re-broadcast to the POS page so TerminalBridge.js can resolve/reject.
            if (request.type === 'TERMINAL_SIMULATE_RESPONSE') {
                dlog('[CS] Relaying TERMINAL_SIMULATE_RESPONSE to page:', request);
                window.postMessage({
                    type:      'POS_TERMINAL_CHARGE_RESPONSE',
                    outcome:   request.outcome,
                    method:    request.method,
                    reference: request.reference,
                    gateway:   request.gateway,
                    brand:     request.brand,
                    reason:    request.reason ?? null,
                    requestId: request.requestId,
                    timestamp: request.timestamp,
                }, '*');
            }
            // ── Square POS API (App-Switch) mock: relay response to POS page ──
            // The side panel sends SQUARE_POS_MOCK_RESPONSE after the operator
            // approves/declines. Relay it to the page so SquarePOSForm.vue can
            // resolve the pending mock flow.
            if (request.type === 'SQUARE_POS_MOCK_RESPONSE') {
                window.postMessage({
                    type:                  'POS_SQUARE_POS_MOCK_RESPONSE',
                    nonce:                 request.nonce,
                    outcome:               request.outcome,
                    transaction_id:        request.transaction_id,
                    client_transaction_id: request.client_transaction_id,
                    error_code:            request.error_code,
                    error_description:     request.error_description,
                }, '*');
            }
            // ── SW requests current terminal state (e.g. when side panel connects) ─
            if (request.type === 'REQUEST_TERMINAL_STATE') {
                this._broadcastTerminalState();
                this._announcePosPage(); // re-assert POS detection so the light goes green on panel open
            }
        });

        this.port.onDisconnect.addListener(() => {
            console.error('[CS] Disconnected from service worker. Attempting to reconnect in 5 seconds...');
            this.port = null;
            setTimeout(() => this.connectToServiceWorker(), 5000);
        });
    }

    /**
     * Detect whether this page is a tbay.tk POS and, if so, tell the service
     * worker so the panel connection indicator can go green automatically —
     * without the operator having to type a target URL. We're in the isolated
     * world (can't read window.tbayApp directly), so we detect via stable,
     * page-set markers readable from the DOM:
     *   • <html data-tbay-pos> / <body data-tbay-pos>  (explicit marker)
     *   • <div id="app"> plus a document title containing "tbay"/"POS"   (fallback)
     */
    _isPosPage() {
        try {
            const de = document.documentElement;
            if (de && (de.hasAttribute('data-tbay-pos') || de.hasAttribute('data-pos-app'))) return true;
            if (document.body && document.body.hasAttribute('data-tbay-pos')) return true;
            const hasApp = !!document.getElementById('app');
            const title = (document.title || '').toLowerCase();
            if (hasApp && (title.includes('tbay') || title.includes('pos'))) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    /** Tell the SW this tab is (or isn't) a POS page, so it can drive the light. */
    _announcePosPage() {
        if (!this.port) return;
        const isPos = this._isPosPage();
        try {
            this.port.postMessage({
                type: 'POS_PAGE_DETECTED',
                isPos,
                url: window.location.href,
            });
        } catch (e) { /* port may have closed */ }
        // If the POS app mounts slightly after document_idle, re-check shortly.
        if (!isPos && !this._posRecheckDone) {
            this._posRecheckDone = true;
            setTimeout(() => {
                if (this.port && this._isPosPage()) {
                    try {
                        this.port.postMessage({ type: 'POS_PAGE_DETECTED', isPos: true, url: window.location.href });
                    } catch (e) { /* noop */ }
                }
            }, 2500);
        }
    }

    /** Read current terminal settings from localStorage and send to SW. */
    _broadcastTerminalState() {
        if (!this.port) return;
        this.port.postMessage({
            type:       'TERMINAL_READY_SIGNAL',
            enabled:    localStorage.getItem('terminalEnabled') === '1',
            brand:      localStorage.getItem('terminalBrand') || 'stripe',
            debug:      localStorage.getItem('terminal_debug_enabled') === '1',
            terminalIp: localStorage.getItem('terminal_ip_address') || '',
        });
    }

    setupWindowListener() {
        window.addEventListener('message', (event) => {
            // Trust boundary: only accept messages posted by THIS page's own JS,
            // same-origin, in the top frame. This rejects forged messages from
            // cross-origin iframes/embedded ads that could otherwise drive the
            // terminal simulator or spoof the connection state. The manifest
            // already scopes the content script to the POS origins, but this is
            // defence-in-depth against in-page third-party frames.
            if (event.source !== window) return;
            if (event.origin !== window.location.origin) return;
            if (!event.data || !event.data.type) return;

            const t = event.data.type;
            // Route simulator events without mutating them
            if (t.startsWith('POS_SIMULATOR') || t === 'NETWORK_INTERCEPT' || t === 'HARDWARE_COMMAND') {
                if (this.port) {
                    this.port.postMessage(event.data);
                }
            }

            // ── Terminal Bridge: forward charge requests to the extension ────
            // TerminalBridge.js posts POS_TERMINAL_CHARGE_REQUEST to window.
            // We forward it to the service worker, which relays it to the panel.
            if (t === 'POS_TERMINAL_CHARGE_REQUEST') {
                dlog('[CS] Forwarding POS_TERMINAL_CHARGE_REQUEST to SW:', event.data);
                if (this.port) {
                    this.port.postMessage({
                        type:      'TERMINAL_CHARGE_REQUEST',
                        requestId: event.data.requestId ?? ('req_' + Date.now()),
                        gateway:   event.data.gateway,
                        amount:    event.data.amount,
                        currency:  event.data.currency,
                        orderId:   event.data.orderId,
                        timestamp: event.data.timestamp,
                    });
                } else {
                    console.warn('[CS] Cannot forward charge request — not connected to SW.');
                }
            }

            // ── Square POS API (App-Switch) mock: forward charge request ────
            // SquarePOSForm.vue posts POS_SQUARE_POS_MOCK_REQUEST when in mock mode.
            // We forward it to the service worker, which relays it to the side panel.
            if (t === 'POS_SQUARE_POS_MOCK_REQUEST') {
                if (this.port) {
                    this.port.postMessage({
                        type:        'SQUARE_POS_MOCK_REQUEST',
                        nonce:       event.data.nonce,
                        amount:      event.data.amount,
                        currency:    event.data.currency,
                        callbackUrl: event.data.callbackUrl,
                        timestamp:   event.data.timestamp,
                    });
                } else {
                    console.warn('[CS] Cannot forward Square POS mock request — not connected to SW.');
                }
            }

            // ── Terminal Bridge: cancel signal ───────────────────────────────
            if (t === 'POS_TERMINAL_CHARGE_CANCEL') {
                dlog('[CS] Forwarding POS_TERMINAL_CHARGE_CANCEL to SW.');
                if (this.port) {
                    this.port.postMessage({ type: 'TERMINAL_CHARGE_CANCEL', timestamp: event.data.timestamp });
                }
            }

            // ── Terminal Bridge: POS ready / handshake signal ────────────────
            // Sent by TerminalConnectionCard whenever settings change, and by
            // BaseTerminalBridge on initial load.  Forwarded to the extension
            // side panel so it can update the connection status light.
            if (t === 'POS_TERMINAL_READY') {
                dlog('[CS] Forwarding POS_TERMINAL_READY to SW:', event.data);
                if (this.port) {
                    this.port.postMessage({
                        type:       'TERMINAL_READY_SIGNAL',
                        enabled:    event.data.enabled,
                        brand:      event.data.brand,
                        debug:      event.data.debug,
                        terminalIp: event.data.terminalIp,
                    });
                } else {
                    console.warn('[CS] Cannot forward POS_TERMINAL_READY — not connected to SW.');
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
        dlog('[CS] Injecting input:', data);
        
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
        if (!data || !data.keyData || typeof data.keyData.key !== 'string') {
            console.error('[CS] KEYBOARD INJECTION FAILED: malformed keyData payload.');
            return;
        }
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
            const currentValue = targetElement.value || '';
            // selectionStart is null on number/email inputs — fall back to end.
            const currentPos = (targetElement.selectionStart != null)
                ? targetElement.selectionStart
                : currentValue.length;
            const newValue = currentValue.slice(0, currentPos) + data.keyData.key + currentValue.slice(currentPos);

            targetElement.value = newValue;
            // setSelectionRange throws on input types that don't support selection
            // (number, email, etc.) — guard it.
            try { targetElement.setSelectionRange(currentPos + 1, currentPos + 1); } catch (e) { /* unsupported */ }
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
        if (!data || !data.cardData) {
            console.error('[CS] NFC INJECTION FAILED: missing cardData payload.');
            return;
        }
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
            dlog('[CS] NFC tap simulated for payment terminal detection');
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

        dlog(`[CS] ${eventType} event dispatched`);
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

        // For React/Vue: invoke the correct prototype value setter for the
        // element type. Calling the HTMLInputElement setter on a <textarea> or
        // contentEditable node throws "Illegal invocation" and aborts the final
        // input event, so the framework may never register the value.
        try {
            if (element instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                if (setter) setter.call(element, element.value);
            } else if (element instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                if (setter) setter.call(element, element.value);
            }
            // contentEditable: nothing to do — its content was already set directly.
        } catch (e) {
            console.warn('[CS] value-setter invocation skipped:', e && e.message);
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

    updateDisplayOnPage(data) {
        // Relay a customer line-display update from the panel into the POS page.
        // The POS app listens for POS_LINE_DISPLAY_UPDATE (or the interceptor
        // exposes window.posLineDisplay*) to drive its on-screen display.
        window.postMessage({
            type: 'POS_LINE_DISPLAY_UPDATE',
            line1: data && data.line1 != null ? data.line1 : '',
            line2: data && data.line2 != null ? data.line2 : '',
        }, '*');
    }

    // ===== NEW PAYMENT HANDLERS =====
    
    handleNFCPayment(data) {
        dlog('[CS] Handling NFC payment broadcast:', data);
        
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
        dlog('[CS] Handling chip insert broadcast:', data);
        
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
        dlog('[CS] Handling chip remove broadcast:', data);
        
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
