class PeripheralSimulatorService {
    constructor() {
        this.printerStates = {
            usb: { on: false, brand: 'epson' },
            bluetooth: { on: false, brand: 'epson' },
            serial: { on: false, brand: 'epson' },
            network: { on: false, brand: 'epson' }
        };
        this.sidePanelPort = null;
        this.posUrlPattern = null;
        this.isConnected = false;

        this.init();
    }

    init() {
        console.log('[SW] Initializing Service Worker...');
        chrome.runtime.onConnect.addListener(port => {
            if (port.name === 'sidepanel') {
                console.log('[SW] Side panel connected.');
                this.sidePanelPort = port;
                port.onMessage.addListener(msg => this.handlePanelMessage(msg));
                port.onDisconnect.addListener(() => {
                    console.log('[SW] Side panel disconnected.');
                    this.sidePanelPort = null;
                });
                this.updatePanelWithInitialState();
            }
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'RAW_DATA_FROM_PAGE') {
                this.handleRawData(request);
            } else if (request.action === 'INJECT_INPUT') {
                this.injectInputToActivePage(request.data);
            }
            return true;
        });

        chrome.storage.local.get('posSimulatorSettings', (result) => {
            if (result.posSimulatorSettings) {
                this.posUrlPattern = result.posSimulatorSettings.targetUrl;
            }
        });
    }

    handlePanelMessage(msg) {
        console.log('[SW] Received message from side panel:', msg);
        switch (msg.type) {
            case 'KEEP_ALIVE':
                // This message is just to keep the service worker active.
                // No action needed, but we can log it for debugging.
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
                    // Optionally, send confirmation back to panel, though not strictly necessary
                    // as the panel initiated the change.
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
            if (tab) {
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
        console.log(`[SW] Received raw data from ${request.source}`, request);
        let printerType;
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
                    deviceType: request.source
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
            if (tab && tab.url.match(new RegExp(this.posUrlPattern.replace('*', '.*')))) {
                // Ping the content script to make sure it's alive
                const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
                if (response && response.type === 'PONG') {
                    this.updateConnectionStatus(true, tab.url);
                } else {
                    this.updateConnectionStatus(false, null);
                }
            } else {
                this.updateConnectionStatus(false, null);
            }
        } catch (error) {
            this.updateConnectionStatus(false, null);
        }
    }

    updateConnectionStatus(connected, url) {
        if (this.isConnected !== connected && this.sidePanelPort) {
            this.isConnected = connected;
            this.sidePanelPort.postMessage({
                type: 'CONNECTION_STATUS',
                data: { connected, url }
            });
        }
    }
}

new PeripheralSimulatorService();
