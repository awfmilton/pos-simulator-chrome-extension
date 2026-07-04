/**
 * Definitive tour steps for every peripheral and feature
 */

(function() {
    const { simTourRegistry, SimTourSection, SimTourStep } = window;

    // ── 1. Barcode Scanner ───────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'scanner',
        title: 'Barcode Scanner',
        icon: '📱',
        tab: 'scanner',
        steps: [
            {
                id: 'scanner-intro',
                feature: 'scanner',
                tab: 'scanner',
                target: '#scanner-panel h2',
                title: 'Barcode Scanner',
                body: 'The scanner simulator allows you to trigger barcode events as if they were coming from a physical USB or Serial scanner.',
                placement: 'bottom'
            },
            {
                id: 'scanner-format',
                feature: 'scanner',
                tab: 'scanner',
                target: '#barcode-format',
                title: 'Format Selection',
                body: 'Choose from common retail formats like UPC-A, Code 128, or QR codes.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.fillField('#barcode-format', 'upc-a');
                    await ctx.fillField('#barcode-input', '012345678905');
                }
            },
            {
                id: 'scanner-scan',
                feature: 'scanner',
                tab: 'scanner',
                target: '#scan-btn',
                title: 'Simulate Scan',
                body: 'Clicking "Scan Barcode" sends the data to the POS page. It can even simulate character-by-character typing.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.clickAndWait('#scan-btn');
                }
            },
            {
                id: 'scanner-aamva',
                feature: 'scanner',
                tab: 'scanner',
                target: '#barcode-format',
                title: 'AAMVA Driver Licenses',
                body: 'The simulator can also generate complex AAMVA PDF417 barcodes used on North American driver licenses.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.fillField('#barcode-format', 'aamva-pdf417');
                    // This reveals #aamva-specific-buttons
                    await ctx.sleep(200);
                }
            },
            {
                id: 'scanner-aamva-btns',
                feature: 'scanner',
                tab: 'scanner',
                target: '#aamva-specific-buttons',
                title: 'Generate License Data',
                body: 'Use these buttons to generate random but valid Driver License or ID card data for age verification testing.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#generate-dl-btn');
                }
            },
            {
                id: 'scanner-log',
                feature: 'scanner',
                tab: 'scanner',
                target: '#scanner-log',
                title: 'Scan Log',
                body: 'All simulated scans are logged here for verification, showing the data sent to the POS.',
                placement: 'top'
            }
        ]
    }));

    // ── 2. Virtual Keyboard ──────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'keyboard',
        title: 'Virtual Keyboard',
        icon: '⌨️',
        tab: 'keyboard',
        steps: [
            {
                id: 'keyboard-intro',
                feature: 'keyboard',
                tab: 'keyboard',
                target: '#keyboard-panel h2',
                title: 'Virtual Keyboard',
                body: 'Test how your POS handles physical keyboard input without having to type on your own device.',
                placement: 'bottom'
            },
            {
                id: 'keyboard-layout',
                feature: 'keyboard',
                tab: 'keyboard',
                target: '#virtual-keyboard',
                title: 'Interactive Keys',
                body: 'You can click individual keys to send them to the POS, supporting modifiers like Shift, Caps Lock, and Num Lock.',
                placement: 'top'
            },
            {
                id: 'keyboard-typing',
                feature: 'keyboard',
                tab: 'keyboard',
                target: '#keyboard-text-input',
                title: 'Bulk Typing',
                body: 'Type a whole string here and click "Type Text" to simulate a high-speed typist entering data.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.fillField('#keyboard-text-input', 'Hello World!');
                    await ctx.clickAndWait('#type-text-btn', 800);
                }
            }
        ]
    }));

    // ── 3. MSR / Credit Card ─────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'creditcard',
        title: 'MSR / Credit Card',
        icon: '💳',
        tab: 'creditcard',
        steps: [
            {
                id: 'cc-intro',
                feature: 'creditcard',
                tab: 'creditcard',
                target: '#creditcard-panel h2',
                title: 'Credit Card & MSR',
                body: 'Simulate legacy magnetic stripe (MSR) swipes, or modern interfaces like Tap and Chip.',
                placement: 'bottom'
            },
            {
                id: 'cc-modes',
                feature: 'creditcard',
                tab: 'creditcard',
                target: '.payment-modes',
                title: 'Interface Modes',
                body: 'Switch between MSR, Tap, Chip, and direct Stripe API simulation.',
                placement: 'bottom'
            },
            {
                id: 'cc-generate',
                feature: 'creditcard',
                tab: 'creditcard',
                target: '#generate-card-btn',
                title: 'Generate Test Cards',
                body: 'Generate random test card numbers and their corresponding Track 1 / Track 2 data for any provider.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#generate-card-btn');
                }
            },
            {
                id: 'cc-swipe',
                feature: 'creditcard',
                tab: 'creditcard',
                target: '#swipe-btn',
                title: 'Simulate Swipe',
                body: 'Clicking "Swipe Card" sends the track data through the virtual MSR interface to your application.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#swipe-btn');
                }
            }
        ]
    }));

    // ── 4. ESC/POS Printer ───────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'printer',
        title: 'ESC/POS Printer',
        icon: '🖨️',
        tab: 'printer',
        steps: [
            {
                id: 'printer-intro',
                feature: 'printer',
                tab: 'printer',
                target: '#printer-panel h2',
                title: 'Receipt Printer',
                body: 'The printer simulator intercepts ESC/POS raw data and renders it as a pixel-perfect thermal receipt.',
                placement: 'bottom'
            },
            {
                id: 'printer-toggles',
                feature: 'printer',
                tab: 'printer',
                target: '.printer-connection-controls',
                title: 'Connection Types',
                body: 'Simulate USB, Bluetooth, Serial, or Network printers. Each can be toggled independently.',
                placement: 'bottom'
            },
            {
                id: 'printer-test',
                feature: 'printer',
                tab: 'printer',
                target: '#test-print-btn',
                title: 'Test Printing',
                body: 'Generate a standard test receipt to verify the parser and renderer are working correctly.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#test-print-btn');
                }
            },
            {
                id: 'printer-display',
                feature: 'printer',
                tab: 'printer',
                target: '#receipt-display',
                title: 'Live Preview',
                body: 'Your actual POS receipts will appear here in real-time, exactly as they would on paper.',
                placement: 'top'
            },
            {
                id: 'printer-mgmt',
                feature: 'printer',
                tab: 'printer',
                target: '.receipt-management',
                title: 'Digital Receipts',
                body: 'Once printed, you can download receipts as PDF/Text or even email them for digital records.',
                placement: 'top'
            }
        ]
    }));

    // ── 5. Cash Drawer ───────────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'drawer',
        title: 'Cash Drawer',
        icon: '💰',
        tab: 'drawer',
        steps: [
            {
                id: 'drawer-intro',
                feature: 'drawer',
                tab: 'drawer',
                target: '#drawer-panel h2',
                title: 'Cash Drawer',
                body: 'Monitor and test cash drawer opening commands sent from your POS.',
                placement: 'bottom'
            },
            {
                id: 'drawer-visual',
                feature: 'drawer',
                tab: 'drawer',
                target: '#drawer-visual',
                title: 'Drawer Status',
                body: 'The drawer will pop open visually when the correct command is received via a printer or serial port.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.clickAndWait('#open-drawer-btn');
                }
            },
            {
                id: 'drawer-close',
                feature: 'drawer',
                tab: 'drawer',
                target: '#close-drawer-btn',
                title: 'Manual Reset',
                body: 'You can manually close the drawer to prepare for the next transaction.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#close-drawer-btn');
                }
            }
        ]
    }));

    // ── 6. Weight Scale ──────────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'scale',
        title: 'Weight Scale',
        icon: '⚖️',
        tab: 'scale',
        steps: [
            {
                id: 'scale-intro',
                feature: 'scale',
                tab: 'scale',
                target: '#scale-panel h2',
                title: 'Weight Scale',
                body: 'Simulate high-precision retail scales (like Mettler Toledo or Detecto) via WebUSB and WebSerial.',
                placement: 'bottom'
            },
            {
                id: 'scale-readout',
                feature: 'scale',
                tab: 'scale',
                target: '.scale-display',
                title: 'Live Readout',
                body: 'Shows the current weight, unit, and stability indicators.',
                placement: 'bottom'
            },
            {
                id: 'scale-input',
                feature: 'scale',
                tab: 'scale',
                target: '#weight-input',
                title: 'Adjust Weight',
                body: 'Use the slider or input to set a specific weight. The POS will see this value instantly.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.fillField('#weight-input', '12.45');
                }
            },
            {
                id: 'scale-tare',
                feature: 'scale',
                tab: 'scale',
                target: '#tare-btn',
                title: 'Zero & Tare',
                body: 'Test scale management commands like Zero and Tare from your application.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.clickAndWait('#zero-btn');
                }
            }
        ]
    }));

    // ── 7. Line Display ──────────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'display',
        title: 'Line Display',
        icon: '🖥️',
        tab: 'display',
        steps: [
            {
                id: 'display-intro',
                feature: 'display',
                tab: 'display',
                target: '#display-panel h2',
                title: '2×20 Line Display',
                body: 'Simulate a vacuum fluorescent display (VFD) used to show prices and messages to customers.',
                placement: 'bottom'
            },
            {
                id: 'display-screen',
                feature: 'display',
                tab: 'display',
                target: '.line-display-visual',
                title: 'Visual Feedback',
                body: 'The display supports two lines of 20 characters, with optional blinking and brightness control.',
                placement: 'bottom'
            },
            {
                id: 'display-update',
                feature: 'display',
                tab: 'display',
                target: '#update-display-btn',
                title: 'Update Content',
                body: 'Manually test display updates, or send commands from your POS via the simulated serial port.',
                placement: 'top',
                action: async (ctx) => {
                    await ctx.fillField('#line1-input', 'TOTAL: $45.99');
                    await ctx.fillField('#line2-input', 'THANK YOU!');
                    await ctx.clickAndWait('#update-display-btn');
                }
            }
        ]
    }));

    // ── 8. Payment Terminal ──────────────────────────────────────────────────
    simTourRegistry.register(new SimTourSection({
        id: 'terminal',
        title: 'Payment Terminal',
        icon: '💳',
        tab: 'terminal',
        steps: [
            {
                id: 'terminal-intro',
                feature: 'terminal',
                tab: 'terminal',
                target: '#terminal-panel h2',
                title: 'Payment Terminal',
                body: 'The heart of the simulator. It models a physical cloud-connected credit card terminal.',
                placement: 'bottom'
            },
            {
                id: 'terminal-brand',
                feature: 'terminal',
                tab: 'terminal',
                target: '#terminal-brand-select',
                title: '9 Gateway Simulators',
                body: 'Choose between Stripe, Moneris, Square, PayPal, and more. Each produces the exact JSON response expected by that provider.',
                placement: 'bottom',
                action: async (ctx) => {
                    await ctx.fillField('#terminal-brand-select', 'stripe');
                }
            },
            {
                id: 'terminal-environment',
                feature: 'terminal',
                tab: 'terminal',
                target: '#ext-environment-select',
                title: 'Mock vs Sandbox',
                body: 'Run in "Mock" mode for instant local testing, or "Sandbox" to hit real developer APIs.',
                placement: 'bottom'
            },
            {
                id: 'terminal-log',
                feature: 'terminal',
                tab: 'terminal',
                target: '.activity-log.terminal-log',
                title: 'Transaction Log',
                body: 'Incoming charge requests from your POS appear here for the operator to handle.',
                placement: 'top'
            },
            {
                id: 'terminal-approvals',
                feature: 'terminal',
                tab: 'terminal',
                target: '.button-group.terminal-action-group',
                title: 'Operator Controls',
                body: 'As an operator, you can manually Approve, Decline (NSF, Stolen, Expired), or let the transaction Timeout.',
                placement: 'top'
            },
            {
                id: 'terminal-finish',
                feature: 'terminal',
                tab: 'terminal',
                target: null,
                title: 'Tour Complete!',
                body: 'You are now ready to test every aspect of your POS hardware integration. Happy simulating!',
                placement: 'center'
            }
        ]
    }));

})();
