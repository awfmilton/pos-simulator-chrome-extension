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

        // The onMessage listener is no longer needed for communication with the content
        // script, as that is now handled by the long-lived port.
        // We can remove it completely.

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
    }

    handleContentScriptConnection(port) {
        const tabId = port.sender.tab.id;
        console.log(`[SW] Content script from tab ${tabId} connected.`);
        this.contentScriptPorts.set(tabId, port);

        port.onMessage.addListener(async (msg) => {
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
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({
                        type:      'TERMINAL_CHARGE_REQUEST',
                        requestId: msg.requestId,
                        gateway:   msg.gateway,
                        amount:    msg.amount,
                        currency:  msg.currency,
                        orderId:   msg.orderId,
                        timestamp: msg.timestamp,
                    });
                } else {
                    console.warn('[SW] No side panel connected — cannot deliver TERMINAL_CHARGE_REQUEST.');
                }
            } else if (msg.type === 'TERMINAL_CHARGE_CANCEL') {
                console.log('[SW] TERMINAL_CHARGE_CANCEL received from content script.');
                if (this.sidePanelPort) {
                    this.sidePanelPort.postMessage({ type: 'TERMINAL_CHARGE_CANCEL' });
                }
            } else if (msg.type === 'TERMINAL_READY_SIGNAL') {
                // POS settings changed (terminal enabled/disabled, brand, IP).
                // Relay to the side panel so it can update the connection light.
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
            simulateEnter: data.simulateEnter || true
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

    async checkConnection() {
        if (!this.posUrlPattern) {
            this.updateConnectionStatus(false, null);
            return;
        }

        try {
            // Find all tabs to see if any matches the POS URL and is connected
            const tabs = await chrome.tabs.query({});
            let connectedTab = null;

            for (const tab of tabs) {
                // Check if the tab URL matches AND if we have an active connection from its content script
                if (tab.url && tab.url.match(new RegExp(this.posUrlPattern.replace('*', '.*'))) && this.contentScriptPorts.has(tab.id)) {
                    connectedTab = tab;
                    break;
                }
            }

            if (connectedTab) {
                this.updateConnectionStatus(true, connectedTab.url);
            } else {
                this.updateConnectionStatus(false, null);
            }
        } catch (error) {
            this.updateConnectionStatus(false, null);
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
        
        try {
            // In a real implementation, this would integrate with an email service
            // For now, we'll simulate the email functionality
            
            // Create a mock response
            const response = {
                success: true,
                messageId: 'msg_' + Date.now(),
                timestamp: new Date().toISOString()
            };
            
            // Send response back to panel
            if (this.sidePanelPort) {
                this.sidePanelPort.postMessage({
                    type: 'EMAIL_RESPONSE',
                    data: response
                });
            }
            
            console.log('[SW] Email simulation completed:', response);
            
        } catch (error) {
            console.error('[SW] Email simulation failed:', error);
            
            if (this.sidePanelPort) {
                this.sidePanelPort.postMessage({
                    type: 'EMAIL_RESPONSE',
                    data: {
                        success: false,
                        error: error.message
                    }
                });
            }
        }
    }
}

new PeripheralSimulatorService();
