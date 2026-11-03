/*
Copyright (c) Alexander Milton
Developed by: Alexander Milton
Version: 2.1
Website: https://github.com/awfmilton/pos-simulator-chrome-extension
License: MPL-2.0 (https://mozilla.org/MPL/2.0/)
*/
// A more robust, stateful ESC/POS parser.
class EscPosParser {
    constructor() {
        this.GS = 0x1D;
        this.ESC = 0x1B;
        this.LF = 0x0A;
    }

    /**
     * Parses a raw Uint8Array of ESC/POS data into a structured format.
     * @param {Uint8Array} data The raw byte data from the printer.
     * @param {string} brand The brand of the printer ('epson', 'star', 'citizen').
     * @returns {object} A structured representation of the print commands.
     */
    parse(data, brand = 'epson') {
        console.log(`[Parser] Starting stateful parse for ${data.length} bytes, brand: ${brand}`);
        const receipt = {
            lines: [],
            brand: brand
        };

        // State machine for text styling
        let state = {
            bold: false,
            align: 'left'
        };

        let buffer = [];

        // Helper to flush the text buffer into a new line
        const flushBuffer = () => {
            if (buffer.length > 0) {
                const text = new TextDecoder().decode(new Uint8Array(buffer));
                receipt.lines.push({ text: text, style: { ...state } });
                buffer = [];
            }
        };

        for (let i = 0; i < data.length; i++) {
            const byte = data[i];

            if (byte === this.LF) {
                flushBuffer();
                // Add a blank line to represent the line feed
                receipt.lines.push({ text: '', style: { ...state } });
                continue;
            }

            if (byte === 0x07 && brand === 'star') {
                flushBuffer();
                receipt.lines.push({ type: 'command', name: 'drawer_kick', brand: 'star' });
                continue;
            }

            if (byte === this.ESC) {
                flushBuffer(); // Process text before command
                const commandCode = data[++i]; // Move to next byte for command code

                switch(commandCode) {
                    case 0x40: // ESC @ (Initialize)
                        state = { bold: false, align: 'left' };
                        receipt.lines.push({ type: 'command', name: 'initialize' });
                        break;
                    case 0x45: // ESC E (Bold)
                        const boldValue = data[++i];
                        state.bold = (boldValue & 1) === 1;
                        break;
                    case 0x61: // ESC a (Alignment)
                        const alignValue = data[++i];
                        if (alignValue === 0 || alignValue === 48) state.align = 'left';
                        else if (alignValue === 1 || alignValue === 49) state.align = 'center';
                        else if (alignValue === 2 || alignValue === 50) state.align = 'right';
                        break;
                    case 0x70: // ESC p (Drawer Kick)
                        // Command: ESC p m t1 t2
                        // m = pin, t1 = on-time, t2 = off-time
                        const pin = data[i + 1];
                        const onTime = data[i + 2];
                        const offTime = data[i + 3];
                        receipt.lines.push({
                            type: 'command',
                            name: 'drawer_kick',
                            pin: pin,
                            on_time: onTime,
                            off_time: offTime
                        });
                        i += 3; // Consume the 3 parameters
                        break;
                    case 0x64: // ESC d (Print and feed n lines / Star Cut)
                        const feedLines = data[++i];
                        if (brand === 'star') {
                            receipt.lines.push({ type: 'command', name: 'cut', value: 'Full Cut', brand: 'star' });
                        }
                        break;
                    case 0x1D: // ESC GS a (Star Alignment)
                        if (brand === 'star' && data[i+1] === 0x61) {
                            i++; // Consume 0x61
                            const alignValue = data[++i];
                            if (alignValue === 0) state.align = 'left';
                            else if (alignValue === 1) state.align = 'center';
                            else if (alignValue === 2) state.align = 'right';
                        } else {
                            // Fallback skip 1 byte
                            if (i + 1 < data.length) i++;
                        }
                        break;
                    default:
                         console.warn(`[Parser] Skipping unknown ESC command: 0x${commandCode.toString(16)}`);
                         // We assume a 1-byte parameter for unknown commands to avoid getting stuck
                         if (i + 1 < data.length) i++;
                         break;
                }
            } else if (byte === this.GS) {
                flushBuffer(); // Process text before command
                const commandCode = data[++i]; // Move to next byte

                if (commandCode === 0x56) { // GS V (Cut)
                    const cutType = data[++i];
                    receipt.lines.push(this.decodeCutCommand(cutType, brand));
                    // Mode A or B (65, 66) has an extra parameter for paper feed length
                    if (cutType === 65 || cutType === 66 || cutType === 0x41 || cutType === 0x42) {
                        i++;
                    }
                } else if (commandCode === 0x6B) { // GS k (Barcode)
                    const barcodeType = data[++i];
                    const barcodeData = [];
                    i++; // Move past type
                    while(i < data.length && data[i] !== 0x00) {
                        barcodeData.push(data[i++]);
                    }
                    receipt.lines.push(this.decodeBarcodeCommand(barcodeType, new Uint8Array(barcodeData), brand));
                } else {
                    console.warn(`[Parser] Skipping unknown GS command: 0x${commandCode.toString(16)}`);
                }

            } else {
                // Accumulate printable characters
                buffer.push(byte);
            }
        }

        flushBuffer(); // Add any remaining text

        // The new parser returns the full receipt object, which includes lines, brand, and commands
        const commands = receipt.lines.filter(line => line.type === 'command');
        console.log('[Parser] Stateful parsing complete. Receipt:', { ...receipt, commands });
        return { ...receipt, commands };
    }

