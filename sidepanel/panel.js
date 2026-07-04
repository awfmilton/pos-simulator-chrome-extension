/*
 * tbay.tk Virtual Peripheral Simulator
 * Developed by: Alexander Milton — https://tbay.tk
 */
// POS Peripheral Simulator - Panel JavaScript
// Handles UI interactions and communication with service worker

// ── Verbose-logging gate ─────────────────────────────────────────────────────
// Panel traces are gated behind the "Debug Mode" toggle (Settings modal,
// #debug-mode, persisted as posSimulatorSettings.debugMode). console.warn/error
// are never gated. dlog() reads the live checkbox state at call time.
function _panelDebug() {
    try {
        const el = document.getElementById('debug-mode');
        return !!(el && el.checked);
    } catch (e) { return false; }
}
function dlog(...args) { if (_panelDebug()) console.log(...args); }

class POSSimulatorPanel {
    constructor() {
        this.currentTab = 'scanner';
        this.peripheralStates = {};
        this.keepAliveInterval = null;
        this.escposParser = new EscPosParser();
        this.aamvaGenerator = new AAMVAGenerator();
        this.creditCardGenerator = new CreditCardGenerator();
        this.virtualKeyboard = new VirtualKeyboard();
        this.receiptManager = new ReceiptManager();
        this.currentCardData = null;
        this.keyboardMode = 'full';
        this.stripeInstance = null;
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

        // Print job buffering
        this.printDataBuffer = [];
        this.printDataTimer = null;
        this.lastPrintInfo = {};

        this.init();
    }

    init() {
        dlog('[PANEL] POS Simulator Panel initialized');
        this.setupEventListeners();
        this.initializeUI();
        this.connectToServiceWorker();
    }

