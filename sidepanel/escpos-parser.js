// A rudimentary ESC/POS parser with brand-specific decoding.
class EscPosParser {
    constructor() {
        // Command definitions
        this.GS = 0x1D;
        this.ESC = 0x1B;
        this.LF = 0x0A;
    }

    /**
     * Parses a raw Uint8Array of ESC/POS data.
     * @param {Uint8Array} data The raw byte data from the printer.
     * @param {string} brand The brand of the printer ('epson', 'star', 'citizen').
     * @returns {object} A structured representation of the print commands.
     */
    parse(data, brand = 'epson') {
        console.log(`[Parser] Starting to parse ${data.length} bytes for brand: ${brand}`);
        const commands = [];
        let i = 0;
        let currentText = '';

        while (i < data.length) {
            const byte = data[i];

            // Flush text if we encounter a command byte
            if ((byte === this.GS || byte === this.ESC) && currentText) {
                commands.push({ type: 'text', value: this.decodeText(currentText) });
                currentText = '';
            }

            if (byte === this.GS) {
                // --- Handle GS commands ---
                const commandCode = data[i + 1];
                if (commandCode === 0x56) { // GS V (Cut)
                    const cutType = data[i + 2];
                    commands.push(this.decodeCutCommand(cutType, brand));
                    i += 3;
                } else if (commandCode === 0x6B) { // GS k (Barcode)
                    const barcodeType = data[i + 2];
                    // Find the end of the barcode data (null terminator)
                    let barcodeEnd = i + 3;
                    while (barcodeEnd < data.length && data[barcodeEnd] !== 0x00) {
                        barcodeEnd++;
                    }
                    const barcodeData = data.slice(i + 3, barcodeEnd);
                    commands.push(this.decodeBarcodeCommand(barcodeType, barcodeData, brand));
                    i = barcodeEnd + 1;
                } else {
                    // Skip unknown GS command for simplicity
                    console.warn(`[Parser] Skipping unknown GS command: 0x${commandCode.toString(16)}`);
                    i += 2;
                }
            } else if (byte === this.ESC) {
                // --- Handle ESC commands (simplified) ---
                const commandCode = data[i + 1];
                 if (commandCode === 0x40) { // ESC @ (Initialize)
                    commands.push({ type: 'initialize' });
                    i += 2;
                } else {
                    console.warn(`[Parser] Skipping unknown ESC command: 0x${commandCode.toString(16)}`);
                    i += 2;
                }
            } else if (byte === this.LF) {
                // --- Handle Line Feed ---
                currentText += '\n';
                i++;
            } else {
                // --- Accumulate text ---
                currentText += String.fromCharCode(byte);
                i++;
            }
        }

        // Add any remaining text
        if (currentText) {
            commands.push({ type: 'text', value: this.decodeText(currentText) });
        }

        console.log('[Parser] Parsing complete. Commands found:', commands);
        return { brand, commands, rawData: data };
    }

    decodeText(text) {
        // In a real parser, this would handle different character sets
        return text;
    }

    decodeCutCommand(cutType, brand) {
        let action = 'Unknown Cut';
        // Behavior can vary slightly by brand/model
        switch (brand) {
            case 'star':
                action = (cutType === 0 || cutType === 48) ? 'Full Cut' : 'Partial Cut';
                break;
            case 'citizen':
                action = (cutType === 1 || cutType === 49) ? 'Partial Cut' : 'Full Cut';
                break;
            case 'epson':
            default:
                action = (cutType === 0 || cutType === 48 || cutType === 65) ? 'Full Cut' : 'Partial Cut';
                break;
        }
        return { type: 'cut', value: action, brand };
    }

    decodeBarcodeCommand(type, data, brand) {
        const barcodeText = this.decodeText(new TextDecoder().decode(data));
        let barcodeType = 'Unknown';
        // Barcode type mapping can be brand-specific
        switch (type) {
            case 65: barcodeType = 'UPC-A'; break;
            case 66: barcodeType = 'UPC-E'; break;
            case 67: barcodeType = 'EAN13'; break;
            case 68: barcodeType = 'EAN8'; break;
            case 69: barcodeType = 'CODE39'; break;
            case 73: barcodeType = 'CODE128'; break;
        }

        let note = '';
        if (brand === 'star') {
            note = ' (Star-specific rendering)';
        }

        return { type: 'barcode', barcodeType, value: barcodeText, note, brand };
    }

    /**
     * Renders the parsed command structure to HTML for display.
     * @param {object} parsedData The structured data from the parse() method.
     * @returns {string} HTML content representing the receipt.
     */
    renderToHTML(parsedData) {
        console.log('[Renderer] Rendering parsed data to HTML for brand:', parsedData.brand);
        let html = `<div class="receipt-line brand-info">Parsed for: <strong>${parsedData.brand.toUpperCase()}</strong></div>`;

        parsedData.commands.forEach(command => {
            switch (command.type) {
                case 'text':
                    html += `<div class="receipt-line text">${command.value.replace(/\n/g, '<br>')}</div>`;
                    break;
                case 'cut':
                    html += `<div class="receipt-line command">--- [CUT: ${command.value}${command.brand ? ` (${command.brand})` : ''}] ---</div>`;
                    break;
                case 'barcode':
                    html += `<div class="receipt-line command">[BARCODE (${command.barcodeType}): ${command.value}${command.note}]</div>`;
                    // In a real renderer, we might use a library to generate an actual barcode image here
                    html += `<div class="barcode-placeholder">║█║▌║█║▌│║▌█║▌║</div>`;
                    break;
                case 'initialize':
                     html += `<div class="receipt-line command">[INITIALIZE PRINTER]</div>`;
                     break;
            }
        });

        // For debugging, show the raw hex data
        html += `<div class="receipt-line raw-data-header">--- RAW DATA ---</div>`;
        html += `<div class="receipt-line raw-data">${this.toHexString(parsedData.rawData)}</div>`;

        return html;
    }

    toHexString(byteArray) {
        if (!byteArray) return '';
        return Array.from(byteArray, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join(' ').toUpperCase();
    }
}