    decodeCutCommand(cutType, brand) {
        let action = 'Unknown Cut';
        switch (brand) {
            case 'star':
                action = (cutType === 0 || cutType === 48) ? 'Full Cut' : 'Partial Cut';
                break;
            case 'citizen':
                 // Citizen often uses '1' for partial, but let's check against the raw data from user
                 // The user log shows GS V 1 (1D 56 01), and it should be a partial cut.
                action = (cutType === 1 || cutType === 49) ? 'Partial Cut' : 'Full Cut';
                break;
            case 'epson':
            default:
                action = (cutType === 0 || cutType === 48 || cutType === 65) ? 'Full Cut' : 'Partial Cut';
                break;
        }
        return { type: 'command', name: 'cut', value: action, brand };
    }

    decodeBarcodeCommand(type, data, brand) {
        const barcodeText = new TextDecoder().decode(data);
        let barcodeType = 'Unknown';
        switch (type) {
            case 65: barcodeType = 'UPC-A'; break;
            case 67: barcodeType = 'EAN13'; break;
            case 73: barcodeType = 'CODE128'; break;
        }
        return { type: 'command', name: 'barcode', barcodeType, value: barcodeText, brand };
    }

    /**
     * Renders the parsed receipt structure to clean HTML.
     * @param {object} receipt The structured data from the parse() method.
     * @returns {string} HTML content representing the receipt.
     */
    renderToHTML(receipt) {
        console.log('[Renderer] Rendering receipt to HTML for brand:', receipt.brand);
        let html = '';
        let drawerCommands = 0;

        receipt.lines.forEach(line => {
            if (line.type === 'command') {
                if (line.name === 'drawer_kick') {
                    drawerCommands++;
                    html += `<div class="receipt-line command">🔓 CASH DRAWER KICK COMMAND #${drawerCommands}</div>`;
                } else if (line.name === 'cut') {
                     html += `<div class="receipt-line command">✂️ ${line.value} (${line.brand})</div>`;
                } else if (line.name === 'barcode') {
                     html += `<div class="receipt-line command">[BARCODE: ${line.value}]</div>`;
                     html += `<div class="barcode-placeholder">║█║▌║█║▌│║▌█║▌║</div>`;
                }
                // We don't render 'initialize'
            } else if (line.text !== undefined) {
                const classes = ['receipt-line'];
                if (line.style.bold) classes.push('bold');
                if (line.style.align) classes.push(line.style.align); // 'left', 'center', 'right'

                // Replace spaces with non-breaking spaces to preserve indentation
                const text = line.text.replace(/ /g, '&nbsp;');
                html += `<div class="${classes.join(' ')}">${text || '&nbsp;'}</div>`;
            }
        });

        return html;
    }
}
