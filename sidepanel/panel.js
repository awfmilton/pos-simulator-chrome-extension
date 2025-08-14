// ESC/POS Command Parser
// Parses ESC/POS printer commands and renders visual receipts

class ESCPOSParser {
    constructor() {
        this.commands = {
            // Initialization
            INIT: [0x1B, 0x40],

            // Text formatting
            BOLD_ON: [0x1B, 0x45, 0x01],
            BOLD_OFF: [0x1B, 0x45, 0x00],
            UNDERLINE_ON: [0x1B, 0x2D, 0x01],
            UNDERLINE_OFF: [0x1B, 0x2D, 0x00],
            DOUBLE_HEIGHT_ON: [0x1B, 0x21, 0x10],
            DOUBLE_WIDTH_ON: [0x1B, 0x21, 0x20],
            DOUBLE_SIZE_ON: [0x1B, 0x21, 0x30],
            NORMAL_SIZE: [0x1B, 0x21, 0x00],

            // Alignment
            ALIGN_LEFT: [0x1B, 0x61, 0x00],
            ALIGN_CENTER: [0x1B, 0x61, 0x01],
            ALIGN_RIGHT: [0x1B, 0x61, 0x02],

            // Paper control
            FEED_LINE: [0x0A],
            FEED_LINES: [0x1B, 0x64],
            CUT_PAPER: [0x1B, 0x69],
            PARTIAL_CUT: [0x1B, 0x6D],

            // Cash drawer
            DRAWER_KICK: [0x1B, 0x70, 0x00, 0x19, 0xFA],

            // Barcode printing
            BARCODE_HEIGHT: [0x1D, 0x68],
            BARCODE_WIDTH: [0x1D, 0x77],
            PRINT_BARCODE: [0x1D, 0x6B],

            // QR Code
            QR_CODE_MODEL: [0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41],
            QR_CODE_SIZE: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43],
            QR_CODE_ERROR: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45],
            QR_CODE_STORE: [0x1D, 0x28, 0x6B],
            QR_CODE_PRINT: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51]
        };

        this.currentState = {
            bold: false,
            underline: false,
            doubleHeight: false,
            doubleWidth: false,
            alignment: 'left',
            characterSize: 'normal'
        };

        this.reset();
    }

    reset() {
        this.currentState = {
            bold: false,
            underline: false,
            doubleHeight: false,
            doubleWidth: false,
            alignment: 'left',
            characterSize: 'normal'
        };
    }

    parse(data) {
        if (typeof data === 'string') {
            return this.parseTextData(data);
        } else if (data instanceof Uint8Array || Array.isArray(data)) {
            return this.parseBinaryData(data);
        }

        return {
            lines: [{ text: 'Invalid data format', style: {} }],
            commands: []
        };
    }

    parseTextData(text) {
        const lines = text.split('\n').map(line => ({
            text: line,
            style: { ...this.currentState }
        }));

        return {
            lines: lines,
            commands: []
        };
    }

    parseBinaryData(data) {
        const result = {
            lines: [],
            commands: []
        };

        let currentLine = '';
        let i = 0;

        while (i < data.length) {
            if (data[i] === 0x1B) { // ESC command
                const commandResult = this.parseESCCommand(data, i);
                if (commandResult.command) {
                    result.commands.push(commandResult.command);
                    this.applyCommand(commandResult.command);
                }
                i = commandResult.nextIndex;
            } else if (data[i] === 0x1D) { // GS command
                const commandResult = this.parseGSCommand(data, i);
                if (commandResult.command) {
                    result.commands.push(commandResult.command);
                    this.applyCommand(commandResult.command);
                }
                i = commandResult.nextIndex;
            } else if (data[i] === 0x0A || data[i] === 0x0D) { // Line feed / Carriage return
                if (currentLine.length > 0 || result.lines.length === 0) {
                    result.lines.push({
                        text: currentLine,
                        style: { ...this.currentState }
                    });
                }
                currentLine = '';
                i++;
            } else if (data[i] >= 32 && data[i] <= 126) { // Printable ASCII
                currentLine += String.fromCharCode(data[i]);
                i++;
            } else {
                // Skip non-printable characters
                i++;
            }
        }

        // Add final line if there's remaining text
        if (currentLine.length > 0) {
            result.lines.push({
                text: currentLine,
                style: { ...this.currentState }
            });
        }

        return result;
    }

    parseESCCommand(data, startIndex) {
        if (startIndex + 1 >= data.length) {
            return { command: null, nextIndex: startIndex + 1 };
        }

        const command = data[startIndex + 1];

        switch (command) {
            case 0x40: // Initialize printer
                return {
                    command: { type: 'initialize' },
                    nextIndex: startIndex + 2
                };

            case 0x45: // Bold on/off
                if (startIndex + 2 < data.length) {
                    return {
                        command: { type: 'bold', value: data[startIndex + 2] === 1 },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x2D: // Underline on/off
                if (startIndex + 2 < data.length) {
                    return {
                        command: { type: 'underline', value: data[startIndex + 2] > 0 },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x61: // Text alignment
                if (startIndex + 2 < data.length) {
                    const alignValue = data[startIndex + 2];
                    const alignment = alignValue === 0 ? 'left' :
                                    alignValue === 1 ? 'center' : 'right';
                    return {
                        command: { type: 'alignment', value: alignment },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x21: // Character size
                if (startIndex + 2 < data.length) {
                    const sizeValue = data[startIndex + 2];
                    return {
                        command: {
                            type: 'character_size',
                            doubleHeight: (sizeValue & 0x10) > 0,
                            doubleWidth: (sizeValue & 0x20) > 0
                        },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x70: // Cash drawer kick
                return {
                    command: { type: 'drawer_kick' },
                    nextIndex: startIndex + 5 // Skip drawer parameters
                };

            case 0x64: // Feed n lines
                if (startIndex + 2 < data.length) {
                    return {
                        command: { type: 'feed_lines', count: data[startIndex + 2] },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x69: // Cut paper
                return {
                    command: { type: 'cut_paper' },
                    nextIndex: startIndex + 2
                };
        }

        // Unknown command, skip 2 bytes
        return { command: null, nextIndex: startIndex + 2 };
    }

    parseGSCommand(data, startIndex) {
        if (startIndex + 1 >= data.length) {
            return { command: null, nextIndex: startIndex + 1 };
        }

        const command = data[startIndex + 1];

        switch (command) {
            case 0x6B: // Print barcode
                if (startIndex + 3 < data.length) {
                    const barcodeType = data[startIndex + 2];
                    const length = data[startIndex + 3];

                    if (startIndex + 4 + length <= data.length) {
                        const barcodeData = Array.from(data.slice(startIndex + 4, startIndex + 4 + length))
                            .map(b => String.fromCharCode(b)).join('');

                        return {
                            command: {
                                type: 'barcode',
                                barcodeType: barcodeType,
                                data: barcodeData
                            },
                            nextIndex: startIndex + 4 + length
                        };
                    }
                }
                break;

            case 0x68: // Barcode height
                if (startIndex + 2 < data.length) {
                    return {
                        command: { type: 'barcode_height', height: data[startIndex + 2] },
                        nextIndex: startIndex + 3
                    };
                }
                break;

            case 0x77: // Barcode width
                if (startIndex + 2 < data.length) {
                    return {
                        command: { type: 'barcode_width', width: data[startIndex + 2] },
                        nextIndex: startIndex + 3
                    };
                }
                break;
        }

        // Unknown GS command, skip 2 bytes
        return { command: null, nextIndex: startIndex + 2 };
    }

    applyCommand(command) {
        switch (command.type) {
            case 'initialize':
                this.reset();
                break;

            case 'bold':
                this.currentState.bold = command.value;
                break;

            case 'underline':
                this.currentState.underline = command.value;
                break;

            case 'alignment':
                this.currentState.alignment = command.value;
                break;

            case 'character_size':
                this.currentState.doubleHeight = command.doubleHeight;
                this.currentState.doubleWidth = command.doubleWidth;
                break;
        }
    }

    renderToHTML(parsedData) {
        let html = '<div class="receipt-content">';

        parsedData.lines.forEach(line => {
            let classes = ['receipt-line'];
            let styles = [];

            if (line.style.bold) classes.push('bold');
            if (line.style.underline) classes.push('underline');
            if (line.style.alignment === 'center') classes.push('center');
            if (line.style.alignment === 'right') classes.push('right');
            if (line.style.doubleHeight) styles.push('height: 2em');
            if (line.style.doubleWidth) styles.push('width: 200%');

            const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';
            html += `<div class="${classes.join(' ')}"${styleAttr}>${this.escapeHTML(line.text)}</div>`;
        });

        // Add barcode and special commands
        parsedData.commands.forEach(command => {
            if (command.type === 'barcode') {
                html += `<div class="receipt-barcode">||||| ${command.data} |||||</div>`;
            } else if (command.type === 'cut_paper') {
                html += '<div class="receipt-cut">- - - - - - - - - - - - - -</div>';
            } else if (command.type === 'drawer_kick') {
                html += '<div class="receipt-drawer">💰 CASH DRAWER OPENED</div>';
            }
        });

        html += '</div>';
        return html;
    }

    escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Static method to create barcode data
    static createBarcodeCommand(type, data) {
        const barcodeTypes = {
            'upc-a': 0x00,
            'upc-e': 0x01,
            'ean13': 0x02,
            'ean8': 0x03,
            'code39': 0x04,
            'code128': 0x49
        };

        const typeCode = barcodeTypes[type] || 0x04;
        const dataBytes = data.split('').map(c => c.charCodeAt(0));

        return [0x1D, 0x6B, typeCode, dataBytes.length, ...dataBytes];
    }

    // Static method to create QR code command
    static createQRCodeCommand(data) {
        const dataBytes = data.split('').map(c => c.charCodeAt(0));
        const lengthLow = dataBytes.length & 0xFF;
        const lengthHigh = (dataBytes.length >> 8) & 0xFF;

        return [
            // Set QR code model
            0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
            // Set QR code size
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08,
            // Set error correction level
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30,
            // Store QR code data
            0x1D, 0x28, 0x6B, lengthLow + 3, lengthHigh, 0x31, 0x50, 0x30,
            ...dataBytes,
            // Print QR code
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30
        ];
    }
}


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
            // The service worker now sends PRINT_DATA_RECEIVED directly to the port
            case 'PRINT_DATA_RECEIVED':
                this.handlePeripheralEvent('PRINT_DATA_RECEIVED', { payload: request.payload });
                break;
        }
    }

    handlePeripheralEvent(event, data) {
        console.log(`[PANEL] Handling peripheral event: ${event}`, data);
        switch (event) {
            case 'PRINT_DATA_RECEIVED':
                console.log('[PANEL-LOG] Step 7: Received PRINT_DATA_RECEIVED event.');
                try {
                    const decodedString = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data.payload));
                    console.log(`[PANEL-LOG] Step 8: Decoded data (${data.payload.length} bytes) to string:`, decodedString);
                    this.displayReceipt(decodedString);
                    console.log('[PANEL-LOG] Step 9: Called displayReceipt with decoded string.');
                    this.logActivity('printer', `Rendered ${data.payload.length} bytes of print data.`);
                } catch (e) {
                    console.error('[PANEL-LOG] Step 8 FAILED: Could not decode print data.', e);
                    this.showError('Failed to decode print data.');
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
