// POS Peripheral Simulator - Service Worker
// Handles background operations, message routing, and API access

class PeripheralSimulatorService {
    constructor() {
        this.peripheralStates = {
            scanner: { ready: true, lastScan: null },
            msr: { ready: true, lastSwipe: null },
            printer: { ready: true, jobs: [], paperStatus: 'OK' },
            drawer: { open: false },
            scale: { weight: 0, unit: 'lbs', stable: true, tare: 0 },
            display: { line1: '', line2: '' }
        };

        this.serialPorts = new Map();
        this.usbDevices = new Map();

        this.init();
    }

    init() {
        console.log('POS Peripheral Simulator Service Worker initialized');
        this.setupMessageHandlers();
        this.setupSidePanel();
    }

    setupMessageHandlers() {
        // Listen for messages from UI panel and content script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });
    }

    async setupSidePanel() {
        // Enable side panel on extension startup
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            console.log('Service Worker received message:', request);

            switch (request.action) {
                case 'SCAN_BARCODE':
                    await this.handleBarcodeScans(request.data);
                    break;

                case 'SWIPE_MSR':
                    await this.handleMSRSwipe(request.data);
                    break;

                case 'PRINT_RECEIPT':
                    await this.handlePrintJob(request.data);
                    break;

                case 'OPEN_DRAWER':
                    await this.handleDrawerOpen();
                    break;

                case 'UPDATE_SCALE':
                    await this.handleScaleUpdate(request.data);
                    break;

                case 'UPDATE_DISPLAY':
                    await this.handleDisplayUpdate(request.data);
                    break;

                case 'GET_STATE':
                    sendResponse({ success: true, data: this.peripheralStates });
                    return;

                case 'INJECT_INPUT':
                    await this.injectInputToActivePage(request.data);
                    break;

                default:
                    console.warn('Unknown action:', request.action);
            }

            sendResponse({ success: true });
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleBarcodeScans(data) {
        this.peripheralStates.scanner.lastScan = {
            value: data.barcode,
            format: data.format,
            timestamp: Date.now()
        };

        // Inject barcode into active page
        await this.injectInputToActivePage({
            type: 'barcode',
            value: data.barcode,
            simulateEnter: data.simulateEnter || true
        });

        // Notify UI panel
        this.notifyUIPanel('SCAN_COMPLETE', this.peripheralStates.scanner.lastScan);
    }

    async handleMSRSwipe(data) {
        this.peripheralStates.msr.lastSwipe = {
            track1: data.track1,
            track2: data.track2,
            cardType: data.cardType,
            timestamp: Date.now()
        };

        // Inject MSR data into active page
        const msrData = data.track1 + data.track2;
        await this.injectInputToActivePage({
            type: 'msr',
            value: msrData,
            simulateEnter: true
        });

        this.notifyUIPanel('SWIPE_COMPLETE', this.peripheralStates.msr.lastSwipe);
    }

    async handlePrintJob(data) {
        const job = {
            id: Date.now(),
            data: data.escposData || data.rawData,
            timestamp: Date.now(),
            status: 'processing'
        };

        this.peripheralStates.printer.jobs.push(job);

        // Parse ESC/POS commands and render receipt
        const renderedReceipt = this.parseESCPOSCommands(job.data);
        job.renderedContent = renderedReceipt;
        job.status = 'completed';

        this.notifyUIPanel('PRINT_COMPLETE', job);
    }

    async handleDrawerOpen() {
        this.peripheralStates.drawer.open = true;
        this.notifyUIPanel('DRAWER_OPENED', { timestamp: Date.now() });

        // Simulate drawer closing after 3 seconds
        setTimeout(() => {
            this.peripheralStates.drawer.open = false;
            this.notifyUIPanel('DRAWER_CLOSED', { timestamp: Date.now() });
        }, 3000);
    }

    async handleScaleUpdate(data) {
        this.peripheralStates.scale = { ...this.peripheralStates.scale, ...data };
        this.notifyUIPanel('SCALE_UPDATED', this.peripheralStates.scale);
    }

    async handleDisplayUpdate(data) {
        this.peripheralStates.display = { ...this.peripheralStates.display, ...data };
        this.notifyUIPanel('DISPLAY_UPDATED', this.peripheralStates.display);
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
            console.error('Error injecting input to active page:', error);
        }
    }

    notifyUIPanel(event, data) {
        // Send message to UI panel
        chrome.runtime.sendMessage({
            action: 'PERIPHERAL_EVENT',
            event: event,
            data: data
        }).catch(error => {
            // UI panel might not be open, ignore error
            console.log('UI panel not available:', error.message);
        });
    }

    parseESCPOSCommands(data) {
        // Basic ESC/POS command parser
        if (typeof data === 'string') {
            return this.parseTextCommands(data);
        } else if (data instanceof Uint8Array || Array.isArray(data)) {
            return this.parseBinaryCommands(data);
        }

        return { text: 'Invalid print data', formatted: false };
    }

    parseTextCommands(text) {
        // Simple text-based receipt rendering
        const lines = text.split('\n');
        const receipt = {
            lines: [],
            commands: []
        };

        lines.forEach(line => {
            receipt.lines.push({
                text: line,
                alignment: 'left',
                bold: false,
                underline: false
            });
        });

        return receipt;
    }

    parseBinaryCommands(data) {
        // Basic binary ESC/POS command parsing
        const commands = [];
        const textLines = [];
        let currentLine = '';
        let i = 0;

        while (i < data.length) {
            if (data[i] === 0x1B) { // ESC command
                if (i + 1 < data.length) {
                    const command = data[i + 1];
                    switch (command) {
                        case 0x40: // Initialize
                            commands.push({ type: 'initialize' });
                            i += 2;
                            break;
                        case 0x45: // Bold
                            commands.push({ type: 'bold', value: data[i + 2] === 1 });
                            i += 3;
                            break;
                        case 0x61: // Alignment
                            commands.push({ type: 'align', value: data[i + 2] });
                            i += 3;
                            break;
                        case 0x70: // Drawer kick
                            commands.push({ type: 'drawer_kick' });
                            i += 5; // Skip drawer kick parameters
                            break;
                        default:
                            i += 2;
                    }
                } else {
                    i++;
                }
            } else if (data[i] === 0x0A || data[i] === 0x0D) { // Line feed / Carriage return
                if (currentLine.trim()) {
                    textLines.push(currentLine);
                    currentLine = '';
                }
                i++;
            } else if (data[i] >= 32 && data[i] <= 126) { // Printable ASCII
                currentLine += String.fromCharCode(data[i]);
                i++;
            } else {
                i++;
            }
        }

        if (currentLine.trim()) {
            textLines.push(currentLine);
        }

        return {
            lines: textLines.map(text => ({ text, alignment: 'left' })),
            commands: commands
        };
    }
}

// Initialize service worker
const peripheralService = new PeripheralSimulatorService();

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    console.log('POS Peripheral Simulator installed:', details.reason);
});