    setupEventListeners() {
        dlog('[PANEL] Setting up event listeners...');
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.currentTarget.dataset.tab;
                dlog(`[USER-ACTION] Clicked tab: ${tabName}`);
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
            dlog('[USER-ACTION] Clicked "Scan Barcode"');
            this.handleBarcodeScans();
        });
        document.getElementById('generate-barcode-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Generate Test Barcode"');
            this.generateTestBarcode();
        });
        document.getElementById('barcode-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                dlog('[USER-ACTION] Pressed Enter in barcode input');
                this.handleBarcodeScans();
            }
        });

        // Printer events
        document.getElementById('test-print-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Test Print"');
            this.handleTestPrint();
        });
        document.getElementById('clear-receipt-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Clear Receipt"');
            this.clearReceipt();
        });

        // Cash drawer events
        document.getElementById('open-drawer-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Open Drawer"');
            this.handleDrawerOpen();
        });
        document.getElementById('close-drawer-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Close Drawer"');
            this.handleDrawerClose();
        });

        // Scale events
        document.getElementById('weight-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-slider-input').addEventListener('input', (e) => this.updateWeight(e.target.value));
        document.getElementById('weight-unit-select').addEventListener('change', (e) => {
            dlog(`[USER-ACTION] Changed weight unit to: ${e.target.value}`);
            this.updateWeightUnit(e.target.value);
        });
        document.getElementById('tare-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Tare"');
            this.tareScale();
        });
        document.getElementById('zero-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Zero"');
            this.zeroScale();
        });

        // Line display events
        document.getElementById('update-display-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Update Display"');
            this.updateLineDisplay();
        });
        document.getElementById('clear-display-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Clear Display"');
            this.clearLineDisplay();
        });
        document.getElementById('line1-input').addEventListener('input', (e) => this.updateDisplayPreview());
        document.getElementById('line2-input').addEventListener('input', (e) => this.updateDisplayPreview());

        // Display settings
        document.getElementById('display-brightness').addEventListener('input', (e) => this.updateDisplayBrightness(e.target.value));
        document.getElementById('display-blink').addEventListener('change', (e) => this.toggleDisplayBlink(e.target.checked));

        // Global controls
        document.getElementById('reset-all-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Reset All"');
            this.resetAll();
        });
        document.getElementById('settings-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Settings"');
            this.showSettings();
        });

        document.getElementById('start-tour-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Take Tour"');
            this.startFullTour();
        });

        // Settings modal
        document.getElementById('close-settings-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Close Settings"');
            this.hideSettings();
        });
        document.getElementById('save-settings-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Save Settings"');
            this.saveSettings();
        });
        document.getElementById('cancel-settings-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Cancel Settings"');
            this.hideSettings();
        });
        
        // Theme selection
        document.getElementById('theme-preset-select').addEventListener('change', (e) => {
            dlog(`[USER-ACTION] Changed theme to: ${e.target.value}`);
            this.applyTheme(e.target.value);
            this.updateThemePreview(e.target.value);
            this.saveTheme(e.target.value); // Auto-save theme changes
        });

        // Add to setupEventListeners method:
        document.getElementById('generate-dl-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Generate DL"');
            this.generateSpecificAAMVA('DL');
        });

        document.getElementById('generate-id-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Generate ID"');
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

        // Virtual Keyboard events
        document.querySelectorAll('input[name="keyboard-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                dlog(`[USER-ACTION] Changed keyboard mode to: ${e.target.value}`);
                this.setKeyboardMode(e.target.value);
            });
        });

        document.getElementById('type-text-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Type Text"');
            this.typeTextFromInput();
        });

        document.getElementById('keyboard-text-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                dlog('[USER-ACTION] Pressed Enter in keyboard text input');
                this.typeTextFromInput();
            }
        });

        document.getElementById('keyboard-caps-lock').addEventListener('change', (e) => {
            this.virtualKeyboard.toggleCapsLock();
            this.updateKeyboardDisplay();
        });

        document.getElementById('keyboard-num-lock').addEventListener('change', (e) => {
            this.virtualKeyboard.toggleNumLock();
            this.updateKeyboardDisplay();
        });

        document.getElementById('typing-speed').addEventListener('input', (e) => {
            document.getElementById('typing-speed-value').textContent = e.target.value;
        });

        // Credit Card Payment Mode events
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                dlog(`[USER-ACTION] Switched to payment mode: ${mode}`);
                this.switchPaymentMode(mode);
            });
        });

        // Credit Card Provider selection
        document.getElementById('cc-provider').addEventListener('change', (e) => {
            dlog(`[USER-ACTION] Changed card provider to: ${e.target.value}`);
            this.updateCardProvider(e.target.value);
        });

        // Update MSR events to work with new credit card system
        document.getElementById('swipe-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Swipe Card"');
            this.handleCardSwipe();
        });

        document.getElementById('generate-card-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Generate Card"');
            this.generateCreditCard();
        });

        // Tap to Pay events
        document.getElementById('simulate-tap-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Simulate Tap"');
            this.simulateTapPayment();
        });

        document.getElementById('nfc-enable-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Enable NFC"');
            this.toggleNFC();
        });

        document.getElementById('tap-area').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked tap area');
            this.simulateTapPayment();
        });

        // Chip Payment events
        document.getElementById('insert-chip-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Insert Card"');
            this.insertChipCard();
        });

        document.getElementById('remove-chip-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Remove Card"');
            this.removeChipCard();
        });

        // Stripe Integration events
        document.getElementById('stripe-connect-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Connect Stripe"');
            this.connectStripe();
        });

        document.getElementById('stripe-payment-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Process Payment"');
            this.processStripePayment();
        });

        // Receipt Management events
        document.getElementById('download-receipt-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Download Receipt"');
            this.downloadReceipt();
        });

        document.getElementById('email-receipt-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Email Receipt"');
            this.emailReceipt();
        });

        document.getElementById('email-config-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Email Settings"');
            this.showEmailConfig();
        });

        // Email Configuration Modal events
        document.getElementById('close-email-config-btn').addEventListener('click', () => {
            this.hideEmailConfig();
        });

        document.getElementById('save-email-config-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Save Email Configuration"');
            this.saveEmailConfig();
        });

        document.getElementById('test-email-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Send Test Email"');
            this.sendTestEmail();
        });

        document.getElementById('cancel-email-config-btn').addEventListener('click', () => {
            this.hideEmailConfig();
        });

        // Tour Sync Stop Button
        document.getElementById('stop-tour-sync-btn').addEventListener('click', () => {
            dlog('[USER-ACTION] Clicked "Stop" on tour sync banner');
            this.handleTourEvent({ source: 'pos-tour', event: 'tour-ended' });
        });
    }


    initializeUI() {
        this.updateConnectionStatus(false, null);
        this.loadSettings();
        this.initializeNewFeatures();
    }

    connectToServiceWorker() {
        dlog('[PANEL] Connecting to service worker...');
        this.port = chrome.runtime.connect({ name: 'sidepanel' });

        this.port.onMessage.addListener((msg) => this.handlePortMessage(msg));
        this.port.onDisconnect.addListener(() => {
            console.warn('[PANEL] Disconnected from service worker. Reconnecting in 1s...');
            this.port = null;
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
                this.keepAliveInterval = null;
            }
            if (this.checkConnectionInterval) {
                clearInterval(this.checkConnectionInterval);
                this.checkConnectionInterval = null;
            }
            this.updateConnectionStatus(false, null);
            setTimeout(() => this.connectToServiceWorker(), 1000);
        });

        // Start a heartbeat to keep the service worker alive
        this.keepAliveInterval = setInterval(() => {
            this.sendMessage('KEEP_ALIVE');
        }, 20000); // 20 seconds

        // Check connection status every 5 seconds
        this.checkConnectionInterval = setInterval(() => this.sendMessage('CHECK_CONNECTION'), 5000);

        // Initialise the payment terminal simulator module with the SW port
        if (typeof window.initPaymentTerminalSimulator === 'function') {
            window.initPaymentTerminalSimulator(this.port);
            dlog('[PANEL] Payment Terminal Simulator initialized.');
        }
    }

    handlePortMessage(msg) {
        dlog('[PANEL] Received message from service worker:', msg);
        switch (msg.type) {
            case 'PRINTER_STATE_UPDATE':
                this.updatePrinterStateUI(msg.printerType, msg.state);
                break;
            case 'CONNECTION_STATUS':
                this.updateConnectionStatus(msg.data.connected, msg.data.url);
                // When the POS page closes, synthesize a disconnect to revert the terminal light
                if (!msg.data.connected && typeof window.handleTerminalReadySignal === 'function') {
                    window.handleTerminalReadySignal({ enabled: false, brand: null, debug: false, terminalIp: null });
                }
                // Also end any active tour sync if the page disconnects
                if (!msg.data.connected) {
                    this.handleTourEvent({ source: 'pos-tour', event: 'tour-ended' });
                }
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
                dlog('[PANEL] Direct drawer command received:', msg);
                this.logActivity('drawer', `Direct drawer command from ${msg.source} (${msg.drawerType || 'unknown'})`);
                this.triggerDrawerOpen(msg.source);

                this.showDrawerNotification(1, `Direct ${msg.source}`);
                break;
            case 'POS_SIMULATOR_DISPLAY_UPDATE':
                this.updateLineDisplayFromPOS(msg);
                break;
            case 'TOUR_EVENT':
            case 'TOUR_SYNC':
                if (msg.source === 'pos-tour') {
                    this.handleTourEvent(msg);
                }
                break;
            // ── Payment terminal simulator ──────────────────────────
            case 'TERMINAL_CHARGE_REQUEST':
                // A charge has arrived from the POS. Hand off to the terminal simulator module.
                if (typeof window.handleTerminalChargeRequest === 'function') {
                    window.handleTerminalChargeRequest(msg);
                } else {
                    console.warn('[PANEL] handleTerminalChargeRequest not found — payment-terminal-simulator.js may not have loaded.');
                }
                break;
            case 'TERMINAL_READY_SIGNAL':
                // POS settings changed (enabled, brand, IP). Update the connection light.
                if (typeof window.handleTerminalReadySignal === 'function') {
                    window.handleTerminalReadySignal(msg);
                } else {
                    console.warn('[PANEL] handleTerminalReadySignal not found — payment-terminal-simulator.js may not have loaded.');
                }
                break;
            // ── Square POS API (App-Switch) mock flow ───────────────
            case 'SQUARE_POS_MOCK_REQUEST':
                // A Square POS API mock charge arrived from the POS (bypassing URL scheme).
                if (typeof window.handleSquarePOSMockRequest === 'function') {
                    window.handleSquarePOSMockRequest(msg);
                    this.switchTab('terminal');
                } else {
                    console.warn('[PANEL] handleSquarePOSMockRequest not found — payment-terminal-simulator.js may not have loaded.');
                }
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
        // If the source of the print job changes, process the old buffer immediately.
        if (this.lastPrintInfo.deviceType && this.lastPrintInfo.deviceType !== deviceType) {
            this._processBufferedPrintData();
        }

        // Clear any existing timer to reset the timeout.
        if (this.printDataTimer) {
            clearTimeout(this.printDataTimer);
        }

        // Add the new data chunk to the buffer.
        if (typeof data === 'string') {
            const encoder = new TextEncoder();
            this.printDataBuffer.push(encoder.encode(data));
        } else {
            this.printDataBuffer.push(new Uint8Array(data));
        }
        this.lastPrintInfo = { deviceType, brand };

        // Set a timer to process the buffer after a short delay.
        // This allows subsequent chunks of the same print job to be collected.
        this.printDataTimer = setTimeout(() => this._processBufferedPrintData(), 100); // 100ms delay
    }

    _processBufferedPrintData() {
        if (this.printDataBuffer.length === 0) {
            return; // Nothing to process
        }

        const { deviceType, brand } = this.lastPrintInfo;
        const receiptContentEl = document.querySelector('.receipt-content');
        dlog(`[PRINT-BUFFER] Processing buffered data for device: ${deviceType}, brand: ${brand}, chunks: ${this.printDataBuffer.length}`);

        try {
            // Concatenate all buffered chunks into a single Uint8Array
            const totalLength = this.printDataBuffer.reduce((acc, val) => acc + val.length, 0);
            const fullPrintData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of this.printDataBuffer) {
                fullPrintData.set(chunk, offset);
                offset += chunk.length;
            }

            this.logActivity('printer', `Processing buffered job (${brand}, ${fullPrintData.length} bytes)`);

            const parsedData = this.escposParser.parse(fullPrintData, brand);
            dlog('[PRINT-BUFFER] Successfully parsed buffered data:', parsedData);

            // Check for drawer kick commands
            const drawerCommands = parsedData.commands.filter(cmd => cmd.name === 'drawer_kick' || cmd.type === 'drawer_kick');
            if (drawerCommands.length > 0) {
                dlog(`[PRINT-BUFFER] Found ${drawerCommands.length} drawer kick command(s) in buffered data!`);
                this.handleDrawerKickFromPrinter(drawerCommands.length, brand);
            }

            const receiptHtml = this.escposParser.renderToHTML(parsedData);
            dlog('[PRINT-BUFFER] Successfully rendered HTML from buffered data.');
            receiptContentEl.innerHTML = receiptHtml;

        } catch (error) {
            console.error('[PRINT-BUFFER] Critical error in _processBufferedPrintData:', error);
            this.logActivity('printer', `ERROR: ${error.message}`);
            receiptContentEl.innerHTML = `Error processing buffered print data: ${error.message}`;
        } finally {
            // Clear the buffer and timer for the next job
            this.printDataBuffer = [];
            this.printDataTimer = null;
            this.lastPrintInfo = {};
        }
    }

    togglePrinter(printerType, isEnabled) {
        dlog(`[USER-ACTION] Toggled ${printerType} printer ${isEnabled ? 'ON' : 'OFF'}`);
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
        dlog(`[USER-ACTION] Changed ${printerType} printer brand to ${brand}`);
        this.sendMessage('CHANGE_PRINTER_BRAND', { printerType, brand });
    }


    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}-panel`));
        this.currentTab = tabName;
    }

    async sendMessage(type, data) {
        if (this.port) {
            dlog(`[PANEL] Sending message to service worker: ${type}`, data);
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
            dlog(`[PANEL] Connection status changed. Connected: ${connected}. URL: ${url}`);
        }

        indicator.classList.toggle('connected', connected);
        indicator.classList.toggle('disconnected', !connected);
        if (!connected) {
            text.textContent = 'Disconnected';
            return;
        }
        // Connected. Show the host if we have a URL; otherwise (autodetect with
        // no stored target URL) still show "Connected" rather than falling back
        // to "Disconnected" because new URL(null) threw.
        let host = '';
        try { host = url ? new URL(url).hostname : ''; } catch (e) { host = ''; }
        text.textContent = host ? `Connected to ${host}` : 'Connected';
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
            dlog(`[PANEL] Generated AAMVA ${randomCardType} barcode`);
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
    // NOTE: handleMSRSwipe() and generateTestCard() were removed — they were dead
    // code that referenced a #card-type <select> which no longer exists in
    // panel.html (calling .value on the null lookup threw). The live MSR flow is
    // handleCardSwipe() (bound to #swipe-btn) and generateCreditCard() (bound to
    // #generate-card-btn).

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
        dlog(`[DRAWER] Opening drawer triggered by: ${source}`);
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
    updateLineDisplayFromPOS(data) {
        if (!data) return;
        const l1 = data.line1 || '';
        const l2 = data.line2 || '';

        // Update visual mock DOM
        const displayLine1 = document.getElementById('display-line1');
        const displayLine2 = document.getElementById('display-line2');
        if (displayLine1) displayLine1.textContent = l1.padEnd(20, ' ').substring(0, 20);
        if (displayLine2) displayLine2.textContent = l2.padEnd(20, ' ').substring(0, 20);

        // Sync the form inputs
        const inputLine1 = document.getElementById('line1-input');
        const inputLine2 = document.getElementById('line2-input');
        if (inputLine1) inputLine1.value = l1.trimEnd();
        if (inputLine2) inputLine2.value = l2.trimEnd();

        this.logActivity('display', `Display updated from POS: "${l1.trim()}" / "${l2.trim()}"`);
    }

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

    // Theme Management Functions
    applyTheme(themeName) {
        // Remove all existing theme classes
        const themeClasses = ['theme-default', 'theme-dark', 'theme-dos-green', 'theme-dos-red', 'theme-dos-white', 'theme-lcars', 'theme-futuristic', 'theme-tbay'];
        document.body.classList.remove(...themeClasses);
        
        // Apply the selected theme
        if (themeName !== 'default') {
            document.body.classList.add(`theme-${themeName}`);
        }
        
        dlog(`[THEME] Applied theme: ${themeName}`);
        this.updateStatus(`Theme changed to ${this.getThemeDisplayName(themeName)}`);
    }

    updateThemePreview(themeName) {
        const preview = document.getElementById('theme-preview');
        const previewCard = preview.querySelector('.preview-card');
        const previewButton = preview.querySelector('.preview-button');
        const previewText = preview.querySelector('.preview-text');
        
        // Reset preview classes
        const themeClasses = ['theme-default', 'theme-dark', 'theme-dos-green', 'theme-dos-red', 'theme-dos-white', 'theme-lcars', 'theme-futuristic', 'theme-tbay'];
        preview.classList.remove(...themeClasses.map(cls => `preview-${cls}`));
        
        // Apply preview theme styles
        if (themeName !== 'default') {
            preview.classList.add(`preview-theme-${themeName}`);
        }
        
        // Update preview content based on theme
        switch (themeName) {
            case 'dos-green':
                previewButton.textContent = 'EXECUTE';
                previewText.textContent = 'C:\\DOS> READY';
                break;
            case 'dos-red':
                previewButton.textContent = 'EXECUTE';
                previewText.textContent = 'C:\\DOS> READY';
                break;
            case 'dos-white':
                previewButton.textContent = 'EXECUTE';
                previewText.textContent = 'C:\\DOS> READY';
                break;
            case 'lcars':
                previewButton.textContent = 'ENGAGE';
                previewText.textContent = 'LCARS ONLINE';
                break;
            case 'futuristic':
                previewButton.textContent = 'INITIALIZE';
                previewText.textContent = 'System Ready';
                break;
            case 'dark':
                previewButton.textContent = 'Primary Button';
                previewText.textContent = 'Dark theme enabled';
                break;
            case 'tbay':
                previewButton.textContent = 'Approve';
                previewText.textContent = 'tbay.tk brand active';
                break;
            default:
                previewButton.textContent = 'Primary Button';
                previewText.textContent = 'Sample text content';
        }
    }

    getThemeDisplayName(themeName) {
        const themeNames = {
            'tbay': 'tbay.tk Brand',
            'default': 'Default',
            'dark': 'Dark Mode',
            'dos-green': 'DOS Terminal (Green)',
            'dos-red': 'DOS Terminal (Red)',
            'dos-white': 'DOS Terminal (White)',
            'lcars': 'Star Trek LCARS',
            'futuristic': 'Clean Futuristic'
        };
        return themeNames[themeName] || themeName;
    }

    loadTheme() {
        chrome.storage.local.get('posSimulatorTheme', (result) => {
            const theme = result.posSimulatorTheme || 'tbay';
            document.getElementById('theme-preset-select').value = theme;
            this.applyTheme(theme);
            this.updateThemePreview(theme);
            dlog(`[THEME] Loaded saved theme: ${theme}`);
        });
    }

    saveTheme(themeName) {
        chrome.storage.local.set({ posSimulatorTheme: themeName }, () => {
            dlog(`[THEME] Saved theme: ${themeName}`);
        });
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
        const selectedTheme = document.getElementById('theme-preset-select').value;
        
        chrome.storage.local.set({ 
            posSimulatorSettings: settings,
            posSimulatorTheme: selectedTheme
        }, () => {
            this.updateStatus('Settings saved');
            this.hideSettings();
            this.sendMessage('SETTINGS_UPDATED', settings);
            this.saveTheme(selectedTheme);
        });
    }

    loadSettings() {
        chrome.storage.local.get(['posSimulatorSettings', 'posSimulatorTheme'], (result) => {
            if (result.posSimulatorSettings) {
                const settings = result.posSimulatorSettings;
                document.getElementById('target-url').value = settings.targetUrl || '';
                document.getElementById('debug-mode').checked = settings.debugMode || false;
                document.getElementById('auto-detect-inputs').checked = settings.autoDetectInputs !== false;
            }
            
            // Load theme
            const theme = result.posSimulatorTheme || 'tbay';
            document.getElementById('theme-preset-select').value = theme;
            this.applyTheme(theme);
            this.updateThemePreview(theme);
        });
    }

    // ===== NEW FEATURES METHODS =====

    // Virtual Keyboard Methods
    setKeyboardMode(mode) {
        this.keyboardMode = mode;
        this.virtualKeyboard.setMode(mode);
        this.renderVirtualKeyboard();
        this.logActivity('keyboard', `Switched to ${mode} mode`);
    }

    renderVirtualKeyboard() {
        const container = document.getElementById('virtual-keyboard');
        const keyMatrix = this.virtualKeyboard.generateKeyMatrix();
        
        container.innerHTML = '';
        
        keyMatrix.forEach(row => {
            const rowElement = document.createElement('div');
            rowElement.className = 'keyboard-row';
            
            row.forEach(keyInfo => {
                const keyElement = document.createElement('button');
                keyElement.className = `keyboard-key ${keyInfo.type}`;
                keyElement.textContent = keyInfo.label;
                keyElement.style.flex = keyInfo.width > 1 ? keyInfo.width : 'none';
                
                keyElement.addEventListener('click', () => {
                    this.handleVirtualKeyPress(keyInfo.id);
                });
                
                rowElement.appendChild(keyElement);
            });
            
            container.appendChild(rowElement);
        });
    }

    handleVirtualKeyPress(keyId) {
        const success = this.virtualKeyboard.pressKey(keyId);
        if (success) {
            this.flashKeyPress(keyId);
            this.logActivity('keyboard', `Pressed key: ${keyId}`);
        }
    }

    flashKeyPress(keyId) {
        const keyElements = document.querySelectorAll('.keyboard-key');
        keyElements.forEach(element => {
            if (element.textContent === this.virtualKeyboard.getKeyLabel(keyId)) {
                element.classList.add('pressed');
                setTimeout(() => element.classList.remove('pressed'), 150);
            }
        });
    }

    typeTextFromInput() {
        const text = document.getElementById('keyboard-text-input').value;
        if (!text) return;
        
        const speed = document.getElementById('typing-speed').value;
        const delay = Math.max(10, 100 - (speed * 9)); // Convert 1-10 to ~90-10ms delay
        
        this.virtualKeyboard.typeString(text, { delay });
        this.logActivity('keyboard', `Typing text: "${text}" (speed: ${speed})`);
        
        // Clear input after typing
        document.getElementById('keyboard-text-input').value = '';
    }

    updateKeyboardDisplay() {
        this.renderVirtualKeyboard();
    }

    // Credit Card & Payment Methods
    switchPaymentMode(mode) {
        // Hide all mode panels
        document.querySelectorAll('.payment-mode-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        // Show selected mode panel
        document.getElementById(`${mode}-mode`).classList.add('active');
        
        // Update mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
        
        this.logActivity('creditcard', `Switched to ${mode} payment mode`);
    }

    generateCreditCard() {
        const provider = document.getElementById('cc-provider').value;
        this.currentCardData = this.creditCardGenerator.generateCard(provider);
        
        this.updateCardDisplay();
        this.updateTrackData();
        
        this.logActivity('creditcard', `Generated ${this.currentCardData.providerName} card: ${this.currentCardData.formattedNumber}`);
    }

    updateCardDisplay() {
        if (!this.currentCardData) return;
        
        const cardVisual = document.querySelector('.card-visual');
        cardVisual.querySelector('.card-number').textContent = this.currentCardData.formattedNumber;
        cardVisual.querySelector('.card-holder').textContent = this.currentCardData.cardholderName;
        cardVisual.querySelector('.card-expiry').textContent = `${this.currentCardData.expirationMonth}/${this.currentCardData.expirationYear}`;
        cardVisual.querySelector('.card-cvv').textContent = this.currentCardData.cvv;
    }

    updateTrackData() {
        if (!this.currentCardData) return;
        
        document.getElementById('track1-input').value = this.currentCardData.track1;
        document.getElementById('track2-input').value = this.currentCardData.track2;
    }

    updateCardProvider(provider) {
        // Auto-generate new card with selected provider
        this.generateCreditCard();
    }

    handleCardSwipe() {
        const track1 = document.getElementById('track1-input').value;
        const track2 = document.getElementById('track2-input').value;
        
        if (!track1 && !track2) {
            this.updateStatus('No track data to swipe', 'warning');
            return;
        }
        
        const msrData = {
            track1: track1 || null,
            track2: track2 || null,
            timestamp: Date.now()
        };
        
        this.sendMessage('MSR_SWIPE', msrData);
        this.logActivity('creditcard', `Card swiped: ${track1 ? 'Track 1' : ''}${track1 && track2 ? ' & ' : ''}${track2 ? 'Track 2' : ''}`);
        this.updateStatus('Card swiped successfully');
    }

    // Tap to Pay Methods
    simulateTapPayment() {
        const tapArea = document.getElementById('tap-area');
        const animation = document.getElementById('tap-animation');
        
        tapArea.classList.add('active');
        animation.classList.add('animating');
        
        // Play NFC sound if enabled
        if (document.getElementById('nfc-sounds').checked) {
            this.playNFCSound();
        }
        
        // Generate NFC data for tap payment
        const provider = document.getElementById('cc-provider').value;
        const nfcData = this.creditCardGenerator.generateNFCData(provider);
        
        setTimeout(() => {
            tapArea.classList.remove('active');
            animation.classList.remove('animating');
            
            this.sendMessage('NFC_TAP', nfcData);
            this.logActivity('creditcard', `NFC tap payment: ${nfcData.formattedNumber}`);
            this.updateStatus('Tap payment processed');
        }, 2000);
    }

    toggleNFC() {
        const btn = document.getElementById('nfc-enable-btn');
        const isEnabled = btn.textContent.includes('Disable');
        
        if (isEnabled) {
            btn.textContent = '📡 Enable NFC';
            btn.classList.remove('primary-btn');
            btn.classList.add('secondary-btn');
            this.logActivity('creditcard', 'NFC disabled');
        } else {
            btn.textContent = '📡 Disable NFC';
            btn.classList.remove('secondary-btn');
            btn.classList.add('primary-btn');
            this.logActivity('creditcard', 'NFC enabled');
        }
    }

    playNFCSound() {
        // Create a simple beep sound using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (error) {
            console.warn('Could not play NFC sound:', error);
        }
    }

    // Chip Payment Methods
    insertChipCard() {
        const chipCard = document.getElementById('chip-card');
        const insertBtn = document.getElementById('insert-chip-btn');
        const removeBtn = document.getElementById('remove-chip-btn');
        
        chipCard.style.display = 'block';
        insertBtn.disabled = true;
        removeBtn.disabled = false;
        
        // Generate chip transaction data
        if (this.currentCardData) {
            const chipData = {
                ...this.currentCardData,
                interface: 'chip',
                cryptogram: this.generateCryptogram(),
                timestamp: Date.now()
            };
            
            this.sendMessage('CHIP_INSERT', chipData);
            this.logActivity('creditcard', `Chip card inserted: ${this.currentCardData.formattedNumber}`);
            this.updateStatus('Chip card inserted');
        }
    }

    removeChipCard() {
        const chipCard = document.getElementById('chip-card');
        const insertBtn = document.getElementById('insert-chip-btn');
        const removeBtn = document.getElementById('remove-chip-btn');
        
        chipCard.style.display = 'none';
        insertBtn.disabled = false;
        removeBtn.disabled = true;
        
        this.sendMessage('CHIP_REMOVE', { timestamp: Date.now() });
        this.logActivity('creditcard', 'Chip card removed');
        this.updateStatus('Chip card removed');
    }

    generateCryptogram() {
        // Generate a mock cryptogram for EMV simulation
        const chars = '0123456789ABCDEF';
        let result = '';
        for (let i = 0; i < 16; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Stripe Integration Methods
    async connectStripe() {
        const publishableKey = document.getElementById('stripe-pk').value;
        const secretKey = document.getElementById('stripe-sk').value;
        
        if (!publishableKey || !secretKey) {
            this.updateStatus('Please enter both Stripe keys', 'warning');
            return;
        }
        
        try {
            // Initialize Stripe (this would need the actual Stripe.js library)
            this.stripeInstance = {
                publishableKey,
                secretKey,
                connected: true
            };
            
            const statusElement = document.getElementById('stripe-status');
            statusElement.classList.add('connected');
            statusElement.querySelector('.status-text').textContent = 'Connected to Stripe';
            
            document.getElementById('stripe-payment-btn').disabled = false;
            
            this.logActivity('creditcard', 'Connected to Stripe');
            this.updateStatus('Stripe connected successfully');
            
        } catch (error) {
            console.error('Stripe connection failed:', error);
            this.updateStatus('Stripe connection failed', 'error');
        }
    }

    async processStripePayment() {
        if (!this.stripeInstance || !this.stripeInstance.connected) {
            this.updateStatus('Stripe not connected', 'warning');
            return;
        }
        
        const amount = parseFloat(document.getElementById('stripe-amount').value);
        if (!amount || amount < 0.50) {
            this.updateStatus('Amount must be at least $0.50', 'warning');
            return;
        }
        
        try {
            // Mock Stripe payment processing
            const paymentData = {
                amount: Math.round(amount * 100), // Convert to cents
                currency: 'usd',
                payment_method: 'card',
                card: this.currentCardData,
                timestamp: Date.now()
            };
            
            // Simulate processing delay
            this.updateStatus('Processing payment...');
            
            setTimeout(() => {
                const success = Math.random() > 0.1; // 90% success rate for testing
                
                if (success) {
                    const transactionId = 'txn_' + Date.now();
                    this.logActivity('creditcard', `Stripe payment processed: $${amount.toFixed(2)} - ${transactionId}`);
                    this.updateStatus(`Payment successful: ${transactionId}`);
                } else {
                    this.logActivity('creditcard', `Stripe payment failed: $${amount.toFixed(2)}`);
                    this.updateStatus('Payment declined', 'error');
                }
            }, 2000);
            
        } catch (error) {
            console.error('Stripe payment failed:', error);
            this.updateStatus('Payment processing failed', 'error');
        }
    }

    // Receipt Management Methods
    async downloadReceipt() {
        try {
            const format = document.getElementById('receipt-format').value;
            const receiptData = this.getCurrentReceiptData();
            
            if (!receiptData) {
                this.updateStatus('No receipt data available', 'warning');
                return;
            }
            
            if (format === 'pdf' || format === 'both') {
                const pdfReceipt = await this.receiptManager.generatePDF(receiptData);
                await this.receiptManager.downloadReceipt(pdfReceipt);
            }
            
            if (format === 'text' || format === 'both') {
                const textReceipt = this.receiptManager.generateTextReceipt(receiptData);
                await this.receiptManager.downloadReceipt(textReceipt);
            }
            
            this.updateReceiptHistory();
            this.logActivity('printer', `Receipt downloaded as ${format}`);
            this.updateStatus('Receipt downloaded successfully');
            
        } catch (error) {
            console.error('Download failed:', error);
            this.updateStatus('Download failed', 'error');
        }
    }

    async emailReceipt() {
        try {
            const email = document.getElementById('receipt-email').value || 'alex@tbay.tk';
            const format = document.getElementById('receipt-format').value;
            const receiptData = this.getCurrentReceiptData();
            
            if (!receiptData) {
                this.updateStatus('No receipt data available', 'warning');
                return;
            }
            
            let receiptRecord;
            if (format === 'pdf') {
                receiptRecord = await this.receiptManager.generatePDF(receiptData);
            } else {
                receiptRecord = this.receiptManager.generateTextReceipt(receiptData);
            }
            
            await this.receiptManager.emailReceipt(receiptRecord, email);
            
            this.updateReceiptHistory();
            this.logActivity('printer', `Receipt emailed to ${email}`);
            this.updateStatus('Receipt emailed successfully');
            
        } catch (error) {
            console.error('Email failed:', error);
            this.updateStatus('Email failed: ' + error.message, 'error');
        }
    }

    getCurrentReceiptData() {
        // Extract receipt data from the current receipt display
        const receiptContent = document.querySelector('.receipt-content');
        if (!receiptContent) return null;
        
        const lines = Array.from(receiptContent.querySelectorAll('.receipt-line'))
            .map(line => line.textContent);
        
        return {
            storeName: 'POS Simulator Store',
            storeAddress: '123 Test Street, Test City, TS 12345',
            storePhone: '(555) 123-4567',
            items: this.extractItemsFromReceipt(lines),
            total: this.extractTotalFromReceipt(lines),
            receiptNumber: this.receiptManager.generateReceiptNumber(),
            cashier: 'Simulator User'
        };
    }

    extractItemsFromReceipt(lines) {
        const items = [];
        // Simple extraction logic - this would be more sophisticated in practice
        for (const line of lines) {
            if (line.includes('$') && !line.includes('Total') && !line.includes('Tax')) {
                const match = line.match(/(.+)\s+\$?([\d.]+)/);
                if (match) {
                    items.push({
                        name: match[1].trim(),
                        price: parseFloat(match[2]) || 0,
                        quantity: 1
                    });
                }
            }
        }
        return items;
    }

    extractTotalFromReceipt(lines) {
        for (const line of lines) {
            if (line.toLowerCase().includes('total')) {
                const match = line.match(/\$?([\d.]+)/);
                if (match) {
                    return parseFloat(match[1]) || 0;
                }
            }
        }
        return 0;
    }

    updateReceiptHistory() {
        const historyList = document.getElementById('receipt-history-list');
        const history = this.receiptManager.getReceiptHistory();
        
        if (history.length === 0) {
            historyList.innerHTML = '<div class="history-item">No receipts generated yet</div>';
            return;
        }
        
        historyList.innerHTML = history.slice(-5).reverse().map(receipt => `
            <div class="history-item">
                <div class="item-info">
                    <div>Receipt ${receipt.id}</div>
                    <div class="item-date">${new Date(receipt.timestamp).toLocaleString()}</div>
                </div>
                <div class="item-actions">
                    <span class="item-format">${receipt.format.toUpperCase()}</span>
                </div>
            </div>
        `).join('');
    }

    // Email Configuration Methods
    showEmailConfig() {
        document.getElementById('email-config-modal').style.display = 'flex';
    }

    hideEmailConfig() {
        document.getElementById('email-config-modal').style.display = 'none';
    }

    async saveEmailConfig() {
        const config = {
            smtpServer: document.getElementById('smtp-server').value,
            smtpPort: parseInt(document.getElementById('smtp-port').value),
            email: document.getElementById('smtp-email').value,
            password: document.getElementById('smtp-password').value,
            secure: document.getElementById('smtp-secure').checked
        };
        
        if (!config.smtpServer || !config.email || !config.password) {
            this.updateStatus('Please fill in all required fields', 'warning');
            return;
        }
        
        try {
            this.receiptManager.configureEmail(config);
            this.updateStatus('Email configuration saved');
            this.hideEmailConfig();
            this.logActivity('printer', 'Email configuration updated');
        } catch (error) {
            console.error('Failed to save email config:', error);
            this.updateStatus('Failed to save email configuration', 'error');
        }
    }

    async sendTestEmail() {
        try {
            const testReceipt = this.receiptManager.generateTextReceipt({
                storeName: 'Test Store',
                items: [{ name: 'Test Item', price: 1.00, quantity: 1 }],
                total: 1.00
            });
            
            const testEmail = document.getElementById('smtp-email').value;
            await this.receiptManager.emailReceipt(testReceipt, testEmail, {
                subject: 'Test Email from POS Simulator',
                customBody: 'This is a test email to verify your email configuration is working correctly.'
            });
            
            this.updateStatus('Test email sent successfully');
        } catch (error) {
            console.error('Test email failed:', error);
            this.updateStatus('Test email failed: ' + error.message, 'error');
        }
    }

    startFullTour() {
        if (window.simTourEngine && window.simTourRegistry) {
            const allSteps = window.simTourRegistry.getFullTourSteps();
            window.simTourEngine.start(allSteps);
        } else {
            console.error('[PANEL] Tour system not loaded');
        }
    }

    /**
     * React to POS tour lifecycle events.
     * Coordination protocol source: "pos-tour", version: 1.
     */
    handleTourEvent(msg) {
        if (!msg || !msg.event) return;
        dlog('[TOUR-SYNC] Handling tour event:', msg.event, msg.payload);

        const banner = document.getElementById('tour-sync-banner');

        switch (msg.event) {
            case 'tour-started':
                // Enter follow mode
                if (banner) banner.style.display = 'block';
                // Pause standalone autoplay so they don't fight
                if (window.simTourEngine && window.simTourEngine.isActive) {
                    window.simTourEngine.stop();
                }
                break;

            case 'age-gate-reached':
                // 1. Highlight the scanner
                this.switchTab('scanner');
                if (window.simTourEngine) {
                    window.simTourEngine.showAdHocStep({
                        target: '#scanner-panel h2',
                        title: 'POS Age-Gate Reached',
                        body: 'The POS needs an ID scan. Generating and injecting a simulated AAMVA ID...',
                        placement: 'bottom'
                    });
                }
                // 2. Feed a simulated ID scan back to the POS
                const idBarcode = this.aamvaGenerator.generateIDCard();
                dlog('[TOUR-SYNC] Injecting simulated ID scan for age-gate:', idBarcode);
                this.sendMessage('SCAN_BARCODE', {
                    barcode: idBarcode,
                    format: 'aamva-pdf417',
                    simulateEnter: true
                });
                break;

            case 'demo-transaction-complete':
                // Highlight the receipt / printer area
                this.switchTab('printer');
                if (window.simTourEngine) {
                    window.simTourEngine.showAdHocStep({
                        target: '#receipt-display',
                        title: 'Transaction Complete',
                        body: 'The POS has finished the demo transaction. The receipt is displayed here.',
                        placement: 'top'
                    });
                }
                break;

            case 'tour-ended':
                // Exit follow mode
                if (banner) banner.style.display = 'none';
                if (window.simTourEngine) {
                    window.simTourEngine.stop();
                }
                break;

            default:
                dlog('[TOUR-SYNC] Unhandled tour event:', msg.event);
        }
    }

    // Initialize new features
    initializeNewFeatures() {
        // Set default email
        document.getElementById('receipt-email').value = 'alex@tbay.tk';
        
        // Initialize virtual keyboard
        this.renderVirtualKeyboard();
        
        // Generate initial credit card
        setTimeout(() => {
            this.generateCreditCard();
        }, 100);
        
        // Update receipt history
        this.updateReceiptHistory();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.posSimulator = new POSSimulatorPanel();
});
