class PeripheralSimulatorService {
    constructor() {
        this.printerStates = {
            usb: { on: false },
            bluetooth: { on: false },
            serial: { on: false },
            network: { on: false }
        };
        this.sidePanelPort = null;
        this.posUrlPattern = null;
        this.isConnected = false;

        this.init();
    }

    init() {
        chrome.runtime.onConnect.addListener(port => {
            if (port.name === 'sidepanel') {
                this.sidePanelPort = port;
                port.onMessage.addListener(msg => this.handlePanelMessage(msg));
                port.onDisconnect.addListener(() => this.sidePanelPort = null);
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
        switch (msg.type) {
            case 'TOGGLE_PRINTER':
                this.printerStates[msg.data.printerType].on = msg.data.isEnabled;
                this.updatePanelWithPrinterState(msg.data.printerType);
                break;
            case 'CHECK_CONNECTION':
                this.checkConnection();
                break;
            case 'SETTINGS_UPDATED':
                this.posUrlPattern = msg.data.targetUrl;
                this.checkConnection();
                break;
             case 'SCAN_BARCODE':
                this.handleBarcodeScan(msg.data);
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
                return;
        }

        if (this.printerStates[printerType].on && this.sidePanelPort) {
            this.sidePanelPort.postMessage({
                type: 'PRINT_DATA_RECEIVED',
                payload: request.payload,
                deviceType: request.source
            });
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
