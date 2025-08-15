// POS Peripheral Simulator - Panel JavaScript
// Handles UI interactions and communication with service worker

class POSSimulatorPanel {
    constructor() {
        this.currentTab = 'scanner';
        this.peripheralStates = {};
        this.escposParser = new EscPosParser();
        this.testData = {
            barcodes: {
                'upc-a': '012345678905',
                'upc-e': '01234567',
                'code128': 'SIMULATOR123',
                'code39': '*TEST123*',
                'qr': 'https://example.com/test',
                'datamatrix': 'DM123456789'
            },
            cards: {
                credit: {
                    track1: '%B4111111111111111^DOE/JOHN^25121010000100000000000000000000?',
                    track2: ';4111111111111111=25121010000100000000?'
                },
                debit: {
                    track1: '%B4000000000000002^DOE/JANE^25121010000100000000000000000000?',
                    track2: ';4000000000000002=25121010000100000000?'
                },
                gift: {
                    track1: '%B6037000000000000^GIFT CARD/^251210100001?',
                    track2: ';6037000000000000=25121010000100000000?'
                }
            }
        };
        this.port = null;
        this.init();
    }

    init() {
        console.log('[PANEL] POS Simulator Panel initialized');
        this.setupEventListeners();
        this.initializeUI();
        this.connectToServiceWorker();
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
        });

        // Printer toggles
        document.getElementById('usb-printer-toggle').addEventListener('change', (e) => this.togglePrinter('usb', e.target.checked));
        document.getElementById('bluetooth-printer-toggle').addEventListener('change', (e) => this.togglePrinter('bluetooth', e.target.checked));
        document.getElementById('serial-printer-toggle').addEventListener('change', (e) => this.togglePrinter('serial', e.target.checked));
        document.getElementById('network-printer-toggle').addEventListener('change', (e) => this.togglePrinter('network', e.target.checked));

        // Barcode scanner events
        document.getElementById('scan-btn').addEventListener('click', () => this.handleBarcodeScans());
        document.getElementById('generate-barcode-btn').addEventListener('click', () => this.generateTestBarcode());
        document.getElementById('barcode-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleBarcodeScans();
        });

        // MSR events
        document.getElementById('swipe-btn').addEventListener('click', () => this.handleMSRSwipe());
        document.getElementById('generate-card-btn').addEventListener('click', () => this.generateTestCard());

        // Printer events
        document.getElementById('test-print-btn').addEventListener('click', () => this.handleTestPrint());
        document.getElementById('clear-receipt-btn').addEventListener('click', () => this.clearReceipt());

        // Cash drawer events
        document.getElementById('open-drawer-btn').addEventListener('click', () => this.handleDrawerOpen());
        document.getElementById('close-drawer-btn').addEventListener('click', () => this.handleDrawerClose());

        // Scale events
        document.getElementById('weight-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-slider-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-unit-select').addEventListener('change', (e) => this.updateWeightUnit(e.target.value));
        document.getElementById('tare-btn').addEventListener('click', () => this.tareScale());
        document.getElementById('zero-btn').addEventListener('click', () => this.zeroScale());

        // Line display events
        document.getElementById('update-display-btn').addEventListener('click', () => this.updateLineDisplay());
        document.getElementById('clear-display-btn').addEventListener('click', () => this.clearLineDisplay());
        document.getElementById('line1-input').addEventListener('input', (e) => this.updateDisplayPreview());
        document.getElementById('line2-input').addEventListener('input', (e) => this.updateDisplayPreview());

        // Global controls
        document.getElementById('reset-all-btn').addEventListener('click', () => this.resetAll());
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());

        // Settings modal
        document.getElementById('close-settings-btn').addEventListener('click', () => this.hideSettings());
        document.getElementById('save-settings-btn').addEventListener('click', () => this.saveSettings());
        document.getElementById('cancel-settings-btn').addEventListener('click', () => this.hideSettings());
    }


    initializeUI() {
        this.updateConnectionStatus(false, null);
        this.loadSettings();
    }

    connectToServiceWorker() {
        this.port = chrome.runtime.connect({ name: 'sidepanel' });
        this.port.onMessage.addListener((msg) => this.handlePortMessage(msg));
        this.port.onDisconnect.addListener(() => {
            this.port = null;
            this.updateConnectionStatus(false, null);
        });

        // Check connection status every 2 seconds
        setInterval(() => this.sendMessage('CHECK_CONNECTION'), 2000);
    }

    handlePortMessage(msg) {
        switch (msg.type) {
            case 'PRINTER_STATE_UPDATE':
                this.updatePrinterStateUI(msg.printerType, msg.state);
                break;
            case 'CONNECTION_STATUS':
                this.updateConnectionStatus(msg.data.connected, msg.data.url);
                break;
            case 'PRINT_DATA_RECEIVED':
                this.handlePrintData(msg.payload, msg.deviceType);
                this.flashPrinterIndicator(msg.deviceType);
                break;
        }
    }

    flashPrinterIndicator(deviceType) {
        let indicatorId;
        switch (deviceType) {
            case 'webusb':
                indicatorId = 'usb-printer-status';
                break;
            case 'webbluetooth':
                 indicatorId = 'bluetooth-printer-status';
                 break;
            case 'webserial':
                indicatorId = 'serial-printer-status';
                break;
            case 'network':
                indicatorId = 'network-printer-status';
                break;
            default:
                return;
        }

        const indicator = document.getElementById(indicatorId);
        if (indicator) {
            indicator.classList.add('transmitting');
            setTimeout(() => indicator.classList.remove('transmitting'), 500);
        }
    }

    handlePrintData(data, deviceType) {
        if (deviceType === 'network-printer' && typeof data === 'string') {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName('text');
            let receiptText = '';
            for (let i = 0; i < textNodes.length; i++) {
                receiptText += textNodes[i].textContent;
            }
            this.displayReceipt(receiptText);
        } else {
            const parsedData = this.escposParser.parse(new Uint8Array(data));
            const receiptHtml = this.escposParser.renderToHTML(parsedData);
            document.querySelector('.receipt-content').innerHTML = receiptHtml;
        }
    }

    togglePrinter(printerType, isEnabled) {
        this.sendMessage('TOGGLE_PRINTER', { printerType, isEnabled });
    }

    updatePrinterStateUI(printerType, state) {
        const toggle = document.getElementById(`${printerType}-printer-toggle`);
        const statusLight = document.getElementById(`${printerType}-printer-status`);

        if (toggle) toggle.checked = state.on;
        if (statusLight) {
            statusLight.classList.toggle('connected', state.on);
        }
    }


    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}-panel`));
        this.currentTab = tabName;
    }

    async sendMessage(type, data) {
        if (this.port) {
            this.port.postMessage({ type, data });
        } else {
            console.error("Port not connected");
        }
    }

    updateConnectionStatus(connected, url) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-status-text');

        indicator.classList.toggle('connected', connected);
        indicator.classList.toggle('disconnected', !connected);
        text.textContent = connected ? `Connected to ${new URL(url).hostname}` : 'Disconnected';
    }

    // Existing methods (handleBarcodeScans, generateTestBarcode, etc.) go here...
    async handleBarcodeScans() {
        const barcodeInput = document.getElementById('barcode-input');
        const formatSelect = document.getElementById('barcode-format');
        const simulateEnter = document.getElementById('simulate-enter').checked;
        const simulateTyping = document.getElementById('simulate-typing').checked;

        const barcode = barcodeInput.value.trim();
        if (!barcode) {
            this.showError('Please enter a barcode value');
            return;
        }

        const scanData = {
            barcode: barcode,
            format: formatSelect.value,
            simulateEnter: simulateEnter,
            simulateTyping: simulateTyping
        };

        this.updateStatus('Scanning barcode...');

        try {
            await this.sendMessage('SCAN_BARCODE', scanData);
            this.logActivity('scanner', `Scanned: ${barcode} (${formatSelect.value})`);
            this.updateStatus('Barcode scanned successfully');

            // Clear input after successful scan
            barcodeInput.value = '';
        } catch (error) {
            this.showError('Failed to scan barcode: ' + error.message);
        }
    }

    generateTestBarcode() {
        const formatSelect = document.getElementById('barcode-format');
        const barcodeInput = document.getElementById('barcode-input');
        const format = formatSelect.value;

        const testBarcode = this.testData.barcodes[format] || 'TEST123456';
        barcodeInput.value = testBarcode;
    }

    // MSR Methods
    async handleMSRSwipe() {
        const track1Input = document.getElementById('track1-input');
        const track2Input = document.getElementById('track2-input');
        const cardTypeSelect = document.getElementById('card-type');

        const track1 = track1Input.value.trim();
        const track2 = track2Input.value.trim();

        if (!track1 && !track2) {
            this.showError('Please enter track data or generate test card');
            return;
        }

        const swipeData = {
            track1: track1,
            track2: track2,
            cardType: cardTypeSelect.value
        };

        this.updateStatus('Swiping card...');

        try {
            await this.sendMessage('SWIPE_MSR', swipeData);
            this.logActivity('msr', `Card swiped: ${cardTypeSelect.value}`);
            this.updateStatus('Card swiped successfully');

            // Clear inputs after successful swipe
            track1Input.value = '';
            track2Input.value = '';
        } catch (error) {
            this.showError('Failed to swipe card: ' + error.message);
        }
    }

    generateTestCard() {
        const cardTypeSelect = document.getElementById('card-type');
        const track1Input = document.getElementById('track1-input');
        const track2Input = document.getElementById('track2-input');

        const cardType = cardTypeSelect.value;
        const cardData = this.testData.cards[cardType];

        if (cardData) {
            track1Input.value = cardData.track1;
            track2Input.value = cardData.track2;
        }
    }

    // Printer Methods
    async handleTestPrint() {
        this.updateStatus('Printing test receipt...');
        const testReceipt = this.generateTestReceipt();
        try {
            await this.sendMessage('PRINT_RECEIPT', { data: testReceipt });
            this.displayReceipt(testReceipt);
            this.logActivity('printer', 'Test receipt printed');
            this.updateStatus('Test receipt printed');
        } catch (error) {
            this.showError('Failed to print receipt: ' + error.message);
        }
    }

    generateTestReceipt() {
        const timestamp = new Date().toLocaleString();
        return [
            'VIRTUAL POS SIMULATOR',
            '========================',
            '',
            'Test Receipt #12345',
            `Date: ${timestamp}`,
            '',
            'Item 1.............$10.00',
            'Item 2.............$15.50',
            'Item 3..............$5.99',
            '------------------------',
            'Subtotal...........$31.49',
            'Tax................$2.52',
            'TOTAL..............$34.01',
            '',
            'Thank you for your business!',
            ''
        ].join('\n');
    }

    displayReceipt(receiptText) {
        const receiptContent = document.querySelector('.receipt-content');
        receiptContent.innerHTML = '';

        const lines = receiptText.split('\n');
        lines.forEach(line => {
            const div = document.createElement('div');
            div.className = 'receipt-line';
            div.textContent = line;
            receiptContent.appendChild(div);
        });
    }

    clearReceipt() {
        const receiptContent = document.querySelector('.receipt-content');
        receiptContent.innerHTML = `
            <div class="receipt-line">VIRTUAL RECEIPT PRINTER</div>
            <div class="receipt-line">Ready for print jobs...</div>
        `;
    }

    // Cash Drawer Methods
    async handleDrawerOpen() {
        this.updateStatus('Opening cash drawer...');

        try {
            await this.sendMessage('OPEN_DRAWER');
            this.updateDrawerVisual(true);
            this.logActivity('drawer', 'Drawer opened');
            this.updateStatus('Cash drawer opened');
        } catch (error) {
            this.showError('Failed to open drawer: ' + error.message);
        }
    }

    async handleDrawerClose() {
        this.updateDrawerVisual(false);
        this.logActivity('drawer', 'Drawer closed');
        this.updateStatus('Cash drawer closed');
    }

    updateDrawerVisual(isOpen) {
        const drawer = document.getElementById('drawer-visual');
        const statusText = document.getElementById('drawer-status-text');

        drawer.classList.toggle('open', isOpen);
        statusText.textContent = isOpen ? 'Open' : 'Closed';
    }

    // Scale Methods
    updateWeight(weight) {
        const weightValue = parseFloat(weight) || 0;
        document.getElementById('weight-value').textContent = weightValue.toFixed(2);
        document.getElementById('weight-input').value = weightValue;
        document.getElementById('weight-slider-input').value = weightValue;

        const stableIndicator = document.getElementById('stable-indicator');
        const zeroIndicator = document.getElementById('zero-indicator');

        stableIndicator.classList.toggle('active', true);
        zeroIndicator.classList.toggle('active', weightValue === 0);

        this.sendMessage('UPDATE_SCALE', {
            weight: weightValue,
            unit: document.getElementById('weight-unit-select').value,
            stable: true
        });
    }

    updateWeightUnit(unit) {
        document.getElementById('weight-unit').textContent = unit;
        this.sendMessage('UPDATE_SCALE', { unit: unit });
    }

    tareScale() {
        const currentWeight = parseFloat(document.getElementById('weight-input').value) || 0;
        this.updateWeight(0);
        this.logActivity('scale', `Scale tared (was ${currentWeight})`);
    }

    zeroScale() {
        this.updateWeight(0);
        this.logActivity('scale', 'Scale zeroed');
    }

    // Line Display Methods
    updateLineDisplay() {
        const line1 = document.getElementById('line1-input').value;
        const line2 = document.getElementById('line2-input').value;
        this.updateDisplayPreview();
        this.sendMessage('UPDATE_DISPLAY', { line1, line2 });
        this.logActivity('display', `Display updated: "${line1}" / "${line2}"`);
    }

    updateDisplayPreview() {
        const line1 = document.getElementById('line1-input').value;
        const line2 = document.getElementById('line2-input').value;
        document.getElementById('display-line1').textContent = line1.padEnd(20, ' ').substring(0, 20);
        document.getElementById('display-line2').textContent = line2.padEnd(20, ' ').substring(0, 20);
    }

    clearLineDisplay() {
        document.getElementById('line1-input').value = '';
        document.getElementById('line2-input').value = '';
        this.updateDisplayPreview();
        this.sendMessage('UPDATE_DISPLAY', { line1: '', line2: '' });
        this.logActivity('display', 'Display cleared');
    }

    // Utility Methods
    logActivity(peripheral, message) {
        const logElement = document.querySelector(`#${peripheral}-log .log-content`);
        if (logElement) {
            const timestamp = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `<span class="log-timestamp">${timestamp}</span> - ${message}`;
            logElement.insertBefore(entry, logElement.firstChild);
            if (logElement.children.length > 10) {
                logElement.removeChild(logElement.lastChild);
            }
        }
    }

    updateStatus(message) {
        const statusText = document.getElementById('status-text');
        statusText.textContent = message;
        setTimeout(() => {
            statusText.textContent = 'System Ready';
        }, 3000);
    }

    showError(message) {
        this.updateStatus(`❌ ${message}`);
        console.error('[PANEL] Error:', message);
    }

    resetAll() {
        if (confirm('Are you sure you want to reset all peripherals?')) {
            ['barcode-input', 'track1-input', 'track2-input', 'line1-input', 'line2-input'].forEach(id => document.getElementById(id).value = '');
            this.updateWeight(0);
            this.clearReceipt();
            this.clearLineDisplay();
            this.updateDrawerVisual(false);
            document.querySelectorAll('.log-content').forEach(log => log.innerHTML = '');
            this.updateStatus('All peripherals reset');
        }
    }

    showSettings() {
        document.getElementById('settings-modal').style.display = 'flex';
    }

    hideSettings() {
        document.getElementById('settings-modal').style.display = 'none';
    }

    saveSettings() {
        const settings = {
            targetUrl: document.getElementById('target-url').value,
            debugMode: document.getElementById('debug-mode').checked,
            autoDetectInputs: document.getElementById('auto-detect-inputs').checked
        };
        chrome.storage.local.set({ posSimulatorSettings: settings }, () => {
            this.updateStatus('Settings saved');
            this.hideSettings();
            this.sendMessage('SETTINGS_UPDATED', settings);
        });
    }

    loadSettings() {
        chrome.storage.local.get('posSimulatorSettings', (result) => {
            if (result.posSimulatorSettings) {
                const settings = result.posSimulatorSettings;
                document.getElementById('target-url').value = settings.targetUrl || '';
                document.getElementById('debug-mode').checked = settings.debugMode || false;
                document.getElementById('auto-detect-inputs').checked = settings.autoDetectInputs !== false;
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.posSimulator = new POSSimulatorPanel();
});
