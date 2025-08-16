/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
// ESC/POS Command Parser
// Parses ESC/POS printer commands and renders visual receipts

class EscPosParser {
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

// Export for use in other modules or attach to window for browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EscPosParser;
} else {
    window.EscPosParser = EscPosParser;
}
