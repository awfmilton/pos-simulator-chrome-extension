/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
// POS Peripheral Simulator - Panel JavaScript
// Handles UI interactions and communication with service worker

class LineDisplayParser {
    constructor() {
        this.currentLine1 = '';
        this.currentLine2 = '';
    }

    parseCommand(data) {
        // Common line display commands
        const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');

        if (hex.startsWith('0c')) { // Clear screen
            this.currentLine1 = '';
            this.currentLine2 = '';
            return { command: 'clear' };
        }

        if (hex.startsWith('1b4c')) { // Position cursor
            return { command: 'position' };
        }

        // Extract text content
        const text = new TextDecoder().decode(data);
        if (text.length > 0 && text.charCodeAt(0) >= 32) {
            return { command: 'text', data: text };
        }

        return { command: 'unknown', hex };
    }
}

class POSSimulatorPanel {
    constructor() {
        this.currentTab = 'scanner';
        this.peripheralStates = {};
        this.keepAliveInterval = null;
        this.escposParser = new EscPosParser();
        this.lineDisplayParser = new LineDisplayParser();
        this.aamvaGenerator = new AAMVAGenerator();
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
        console.log('[PANEL] Setting up event listeners...');
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.currentTarget.dataset.tab;
                console.log(`[USER-ACTION] Clicked tab: ${tabName}`);
                this.switchTab(tabName);
            });
        });

        // Printer toggles and brand selection
        ['usb', 'bluetooth', 'serial', 'network'].forEach(type => {
            document.getElementById(`${type}-printer-toggle`).addEventListener('change', (e) => this.togglePrinter(type, e.target.checked));
            document.getElementById(`${type}-printer-brand`).addEventListener('change', (e) => this.changePrinterBrand(type, e.target.value));
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

        // Display settings
        document.getElementById('display-brightness').addEventListener('input', (e) => this.updateDisplayBrightness(e.target.value));
        document.getElementById('display-blink').addEventListener('change', (e) => this.toggleDisplayBlink(e.target.checked));

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

        // Add to setupEventListeners method:
        document.getElementById('generate-dl-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Generate DL"');
            this.generateSpecificAAMVA('DL');
        });

        document.getElementById('generate-id-btn').addEventListener('click', () => {
            console.log('[USER-ACTION] Clicked "Generate ID"');
            this.generateSpecificAAMVA('ID');
        });

        // Show/hide AAMVA buttons based on format selection
        document.getElementById('barcode-format').addEventListener('change', (e) => {
            const aamvaButtons = document.getElementById('aamva-specific-buttons');
            if (e.target.value === 'aamva-pdf417') {
                aamvaButtons.style.display = 'flex';
            } else {
                aamvaButtons.style.display = 'none';
            }
        });
    }


    initializeUI() {
        this.updateConnectionStatus(false, null);
        this.loadSettings();
    }

    connectToServiceWorker() {
        console.log('[PANEL] Connecting to service worker...');
        this.port = chrome.runtime.connect({ name: 'sidepanel' });

        this.port.onMessage.addListener((msg) => this.handlePortMessage(msg));
        this.port.onDisconnect.addListener(() => {
            console.warn('[PANEL] Disconnected from service worker.');
            this.port = null;
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
            }
            this.updateConnectionStatus(false, null);
        });

        // Start a heartbeat to keep the service worker alive
        this.keepAliveInterval = setInterval(() => {
            this.sendMessage('KEEP_ALIVE');
        }, 20000); // 20 seconds

        // Check connection status every 5 seconds
        setInterval(() => this.sendMessage('CHECK_CONNECTION'), 5000);
    }

    handlePortMessage(msg) {
        console.log('[PANEL] Received message from service worker:', msg);
        switch (msg.type) {
            case 'PRINTER_STATE_UPDATE':
                this.updatePrinterStateUI(msg.printerType, msg.state);
                break;
            case 'CONNECTION_STATUS':
                this.updateConnectionStatus(msg.data.connected, msg.data.url);
                break;
            case 'PRINT_DATA_RECEIVED':
                // Pass brand to the handler for correct parsing
                this.handlePrintData(msg.payload, msg.deviceType, msg.brand);
                this.flashPrinterIndicator(msg.source);
                break;
            case 'SCALE_DATA_RECEIVED':
                this.logActivity('scale', `Data from ${msg.source} (${msg.scaleType || 'N/A'}): ${msg.payload.length} bytes`);
                this.flashScaleIndicator();
                break;
            case 'DRAWER_COMMAND_RECEIVED':
                console.log('[PANEL] Direct drawer command received:', msg);
                this.logActivity('drawer', `Direct drawer command from ${msg.source} (${msg.drawerType || 'unknown'})`);
                this.triggerDrawerOpen(msg.source);

                // Show notification
                this.showDrawerNotification(1, `Direct ${msg.source}`);
                break;
        }
    }

    flashScaleIndicator() {
        const indicator = document.getElementById('scale-status');
        if (indicator) {
            indicator.classList.add('transmitting');
            setTimeout(() => indicator.classList.remove('transmitting'), 500);
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

    handlePrintData(data, deviceType, brand = 'epson') {
        // ... existing line display handling ...
        if (deviceType === 'line-display') {
            this.logActivity('display', `Line display data received (${data.length} bytes)`);
            const uint8Data = new Uint8Array(data);
            const command = this.lineDisplayParser.parseCommand(uint8Data);

            let line1 = document.getElementById('display-line1');
            let line2 = document.getElementById('display-line2');

            switch (command.command) {
                case 'clear':
                    line1.textContent = ' '.repeat(20);
                    line2.textContent = ' '.repeat(20);
                    this.logActivity('display', 'Display cleared');
                    break;
                case 'text':
                    // This is a naive implementation that overwrites line 1.
                    // A real implementation would need to handle cursor position commands.
                    line1.textContent = (command.data + ' '.repeat(20)).substring(0, 20);
                    this.logActivity('display', `Display text: "${command.data}"`);
                    break;
                case 'position':
                    this.logActivity('display', 'Position command received (not implemented)');
                    break;
                default:
                    this.logActivity('display', `Unknown command received: ${command.hex}`);
                    break;
            }
            // Update the input fields to reflect the change
            document.getElementById('line1-input').value = line1.textContent.trim();
            document.getElementById('line2-input').value = line2.textContent.trim();
            return;
        }

        const receiptContentEl = document.querySelector('.receipt-content');
        console.log(`[PRINT] Received print data for device: ${deviceType}, brand: ${brand}, data length: ${data ? data.length : 0}`);

        try {
            if (!data || data.length === 0) {
                console.warn('[PRINT] Received empty or null print data. No action taken.');
                this.logActivity('printer', 'Received empty print job.');
                return;
            }

            this.logActivity('printer', `Print job received (${brand}, ${data.length} bytes)`);
            let uint8Data;

            // Handle different data formats...
            if (deviceType === 'network-printer' && typeof data === 'string') {
                if (data.trim().startsWith('<')) {
                     // This is ePOS XML, we won't get drawer kick commands from here typically.
                     console.log('[PRINT] Handling as network printer XML string.');
                     const parser = new DOMParser();
                     const xmlDoc = parser.parseFromString(data, "text/xml");
                     const textNodes = xmlDoc.getElementsByTagName('text');
                     let receiptText = '';
                     for (let i = 0; i < textNodes.length; i++) {
                         receiptText += textNodes[i].textContent;
                     }
                     this.displayReceipt(receiptText); // just display text for now
                     return;
                } else {
                    uint8Data = new Uint8Array(data.split('').map(char => char.charCodeAt(0)));
                }
            } else {
                uint8Data = new Uint8Array(data);
            }

            if (uint8Data) {
                console.log('[PRINT] Converted data to Uint8Array for parsing.');
                const parsedData = this.escposParser.parse(uint8Data, brand);
                console.log('[PRINT] Successfully parsed binary data:', parsedData);

                // Check for drawer kick commands
                const drawerCommands = parsedData.commands.filter(cmd => cmd.name === 'drawer_kick');
                if (drawerCommands.length > 0) {
                    console.log(`[PRINT] Found ${drawerCommands.length} drawer kick command(s)!`);
                    this.handleDrawerKickFromPrinter(drawerCommands.length, brand);
                }

                const receiptHtml = this.escposParser.renderToHTML(parsedData);
                console.log('[PRINT] Successfully rendered HTML from parsed data.');
                receiptContentEl.innerHTML = receiptHtml;
            }
        } catch (error) {
            console.error('[PRINT] Critical error in handlePrintData:', error);
            this.logActivity('printer', `ERROR: ${error.message}`);
            receiptContentEl.innerHTML = `Error processing print data: ${error.message}`;
        }
    }

    togglePrinter(printerType, isEnabled) {
        console.log(`[USER-ACTION] Toggled ${printerType} printer ${isEnabled ? 'ON' : 'OFF'}`);
        this.sendMessage('TOGGLE_PRINTER', { printerType, isEnabled });
    }

    updatePrinterStateUI(printerType, state) {
        const toggle = document.getElementById(`${printerType}-printer-toggle`);
        const statusLight = document.getElementById(`${printerType}-printer-status`);
        const brandSelect = document.getElementById(`${printerType}-printer-brand`);

        if (toggle) toggle.checked = state.on;
        if (statusLight) {
            statusLight.classList.toggle('connected', state.on);
        }
        if (brandSelect) brandSelect.value = state.brand || 'epson';
    }

    changePrinterBrand(printerType, brand) {
        console.log(`[USER-ACTION] Changed ${printerType} printer brand to ${brand}`);
        this.sendMessage('CHANGE_PRINTER_BRAND', { printerType, brand });
    }


    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}-panel`));
        this.currentTab = tabName;
    }

    async sendMessage(type, data) {
        if (this.port) {
            console.log(`[PANEL] Sending message to service worker: ${type}`, data);
            this.port.postMessage({ type, data });
        } else {
            console.error(`[PANEL] FAILED to send message. Port not connected. Type: ${type}`, data);
        }
    }

    updateConnectionStatus(connected, url) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-status-text');

        const wasConnected = indicator.classList.contains('connected');

        if (wasConnected !== connected) {
            console.log(`[PANEL] Connection status changed. Connected: ${connected}. URL: ${url}`);
        }

        indicator.classList.toggle('connected', connected);
        indicator.classList.toggle('disconnected', !connected);
        try {
            text.textContent = connected ? `Connected to ${new URL(url).hostname}` : 'Disconnected';
        } catch(e) {
            text.textContent = 'Disconnected';
        }
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

        let testBarcode;
        if (format === 'aamva-pdf417') {
            // Random choice between DL and ID, or let user specify
            const cardTypes = ['DL', 'ID'];
            const randomCardType = cardTypes[Math.floor(Math.random() * cardTypes.length)];
            testBarcode = this.aamvaGenerator.generate(randomCardType);

            // Log what type was generated for debugging
            console.log(`[PANEL] Generated AAMVA ${randomCardType} barcode`);
            this.logActivity('scanner', `Generated AAMVA ${randomCardType} test barcode`);
        } else {
            testBarcode = this.testData.barcodes[format] || 'TEST123456';
        }

        barcodeInput.value = testBarcode;
    }

    // Add the new method:
    generateSpecificAAMVA(cardType) {
        const barcodeInput = document.getElementById('barcode-input');
        const testBarcode = this.aamvaGenerator.generate(cardType);
        barcodeInput.value = testBarcode;
        this.logActivity('scanner', `Generated AAMVA ${cardType} test barcode`);
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
            // This just displays the text, it doesn't simulate a raw print job
            this.displayReceipt(testReceipt);
            this.logActivity('printer', 'Test receipt generated');
            this.updateStatus('Test receipt generated');
        } catch (error) {
            this.showError('Failed to generate test receipt: ' + error.message);
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
            // The user wants to use triggerDrawerOpen for manual open.
            this.triggerDrawerOpen('manual');
        } catch (error) {
            this.showError('Failed to open drawer: ' + error.message);
        }
    }

    async handleDrawerClose() {
        this.updateDrawerVisual(false);
        this.logActivity('drawer', 'Drawer closed');
        this.updateStatus('Cash drawer closed');
    }

    // New method to handle drawer open from any source
    triggerDrawerOpen(source = 'manual') {
        console.log(`[DRAWER] Opening drawer triggered by: ${source}`);
        // We don't need to send a message here as this is the final action handler
        this.updateDrawerVisual(true);
        this.logActivity('drawer', `Drawer opened via ${source}`);
    }

    // Add new method to handle drawer commands from printer
    handleDrawerKickFromPrinter(commandCount, brand) {
        this.logActivity('printer', `🔓 Cash drawer kick command detected! (${commandCount} command${commandCount > 1 ? 's' : ''}) via ${brand} printer`);

        // Add visual indicator to printer tab
        const printerStatus = document.querySelector('.printer-tab .status-light');
        if (printerStatus) {
            printerStatus.style.backgroundColor = '#ff6b35'; // Orange for drawer command
            setTimeout(() => {
                printerStatus.style.backgroundColor = ''; // Reset
            }, 2000);
        }

        // Open the drawer on the drawer tab
        this.triggerDrawerOpen('printer');

        // Show notification on printer tab
        this.showDrawerNotification(commandCount, brand);
    }

    // Add notification method
    showDrawerNotification(commandCount, brand) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'drawer-notification';
        notification.innerHTML = `
        <div class="drawer-notification-content">
            <span class="drawer-notification-icon">🔓</span>
            <div class="drawer-notification-text">
                <div class="drawer-notification-title">Cash Drawer Command Sent!</div>
                <div class="drawer-notification-details">${commandCount} drawer kick${commandCount > 1 ? 's' : ''} via ${brand.toUpperCase()} printer</div>
            </div>
        </div>
    `;

        // Add to printer tab
        const printerTab = document.getElementById('printer-panel');
        if (printerTab) {
            printerTab.insertBefore(notification, printerTab.querySelector('.receipt-display'));

            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 5000);
        }
    }

    updateDrawerVisual(isOpen) {
        const drawer = document.getElementById('drawer-visual');
        const statusText = document.getElementById('drawer-status-text');

        drawer.classList.toggle('open', isOpen);
        statusText.textContent = isOpen ? 'Open' : 'Closed';
    }

    // Scale Methods
    // Enhance existing updateWeight method to sync with interceptor
    updateWeight(value) {
        const weight = parseFloat(value) || 0;
        const unit = document.getElementById('weight-unit-select').value;

        document.getElementById('weight-input').value = weight;
        document.getElementById('weight-slider-input').value = weight;
        // The user's snippet refers to a 'weight-readout' class, which doesn't exist.
        // I will update the existing 'weight-value' element instead.
        document.getElementById('weight-value').textContent = weight.toFixed(2);

        const stableIndicator = document.getElementById('stable-indicator');
        const zeroIndicator = document.getElementById('zero-indicator');
        stableIndicator.classList.toggle('active', true);
        zeroIndicator.classList.toggle('active', weight === 0);
        document.getElementById('weight-unit').textContent = unit;

        // Sync with interceptor through service worker
        this.sendMessage('UPDATE_SCALE', {
            weight: weight,
            unit: unit,
            stable: true
        });

        this.logActivity('scale', `Weight updated: ${weight} ${unit}`);
    }

    updateWeightUnit(unit) {
        // When unit changes, we re-send the whole scale state
        const currentWeight = document.getElementById('weight-input').value;
        this.updateWeight(currentWeight);
    }

    tareScale() {
        this.updateWeight(0);
        // This log message is from the user's request
        this.logActivity('scale', 'Scale tared');
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

    updateDisplayBrightness(value) {
        const brightnessMap = {
            '1': '0.4',
            '2': '0.6',
            '3': '0.8',
            '4': '1.0'
        };
        const display = document.querySelector('.display-screen');
        if (display) {
            display.style.opacity = brightnessMap[value] || '1.0';
        }
        this.logActivity('display', `Brightness set to level ${value}`);
    }

    toggleDisplayBlink(isBlinking) {
        const display = document.querySelector('.display-screen');
        if (display) {
            display.classList.toggle('blinking', isBlinking);
        }
        this.logActivity('display', `Blinking ${isBlinking ? 'enabled' : 'disabled'}`);
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
