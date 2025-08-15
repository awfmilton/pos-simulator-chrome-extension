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

        this.init();
    }

    init() {
        console.log('[PANEL] POS Simulator Panel initialized');
        this.setupEventListeners();
        this.initializeUI();
        this.connectToServiceWorker();
    }

    setupEventListeners() {
        console.log('[PANEL] Setting up event listeners...');
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.currentTarget.dataset.tab;
                console.log(`[USER-ACTION] Clicked tab: ${tabName}`);
                this.switchTab(tabName);
            });
        });

        // Barcode scanner events
        document.getElementById('scan-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Scan Barcode"');
            this.handleBarcodeScans();
        });
        document.getElementById('generate-barcode-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Generate Test Barcode"');
            this.generateTestBarcode();
        });
        document.getElementById('barcode-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('[USER-ACTION] Pressed Enter in barcode input');
                this.handleBarcodeScans();
            }
        });

        // MSR events
        document.getElementById('swipe-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Swipe Card"');
            this.handleMSRSwipe();
        });
        document.getElementById('generate-card-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Generate Test Card"');
            this.generateTestCard();
        });

        // Printer events
        document.getElementById('test-print-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Test Print"');
            this.handleTestPrint();
        });
        document.getElementById('clear-receipt-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Clear Receipt"');
            this.clearReceipt();
        });

        // Cash drawer events
        document.getElementById('open-drawer-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Open Drawer"');
            this.handleDrawerOpen();
        });
        document.getElementById('close-drawer-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Close Drawer"');
            this.handleDrawerClose();
        });

        // Scale events
        document.getElementById('weight-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-slider-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-unit-select').addEventListener('change', (e) => {
            console.log(`[USER-ACTION] Changed weight unit to: ${e.target.value}`);
            this.updateWeightUnit(e.target.value);
        });
        document.getElementById('tare-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Tare"');
            this.tareScale();
        });
        document.getElementById('zero-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Zero"');
            this.zeroScale();
        });

        // Line display events
        document.getElementById('update-display-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Update Display"');
            this.updateLineDisplay();
        });
        document.getElementById('clear-display-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Clear Display"');
            this.clearLineDisplay();
        });
        document.getElementById('line1-input').addEventListener('input', (e) => this.updateDisplayPreview());
        document.getElementById('line2-input').addEventListener('input', (e) => this.updateDisplayPreview());

        // Global controls
        document.getElementById('reset-all-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Reset All"');
            this.resetAll();
        });
        document.getElementById('settings-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Settings"');
            this.showSettings();
        });

        // Settings modal
        document.getElementById('close-settings-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Close Settings"');
            this.hideSettings();
        });
        document.getElementById('save-settings-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Save Settings"');
            this.saveSettings();
        });
        document.getElementById('cancel-settings-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Cancel Settings"');
            this.hideSettings();
        });
    }

    initializeUI() {
        // Set initial values
        document.getElementById('barcode-format').value = 'upc-a';
        document.getElementById('card-type').value = 'credit';
        document.getElementById('printer-model').value = 'epson';
        document.getElementById('weight-unit-select').value = 'lbs';
        document.getElementById('drawer-interface').value = 'printer';

        // Initialize status indicators
        this.updateStatusIndicators();
        this.updateConnectionStatus(false, null); // Set initial state to disconnected

        // Load saved settings
        this.loadSettings();
    }

    connectToServiceWorker() {
        console.log('[PANEL] Connecting to service worker...');
        const port = chrome.runtime.connect({ name: 'sidepanel' });

        port.onMessage.addListener((message) => {
            this.handleMessage(message);
        });

        port.onDisconnect.addListener(() => {
            console.warn('[PANEL] Disconnected from service worker.');
            this.updateConnectionStatus(false, null);
        });

        // Get initial state from service worker
        this.sendMessage('GET_STATE').then(response => {
            if (response && response.success) {
                console.log('[PANEL] Initial state received:', response.data);
                this.peripheralStates = response.data;
                this.updateUIFromState();
            }
        }).catch(error => console.error('[PANEL] Error getting initial state:', error));

        // Get initial connection status
        this.sendMessage('GET_CONNECTION_STATUS').then(response => {
            if (response && response.success) {
                console.log('[PANEL] Initial connection status:', response);
                this.updateConnectionStatus(response.connected, response.url);
            }
        }).catch(error => console.error('[PANEL] Error getting connection status:', error));
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-panel`);
        });

        this.currentTab = tabName;
    }

    // Barcode Scanner Methods
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
        const printerModel = document.getElementById('printer-model').value;
        const autoCut = document.getElementById('auto-cut').checked;
        const drawerKick = document.getElementById('drawer-kick').checked;

        this.updateStatus('Printing test receipt...');

        const testReceipt = this.generateTestReceipt();

        try {
            await this.sendMessage('PRINT_RECEIPT', {
                model: printerModel,
                data: testReceipt,
                autoCut: autoCut,
                drawerKick: drawerKick
            });

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

        // Update scale status
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

        this.sendMessage('UPDATE_SCALE', {
            unit: unit
        });
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

        document.getElementById('display-line1').textContent = line1.padEnd(20).substring(0, 20);
        document.getElementById('display-line2').textContent = line2.padEnd(20).substring(0, 20);

        this.sendMessage('UPDATE_DISPLAY', {
            line1: line1,
            line2: line2
        });

        this.logActivity('display', `Display updated: "${line1}" / "${line2}"`);
    }

    updateDisplayPreview() {
        const line1 = document.getElementById('line1-input').value;
        const line2 = document.getElementById('line2-input').value;

        document.getElementById('display-line1').textContent = line1.padEnd(20).substring(0, 20);
        document.getElementById('display-line2').textContent = line2.padEnd(20).substring(0, 20);
    }

    updateLineDisplayFromData(payload) {
        // A simple parser for VFD/LCD line display commands.
        // It handles clear screen, cursor positioning, and printable text.
        const line1El = document.getElementById('display-line1');
        const line2El = document.getElementById('display-line2');
        let text1 = line1El.textContent.trimEnd();
        let text2 = line2El.textContent.trimEnd();
        let currentLine = 1;

        // Common command constants
        const CMD_CLEAR_SCREEN = 0x0C; // Form Feed
        const CMD_HOME = 0x0B; // Vertical Tab (often homes cursor)
        const CMD_NEW_LINE = 0x0A; // Line Feed
        const CMD_CARRIAGE_RETURN = 0x0D; // Carriage Return

        let i = 0;
        while (i < payload.length) {
            const byte = payload[i];

            if (byte === CMD_CLEAR_SCREEN) {
                text1 = '';
                text2 = '';
                currentLine = 1;
                i++;
                continue;
            }

            if (byte === CMD_HOME) {
                currentLine = 1;
                i++;
                continue;
            }

            if (byte === CMD_CARRIAGE_RETURN) {
                if (currentLine === 1) text1 = '';
                else text2 = '';
                i++;
                continue;
            }

            if (byte === CMD_NEW_LINE) {
                currentLine = 2;
                i++;
                continue;
            }

            // Basic ESC positioning (e.g., ESC c k for select line k)
            // This is a guess, but covers some devices.
            if (byte === 0x1B && payload[i+1] === 0x63 && payload[i+2]) {
                const lineNumber = payload[i+2];
                if (lineNumber === 1 || lineNumber === 49) { // '1'
                    currentLine = 1;
                } else if (lineNumber === 2 || lineNumber === 50) { // '2'
                    currentLine = 2;
                }
                i += 3;
                continue;
            }

            // Printable ASCII characters
            if (byte >= 32 && byte <= 126) {
                const char = String.fromCharCode(byte);
                if (currentLine === 1) {
                    text1 += char;
                } else {
                    text2 += char;
                }
            }
            i++;
        }

        // Update the UI, ensuring it's exactly 20 characters
        line1El.textContent = text1.padEnd(20).substring(0, 20);
        line2El.textContent = text2.padEnd(20).substring(0, 20);

        this.logActivity('display', `Rendered ${payload.length} bytes of data.`);
    }

    clearLineDisplay() {
        document.getElementById('line1-input').value = '';
        document.getElementById('line2-input').value = '';
        document.getElementById('display-line1').textContent = ''.padEnd(20);
        document.getElementById('display-line2').textContent = ''.padEnd(20);

        this.sendMessage('UPDATE_DISPLAY', { line1: '', line2: '' });
        this.logActivity('display', 'Display cleared');
    }

    // Utility Methods
    async sendMessage(action, data = {}) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action, data }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response ? response.error : 'Unknown error'));
                }
            });
        });
    }

    handleMessage(request) {
        console.log('[PANEL] Received message:', request);

        // Messages from the port don't use request/response
        const action = request.action || request.type;

        switch (action) {
            case 'PERIPHERAL_EVENT':
                this.handlePeripheralEvent(request.event, request.data);
                break;
            case 'PRINT_DATA_RECEIVED':
                this.handlePeripheralEvent('PRINT_DATA_RECEIVED', { payload: request.payload });
                break;
            case 'LINE_DISPLAY_DATA_RECEIVED':
                this.handlePeripheralEvent('LINE_DISPLAY_DATA_RECEIVED', { payload: request.payload });
                break;
        }
    }

    handlePeripheralEvent(event, data) {
        console.log(`[PANEL] Handling peripheral event: ${event}`, data);
        switch (event) {
            case 'LINE_DISPLAY_DATA_RECEIVED':
                this.updateLineDisplayFromData(data.payload);
                break;
            case 'PRINT_DATA_RECEIVED':
                console.log('[PANEL-LOG] Step 7: Received PRINT_DATA_RECEIVED event.');
                try {
                    // The payload is an array of numbers, convert it to a Uint8Array
                    const printData = new Uint8Array(data.payload);
                    const decodedString = new TextDecoder("utf-8", { fatal: true }).decode(printData);

                    console.log(`[PANEL-LOG] Step 8: Decoded data (${printData.length} bytes) to string.`);
                    this.displayReceipt(decodedString);
                    this.logActivity('printer', `Rendered ${printData.length} bytes of text data.`);

                } catch (e) {
                    console.warn('[PANEL-LOG] Step 8 FAILED: Could not decode print data as UTF-8. Assuming binary ESC/POS data.', e.message);
                    // If decoding fails, it's likely binary data. We can't render it as a simple string.
                    // For now, let's just log it and show a message on the receipt.
                    const hexString = data.payload.map(b => b.toString(16).padStart(2, '0')).join(' ');
                    this.clearReceipt();
                    this.displayReceipt(`Received ${data.payload.length} bytes of binary ESC/POS data.\n\nData (hex):\n${hexString}`);
                    this.logActivity('printer', `Received ${data.payload.length} bytes of binary data.`);
                    this.showError('Binary print data received.');
                }
                break;
            case 'CONNECTION_STATUS':
                this.updateConnectionStatus(data.connected, data.url);
                break;
            case 'SCAN_COMPLETE':
                // Handle scan completion
                break;
            case 'PRINT_COMPLETE':
                if (data.renderedContent) {
                    this.displayReceipt(data.renderedContent.lines.map(l => l.text).join('\n'));
                }
                break;
            case 'DRAWER_OPENED':
                this.updateDrawerVisual(true);
                break;
            case 'DRAWER_CLOSED':
                this.updateDrawerVisual(false);
                break;
        }
    }

    logActivity(peripheral, message) {
        const logElement = document.querySelector(`#${peripheral}-log .log-content`);
        if (logElement) {
            const timestamp = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `
                <span class="log-timestamp">${timestamp}</span> - ${message}
            `;

            logElement.insertBefore(entry, logElement.firstChild);

            // Keep only last 10 entries
            while (logElement.children.length > 10) {
                logElement.removeChild(logElement.lastChild);
            }
        }
    }

    updateStatus(message) {
        document.getElementById('status-text').textContent = message;

        setTimeout(() => {
            document.getElementById('status-text').textContent = 'System Ready';
        }, 3000);
    }

    updateConnectionStatus(connected, url) {
        const statusEl = document.getElementById('connection-status');
        if (connected && url) {
            try {
                statusEl.textContent = `🔗 Connected to ${new URL(url).hostname}`;
                statusEl.classList.add('connected');
                statusEl.classList.remove('disconnected');
            } catch (e) {
                console.error(`[PANEL] Invalid URL provided to updateConnectionStatus: ${url}`, e);
                statusEl.textContent = '⚠️ Invalid URL';
                statusEl.classList.add('disconnected');
                statusEl.classList.remove('connected');
            }
        } else {
            statusEl.textContent = '🔌 Disconnected';
            statusEl.classList.add('disconnected');
            statusEl.classList.remove('connected');
        }
    }

    showError(message) {
        this.updateStatus(`❌ ${message}`);
        console.error('[PANEL] Error:', message);
    }

    updateStatusIndicators() {
        const indicators = ['scanner', 'msr', 'printer', 'drawer', 'scale', 'display'];
        indicators.forEach(indicator => {
            const element = document.getElementById(`${indicator}-status`);
            if (element) {
                element.style.backgroundColor = '#10b981'; // Green
            }
        });
    }

    updateUIFromState() {
        // Update UI elements based on peripheral states
        if (this.peripheralStates.scale) {
            this.updateWeight(this.peripheralStates.scale.weight);
        }

        if (this.peripheralStates.display) {
            document.getElementById('line1-input').value = this.peripheralStates.display.line1;
            document.getElementById('line2-input').value = this.peripheralStates.display.line2;
            this.updateDisplayPreview();
        }

        if (this.peripheralStates.drawer) {
            this.updateDrawerVisual(this.peripheralStates.drawer.open);
        }
    }

    // Global Methods
    resetAll() {
        if (confirm('Are you sure you want to reset all peripherals?')) {
            // Reset all inputs and displays
            document.getElementById('barcode-input').value = '';
            document.getElementById('track1-input').value = '';
            document.getElementById('track2-input').value = '';
            document.getElementById('line1-input').value = '';
            document.getElementById('line2-input').value = '';

            this.updateWeight(0);
            this.clearReceipt();
            this.clearLineDisplay();
            this.updateDrawerVisual(false);

            // Clear all logs
            document.querySelectorAll('.log-content').forEach(log => {
                log.innerHTML = '';
            });

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

// Initialize the panel when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.posSimulator = new POSSimulatorPanel();
});
