# Virtual POS Peripheral Simulator Chrome Extension

A comprehensive Chrome extension for simulating Point of Sale (POS) peripherals to test and develop POS applications without physical hardware.

## Features

### Supported Peripherals
- **Barcode Scanner** - Keyboard wedge emulation with support for UPC-A, UPC-E, Code 128, Code 39, QR codes, and Data Matrix
- **Magnetic Stripe Reader (MSR)** - Credit/debit card simulation with Track 1 and Track 2 data
- **Receipt Printer** - ESC/POS command parsing and visual receipt rendering (Epson, Star Micronics, Citizen)
- **Cash Drawer** - Open/close simulation with visual feedback
- **Weight Scale** - Configurable weight simulation with multiple units (lbs, kg, g, oz)
- **Line Display** - Customer-facing display simulation with 2-line, 20-character display

### Key Capabilities
- **Real-time Simulation** - Inject barcode scans, card swipes, and other peripheral data directly into POS applications
- **Visual Feedback** - See receipts, drawer status, scale readings, and display output in real-time
- **ESC/POS Support** - Full ESC/POS command parsing for thermal receipt printers
- **Framework Compatible** - Works with React, Angular, Vue, and other modern web frameworks
- **Testing Tools** - Generate test data, activity logs, and debugging information

## Installation

### Method 1: Load Unpacked Extension (Developer Mode)

1. **Download the Extension**
   - Download all extension files to a folder on your computer
   - Ensure the folder structure matches the layout below

2. **Enable Developer Mode**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle "Developer mode" on (top right corner)

3. **Load the Extension**
   - Click "Load unpacked" button
   - Select the folder containing the extension files
   - The extension should now appear in your extensions list

4. **Pin the Extension**
   - Click the extensions icon (puzzle piece) in Chrome toolbar
   - Find "Virtual POS Peripheral Simulator" and pin it

### Method 2: Chrome Web Store (Future)
*This extension will be published to the Chrome Web Store for easier installation.*

## File Structure
```
pos-peripheral-simulator/
├── manifest.json                 # Extension manifest
├── service-worker.js            # Background service worker
├── content-script.js            # DOM interaction script
├── escpos-parser.js             # ESC/POS command parser
├── sidepanel/
│   ├── panel.html              # Main UI interface
│   ├── panel.css               # Styling
│   └── panel.js                # UI logic
└── README.md                   # This file
```

## Usage

### Getting Started

1. **Open the Simulator**
   - Click the extension icon in Chrome toolbar
   - The side panel will open with the simulator interface

2. **Navigate to Your POS Application**
   - Open your POS web application in the same Chrome window
   - The simulator will automatically detect input fields

3. **Test Peripherals**
   - Use the tabbed interface to access different peripheral simulators
   - Configure settings and simulate hardware interactions

### Barcode Scanner

1. Select barcode format (UPC-A, Code 128, QR, etc.)
2. Enter barcode value or click "Generate Test" for sample data
3. Click "Scan Barcode" to inject the value into your POS application
4. Configure options:
   - **Simulate Enter Key**: Automatically press Enter after scanning
   - **Simulate Typing**: Type characters individually (compatibility mode)

### Magnetic Stripe Reader

1. Select card type (Credit, Debit, Gift, Loyalty)
2. Enter Track 1 and/or Track 2 data or generate test card
3. Click "Swipe Card" to inject MSR data
4. Test cards are provided for common scenarios

### Receipt Printer

1. Select printer model (Epson ESC/POS, Star Micronics, Citizen)
2. Click "Test Print" to generate a sample receipt
3. View rendered receipt in the visual display
4. ESC/POS commands are automatically parsed and rendered
5. Options:
   - **Auto Cut Paper**: Simulate paper cutting
   - **Trigger Drawer Kick**: Open cash drawer with receipt

### Cash Drawer

1. Click "Open Drawer" to simulate drawer opening
2. Visual indicator shows drawer status
3. Drawer automatically closes after 3 seconds
4. Configure interface type (Printer Port, Serial/USB, Network)

### Weight Scale

1. Adjust weight using slider or number input
2. Select unit (lbs, kg, g, oz)
3. Use "Tare" to zero the scale
4. Weight data is sent to POS application via simulated serial connection
5. Visual indicators show scale status (STABLE, ZERO)

