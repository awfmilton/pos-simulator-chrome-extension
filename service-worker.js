/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
class PeripheralSimulatorService {
    constructor() {
        this.printerStates = {
            usb: { on: false, brand: 'epson' },
            bluetooth: { on: false, brand: 'epson' },
            serial: { on: false, brand: 'epson' },
            network: { on: false, brand: 'epson' }
        };
        this.sidePanelPort = null;
        this.contentScriptPorts = new Map();
        this.posUrlPattern = null;
        this.isConnected = false;
        // Holds a TERMINAL_CHARGE_REQUEST that arrived before the side panel opened.
        // Delivered immediately when the panel connects; cleared on deliver or cancel.
        this.pendingChargeRequest = null;
        // Tabs the content script has confirmed are a tbay POS page (tabId → {url}).
        // Drives autodetect: the connection light goes green whenever any of these
        // has a live content-script port, without the operator typing a target URL.
        this.posTabs = new Map();

        this.init();
    }

    init() {
        console.log('[SW] Initializing Service Worker...');
        // Listen for any new connections
        chrome.runtime.onConnect.addListener(port => {
            if (port.name === 'sidepanel') {
                this.handleSidePanelConnection(port);
            } else if (port.name === 'content-script') {
                this.handleContentScriptConnection(port);
            }
        });

        // Content-script traffic rides the long-lived ports, but two panel
        // utility scripts (virtual-keyboard.js, receipt-manager.js) still send
        // one-shot chrome.runtime.sendMessage calls — without this listener
        // those messages are silently dropped (virtual keyboard dead, email
        // receipts dead).
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            // Only accept one-shot messages from this extension's own pages
            // (the side panel). A web page cannot set sender.id to our id, so
            // this rejects any content-script/page-originated runtime message.
            if (!sender || sender.id !== chrome.runtime.id) return false;
            if (!msg || !msg.type) return false;
            if (msg.type === 'KEYBOARD_INPUT') {
                this.handleKeyboardInput(msg.data);
                return false;
            }
            if (msg.type === 'SEND_EMAIL') {
                Promise.resolve(this.handleSendEmail(msg.data))
                    .then((result) => sendResponse(result || { success: true }))
                    .catch((err) => sendResponse({ success: false, error: err && err.message }));
                return true; // keep the channel open for the async response
            }
            return false;
        });

        chrome.storage.local.get('posSimulatorSettings', (result) => {
            if (result.posSimulatorSettings) {
                this.posUrlPattern = result.posSimulatorSettings.targetUrl;
            }
        });
    }

    handleSidePanelConnection(port) {
        console.log('[SW] Side panel connected.');
        this.sidePanelPort = port;
        port.onMessage.addListener(msg => this.handlePanelMessage(msg));
        port.onDisconnect.addListener(() => {
            console.log('[SW] Side panel disconnected.');
            this.sidePanelPort = null;
        });
        this.updatePanelWithInitialState();

        // Ask all connected POS tabs to re-send their current terminal state
        // so the panel status light reflects the POS settings immediately on open.
        this.contentScriptPorts.forEach((csPort) => {
            csPort.postMessage({ type: 'REQUEST_TERMINAL_STATE' });
        });

        // Deliver any charge request that arrived before the panel was open.
        if (this.pendingChargeRequest) {
            console.log('[SW] Delivering buffered TERMINAL_CHARGE_REQUEST to newly-connected panel.');
            port.postMessage(this.pendingChargeRequest);
            this.pendingChargeRequest = null;
        }

        // Compute the connection light immediately on panel open (don't wait for
        // the 5s poll) so an already-open POS tab shows green right away. Force a
        // fresh push by clearing the change-detection cache first.
        this.isConnected = false;
        this.checkConnection();
    }

    handleContentScriptConnection(port) {
        // Defensive: only real tab-hosted content scripts should connect with
        // this name. Reject senders without a tab (devtools/other extension
        // pages) rather than throwing on port.sender.tab.id.
        const tabId = port.sender && port.sender.tab && port.sender.tab.id;
        if (tabId == null) {
            console.warn('[SW] Rejecting content-script port with no tab sender.');
            try { port.disconnect(); } catch (e) { /* noop */ }
            return;
        }
        console.log(`[SW] Content script from tab ${tabId} connected.`);
        this.contentScriptPorts.set(tabId, port);

        port.onMessage.addListener(async (msg) => {
            // ── Autodetect: content script reports whether this tab is a POS page ─
            if (msg.type === 'POS_PAGE_DETECTED') {
                if (msg.isPos) {
                    this.posTabs.set(tabId, { url: msg.url });
                    console.log(`[SW] Tab ${tabId} confirmed as POS page: ${msg.url}`);
                } else {
                    this.posTabs.delete(tabId);
                }
                this.checkConnection(); // re-evaluate the light immediately
                return;
            }
            // Route print/hardware data through handleRawData()
            if (msg.type === 'POS_SIMULATOR_RAW_DATA' || msg.type === 'RAW_DATA_FROM_PAGE') {
                console.log(`[SW] Received hardware data from content script (type: ${msg.type}, deviceType: ${msg.deviceType}, source: ${msg.source}). Routing through handleRawData().`);
                this.handleRawData(msg);
            } else if (msg.type === 'POS_SIMULATOR_DISPLAY_UPDATE') {
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage(msg);
                } else {
                    console.warn('[SW] Dropping DISPLAY_UPDATE because sidePanelPort is disconnected');
                }
            } else if (msg.type === 'TERMINAL_CHARGE_REQUEST') {
                // Forward charge request from POS page → panel terminal simulator
                console.log('[SW] TERMINAL_CHARGE_REQUEST received from content script:', msg);
                const chargePayload = {
                    type:      'TERMINAL_CHARGE_REQUEST',
                    requestId: msg.requestId,
                    gateway:   msg.gateway,
                    amount:    msg.amount,
                    currency:  msg.currency,
                    orderId:   msg.orderId,
                    timestamp: msg.timestamp,
                };
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage(chargePayload);
                } else {
                    // Buffer the request — it will be delivered when the operator opens
                    // the side panel (up to 2 minutes, the POS timeout window).
                    console.warn('[SW] No side panel connected — buffering TERMINAL_CHARGE_REQUEST until panel opens.');
                    this.pendingChargeRequest = chargePayload;
                }
            } else if (msg.type === 'SQUARE_POS_MOCK_REQUEST') {
                // Square POS API (App-Switch) mock: forward to side panel
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({
                        type:        'SQUARE_POS_MOCK_REQUEST',
                        nonce:       msg.nonce,
                        amount:      msg.amount,
                        currency:    msg.currency,
                        callbackUrl: msg.callbackUrl,
                        timestamp:   msg.timestamp,
                    });
                } else {
                    console.warn('[SW] No side panel connected — cannot deliver SQUARE_POS_MOCK_REQUEST.');
                }
            } else if (msg.type === 'TERMINAL_CHARGE_CANCEL') {
                console.log('[SW] TERMINAL_CHARGE_CANCEL received from content script.');
                this.pendingChargeRequest = null; // discard any buffered request
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({ type: 'TERMINAL_CHARGE_CANCEL' });
                }
            } else if (msg.type === 'TERMINAL_READY_SIGNAL') {
                // POS settings changed (terminal enabled/disabled, brand, IP).
                // This message only originates from a real POS page, so it also
                // confirms the tab as a POS page for the autodetect light.
                if (!this.posTabs.has(tabId)) {
                    this.posTabs.set(tabId, { url: (port.sender && port.sender.url) || null });
                    this.checkConnection();
                }
                console.log('[SW] TERMINAL_READY_SIGNAL received from content script:', msg);
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({
                        type:       'TERMINAL_READY_SIGNAL',
                        enabled:    msg.enabled,
                        brand:      msg.brand,
                        debug:      msg.debug,
                        terminalIp: msg.terminalIp,
                    });
                } else {
                    console.warn('[SW] No side panel connected — cannot deliver TERMINAL_READY_SIGNAL.');
                }
            } else {
                console.warn(`[SW] Unrecognized message type from content script: ${msg.type}`);
            }
        });

        port.onDisconnect.addListener(() => {
            console.log(`[SW] Content script from tab ${tabId} disconnected.`);
            this.contentScriptPorts.delete(tabId);
            this.posTabs.delete(tabId);
            this.checkConnection(); // recompute the light when a POS tab goes away
        });
    }


    handlePanelMessage(msg) {
        console.log('[SW] Received message from side panel:', msg);
        switch (msg.type) {
            case 'KEEP_ALIVE':
                console.log('[SW] Keep-alive signal received.');
                break;
            case 'TOGGLE_PRINTER':
                if (msg.data && msg.data.printerType) {
                    this.printerStates[msg.data.printerType].on = msg.data.isEnabled;
                    this.updatePanelWithPrinterState(msg.data.printerType);
                }
                break;
            case 'CHANGE_PRINTER_BRAND':
                if (msg.data && msg.data.printerType) {
                    this.printerStates[msg.data.printerType].brand = msg.data.brand;
                    console.log(`[SW] Printer brand for ${msg.data.printerType} set to ${msg.data.brand}`);
                }
                break;
            case 'CHECK_CONNECTION':
                this.checkConnection();
                break;
            case 'SETTINGS_UPDATED':
                if (msg.data) {
                    this.posUrlPattern = msg.data.targetUrl;
                    this.checkConnection();
                }
                break;
             case 'SCAN_BARCODE':
                if (msg.data) {
                    this.handleBarcodeScan(msg.data);
                }
                break;
            case 'UPDATE_SCALE':
                if (msg.data) {
                    this.broadcastToContentScripts({
                        action: 'UPDATE_SCALE_ON_PAGE',
                        data: msg.data
                    });
                }
                break;
            case 'UPDATE_DISPLAY':
                // Customer line-display update from the panel → POS page.
                // Mirrors UPDATE_SCALE; without this case the panel's
                // "Update/Clear Display" buttons were silently dropped.
                if (msg.data) {
                    this.broadcastToContentScripts({
                        action: 'UPDATE_DISPLAY_ON_PAGE',
                        data: msg.data
                    });
                }
                break;
            case 'KEYBOARD_INPUT':
                if (msg.data) {
                    this.handleKeyboardInput(msg.data);
                }
                break;
            case 'MSR_SWIPE':
                if (msg.data) {
                    this.handleMSRSwipe(msg.data);
                }
                break;
            case 'NFC_TAP':
                if (msg.data) {
                    this.handleNFCTap(msg.data);
                }
                break;
            case 'CHIP_INSERT':
                if (msg.data) {
                    this.handleChipInsert(msg.data);
                }
                break;
            case 'CHIP_REMOVE':
                if (msg.data) {
                    this.handleChipRemove(msg.data);
                }
                break;
            case 'SEND_EMAIL':
                if (msg.data) {
                    this.handleSendEmail(msg.data);
                }
                break;
            // ── Terminal simulator: panel → POS page ─────────────────────────
            case 'TERMINAL_SIMULATE_RESPONSE':
                // Operator clicked Approve / Decline / Timeout in the terminal panel.
                // Broadcast to all POS content-script ports so TerminalBridge.js resolves.
                console.log('[SW] Broadcasting TERMINAL_SIMULATE_RESPONSE to all content scripts:', msg);
                this.broadcastToContentScripts(msg);
                break;
            case 'SQUARE_POS_MOCK_RESPONSE':
                // Square POS API mock: panel operator approved/declined — relay to all content scripts.
                console.log('[SW] Broadcasting SQUARE_POS_MOCK_RESPONSE to all content scripts:', msg);
                this.broadcastToContentScripts(msg);
                break;
            case 'TERMINAL_CHARGE_CANCEL':
                // POS operator cancelled the pending terminal request from the panel side.
                console.log('[SW] Broadcasting TERMINAL_CHARGE_CANCEL to all content scripts.');
                this.broadcastToContentScripts({ type: 'TERMINAL_CHARGE_CANCEL' });
                break;
        }
    }

     async handleBarcodeScan(data) {
        this.injectInputToActivePage({
            type: 'barcode',
            value: data.barcode,
            // `x || true` was always true — honor the panel's checkbox instead.
            simulateEnter: data.simulateEnter === true
        });
    }

    broadcastToContentScripts(message) {
        for (const port of this.contentScriptPorts.values()) {
            try {
                port.postMessage(message);
            } catch (error) {
                console.error('[SW] Error broadcasting to content script:', error);
            }
        }
    }

    async injectInputToActivePage(data) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && this.contentScriptPorts.has(tab.id)) {
                 // Send message through the persistent port for the active tab
                 this.contentScriptPorts.get(tab.id).postMessage({
                     action: 'INJECT_INPUT',
                     data: data
                 });
            } else if (tab) {
                // Fallback to one-off message if port not found (should be rare)
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'INJECT_INPUT',
                    data: data
                });
            }
        } catch (error) {
            console.error('[SW] Error injecting input to active page:', error);
        }
    }


    handleRawData(request) {
        console.log(`[SW] Received ${request.connectionType || request.source} printer data:`, request);

        if (request.deviceType === 'printer') {
            // Map connection types to printer states
            const connectionMap = {
                'webusb': 'usb',
                'webbluetooth': 'bluetooth',
                'webserial': 'serial',
                'network': 'network'
            };

            const printerType = connectionMap[request.source] || 'usb';

            if (this.printerStates[printerType]?.on) {
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({
                        type: 'PRINT_DATA_RECEIVED',
                        payload: request.payload,
                        source: request.source,
                        deviceType: request.deviceType,
                        brand: request.brand || this.printerStates[printerType].brand,
                        model: request.model,
                        connectionType: request.connectionType,
                        contentType: request.contentType,
                        endpoint: request.endpoint
                    });
                }
            } else {
                console.log(`[SW] ${printerType} printer is disabled, ignoring data`);
            }
            return; // Done handling printer data
        }

        // Handle other device types...
        if (request.deviceType === 'cash-drawer') {
            if (this.sidePanelPort) {
                console.log('[SW] Forwarding drawer command to side panel.');
                this.sidePanelPort.postMessage({
                    type: 'DRAWER_COMMAND_RECEIVED',
                    source: request.source,
                    command: request.command || 'open',
                    drawerType: request.drawerType
                });
            }
            return;
        }

        if (request.deviceType === 'scale') {
            if (this.sidePanelPort) {
                this.sidePanelPort.postMessage({
                    type: 'SCALE_DATA_RECEIVED',
                    payload: request.payload,
                    source: request.source,
                    scaleType: request.scaleType
                });
            }
            return;
        }

        if (request.deviceType === 'line-display') {
             if (this.sidePanelPort) {
                this.sidePanelPort.postMessage({
                    type: 'PRINT_DATA_RECEIVED', // Reuse for now
                    payload: request.payload,
                    source: request.source,
                    deviceType: request.deviceType,
                    brand: 'line-display'
                });
            }
        }
    }

    updatePanelWithInitialState() {
        for (const printerType in this.printerStates) {
            this.updatePanelWithPrinterState(printerType);
        }
    }

    updatePanelWithPrinterState(printerType) {
        if (this.sidePanelPort) {
            this.sidePanelPort.postMessage({
                type: 'PRINTER_STATE_UPDATE',
                printerType: printerType,
                state: this.printerStates[printerType]
            });
        }
    }

    /**
     * Autodetect the POS connection and drive the indicator.
     *
     * Source of truth: a POS page is CONNECTED when a tab the content script has
     * confirmed as a tbay POS (this.posTabs) still has a live content-script
     * port (this.contentScriptPorts). No operator-typed URL is required — the
     * light goes green automatically the moment a POS tab is open with the panel.
     *
     * If the operator HAS typed a target URL pattern, it is applied only as an
     * optional additional filter (so power users can pin the simulator to one
     * specific POS URL); it is never a prerequisite for detection.
     */
    async checkConnection() {
        try {
            // Primary path: a confirmed POS tab with a live port.
            for (const [tabId, info] of this.posTabs) {
                if (!this.contentScriptPorts.has(tabId)) continue;
                if (this.posUrlPattern && info.url && !this._urlMatchesPattern(info.url, this.posUrlPattern)) continue;
                this.updateConnectionStatus(true, info.url || null);
                return;
            }

            // Fallback (only when a pattern is configured): match open tabs by URL
            // in case a POS page loaded before detection wiring existed.
            if (this.posUrlPattern) {
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    if (tab.url && this.contentScriptPorts.has(tab.id) && this._urlMatchesPattern(tab.url, this.posUrlPattern)) {
                        this.updateConnectionStatus(true, tab.url);
                        return;
                    }
                }
            }

            this.updateConnectionStatus(false, null);
        } catch (error) {
            this.updateConnectionStatus(false, null);
        }
    }

    /** Glob-match a URL against a '*'-wildcard pattern, escaping regex metachars. */
    _urlMatchesPattern(url, pattern) {
        try {
            const rx = new RegExp('^' + pattern.split('*')
                .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*'));
            return rx.test(url);
        } catch (e) {
            return false;
        }
    }

    updateConnectionStatus(connected, url) {
        // Only send an update if the status has changed
        if (this.isConnected !== connected) {
            this.isConnected = connected;
            if (this.sidePanelPort) {
                this.sidePanelPort.postMessage({
                    type: 'CONNECTION_STATUS',
                    data: { connected, url }
                });
            }
        }
    }

    // ===== NEW FEATURES MESSAGE HANDLERS =====

    handleKeyboardInput(data) {
        console.log('[SW] Handling keyboard input:', data);
        this.injectInputToActivePage({
            type: 'keyboard',
            keyData: data
        });
    }

    handleMSRSwipe(data) {
        console.log('[SW] Handling MSR swipe:', data);
        this.injectInputToActivePage({
            type: 'msr',
            track1: data.track1,
            track2: data.track2,
            timestamp: data.timestamp
        });
    }

    handleNFCTap(data) {
        console.log('[SW] Handling NFC tap:', data);
        this.injectInputToActivePage({
            type: 'nfc',
            cardData: data,
            timestamp: Date.now()
        });
        
        // Also broadcast to all connected content scripts for terminal detection
        this.broadcastToContentScripts({
            action: 'NFC_PAYMENT',
            data: data
        });
    }

    handleChipInsert(data) {
        console.log('[SW] Handling chip card insert:', data);
        this.injectInputToActivePage({
            type: 'chip_insert',
            cardData: data,
            timestamp: data.timestamp
        });
        
        // Broadcast chip insertion event
        this.broadcastToContentScripts({
            action: 'CHIP_INSERT',
            data: data
        });
    }

    handleChipRemove(data) {
        console.log('[SW] Handling chip card remove:', data);
        this.injectInputToActivePage({
            type: 'chip_remove',
            timestamp: data.timestamp
        });
        
        // Broadcast chip removal event
        this.broadcastToContentScripts({
            action: 'CHIP_REMOVE',
            data: data
        });
    }

    async handleSendEmail(data) {
        console.log('[SW] Handling email send request:', data);

        // NOTE: this is a mock — no email is actually sent. It RETURNS the
        // response object so the onMessage wrapper can sendResponse() with the
        // true success/failure. (Previously it returned undefined and posted a
        // separate EMAIL_RESPONSE port message, so callers always saw success
        // and got a duplicate, unhandled response.)
        try {
            const response = {
                success: true,
                messageId: 'msg_' + Date.now(),
                timestamp: new Date().toISOString()
            };
            console.log('[SW] Email simulation completed:', response);
            return response;
        } catch (error) {
            console.error('[SW] Email simulation failed:', error);
            return { success: false, error: error.message };
        }
    }
}

new PeripheralSimulatorService();
