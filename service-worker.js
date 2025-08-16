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

        port.onMessage.addListener((msg) => {
            if (msg.type === 'RAW_DATA_FROM_PAGE') {
                this.handleRawData(msg);
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
        }
    }

     async handleBarcodeScan(data) {
        this.injectInputToActivePage({
            type: 'barcode',
            value: data.barcode,
            simulateEnter: data.simulateEnter || true
        });
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
        console.log(`[SW] Received raw data from ${request.source} for brand ${request.brand || 'N/A'}`, request);
        let printerType; // This is the connection type: usb, bluetooth, etc.
        switch (request.source) {
            case 'webusb':
                printerType = 'usb';
                break;
            case 'webbluetooth':
                printerType = 'bluetooth';
                break;
            case 'webserial':
                printerType = 'serial';
                break;
            case 'network':
                printerType = 'network';
                break;
            default:
                console.warn(`[SW] Unknown raw data source: ${request.source}`);
                return;
        }

        if (this.printerStates[printerType] && this.printerStates[printerType].on) {
            if (this.sidePanelPort) {
                console.log(`[SW] Forwarding print data from ${printerType} to side panel.`);
                this.sidePanelPort.postMessage({
                    type: 'PRINT_DATA_RECEIVED',
                    payload: request.payload,
                    source: request.source,
                    deviceType: request.deviceType,
                    brand: request.brand || this.printerStates[printerType].brand // Pass intercepted brand, or fall back to selected brand
                });
            } else {
                console.warn(`[SW] Side panel not connected. Cannot forward print data from ${printerType}.`);
            }
        } else {
            console.log(`[SW] Printer ${printerType} is turned off. Ignoring raw data.`);
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
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            // Check if the tab URL matches AND if we have an active connection from its content script
            if (tab && tab.url.match(new RegExp(this.posUrlPattern.replace('*', '.*'))) && this.contentScriptPorts.has(tab.id)) {
                this.updateConnectionStatus(true, tab.url);
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
}

new PeripheralSimulatorService();