### Line Display

1. Enter text for Line 1 and Line 2 (max 20 characters each)
2. Click "Update Display" to send to POS application
3. Preview shows exactly what customer would see
4. Adjust brightness and enable blinking text

## Technical Details

### Communication Architecture

The extension uses a three-component architecture:

1. **Service Worker** (`service-worker.js`)
   - Handles background operations and API access
   - Manages peripheral state and message routing
   - Processes ESC/POS commands

2. **Content Script** (`content-script.js`)
   - Injects into POS application pages
   - Finds target input elements using MutationObserver
   - Simulates keyboard input and form interactions

3. **Side Panel** (`sidepanel/`)
   - User interface for peripheral controls
   - Real-time status indicators and activity logs
   - Settings and configuration options

### Integration Methods

The simulator integrates with POS applications using multiple techniques:

**Keyboard Wedge Emulation**
- Most common method for barcode scanners and MSR devices
- Directly sets input field values and triggers framework events
- Compatible with React, Angular, Vue, and vanilla JavaScript

**WebUSB/WebSerial/WebHID APIs**
- Modern browser APIs for direct hardware communication
- Used for scales, line displays, and advanced peripherals
- Provides authentic hardware-level integration

**ESC/POS Command Processing**
- Full parser for thermal printer command sets
- Supports text formatting, barcodes, QR codes, and graphics
- Visual rendering of receipt output

### Framework Compatibility

The extension is designed to work with modern web frameworks:

- **React**: Properly triggers `onChange` and `onInput` events
- **Angular**: Compatible with form controls and reactive forms  
- **Vue**: Works with v-model and event handling
- **Vanilla JS**: Standard DOM events and form interactions

### Security Features

- **Sandboxed Execution**: All code runs in Chrome's secure extension sandbox
- **Message Validation**: All communications between components are validated
- **DOM Safety**: Uses `textContent` instead of `innerHTML` to prevent XSS
- **Minimal Permissions**: Only requests necessary permissions for functionality

## Configuration

### Extension Settings

Access settings by clicking the "Settings" button in the simulator:

- **Target POS URL Pattern**: Limit simulator to specific URLs
- **Debug Mode**: Enable detailed console logging
- **Auto-detect Input Fields**: Automatically find POS input elements

### Peripheral Settings

Each peripheral has its own configuration options:

- **Scanner**: Format selection, timing options
- **MSR**: Card type templates, track data formats
- **Printer**: Model selection, paper and drawer settings
- **Scale**: Units, precision, calibration
- **Display**: Brightness, text effects

## Troubleshooting

### Common Issues

**Simulator not injecting data into POS application:**
- Ensure the POS application input field is focused or visible
- Try enabling "Auto-detect Input Fields" in settings
- Check that the POS application allows programmatic input

**ESC/POS commands not rendering correctly:**
- Verify printer model selection matches your POS configuration
- Check that ESC/POS data is being sent in the correct format
- Enable debug mode for detailed command parsing logs

**Extension not loading:**
- Verify all files are present and properly structured
- Check Chrome extension developer console for errors
- Ensure Developer Mode is enabled in Chrome

### Debug Information

Enable debug mode in settings to access:
- Detailed message passing logs
- ESC/POS command parsing details
- DOM interaction debugging
- Peripheral state information

## Development

### Building from Source

The extension is built using vanilla JavaScript and requires no build process:

1. Clone or download the source files
2. Load as unpacked extension in Chrome
3. Make changes and reload extension to test

### Contributing

Contributions are welcome! Areas for improvement:
- Additional printer protocol support
- More barcode format support
- Enhanced ESC/POS command coverage
- Additional peripheral types
- UI/UX improvements

### API Extensions

The extension can be extended with additional peripherals by:
1. Adding new tab panels in `panel.html`
2. Implementing peripheral logic in `panel.js`  
3. Adding message handlers in `service-worker.js`
4. Creating content script integration as needed

## License

This project is licensed under the MIT License. See LICENSE file for details.

## Support

For issues, feature requests, or questions:
- Create an issue in the project repository
- Check the troubleshooting section above
- Review Chrome extension developer documentation

## Version History

### v1.0.0
- Initial release
- Full peripheral simulation suite
- ESC/POS parser and renderer
- Chrome Manifest V3 compliance
- Modern web framework compatibility
