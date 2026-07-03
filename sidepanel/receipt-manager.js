/*
 * tbay.tk Virtual Peripheral Simulator
 * Developed by: Alexander Milton — https://tbay.tk
 */

// Receipt Manager Module
// Handles receipt generation, download, and email functionality

class ReceiptManager {
    constructor() {
        this.defaultEmail = 'alex@tbay.tk';
        this.receiptHistory = [];
        this.emailConfig = {
            smtp: null,
            userEmail: null,
            userPassword: null,
            configured: false
        };
        
        // Load saved email configuration
        this.loadEmailConfig();
    }

    // Generate PDF receipt using jsPDF
    async generatePDF(receiptData, options = {}) {
        try {
            // jsPDF is bundled locally and loaded by panel.html (vendor/jspdf.umd.min.js).
            // The UMD build exposes window.jspdf.jsPDF (fallback window.jsPDF).
            await this.loadJsPDF();
            const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
            if (!jsPDF) throw new Error('jsPDF is not available (vendor bundle failed to load)');
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [80, 200] // Thermal receipt size (80mm wide)
            });

            // Set font
            doc.setFont('courier', 'normal');
            doc.setFontSize(10);

            let yPosition = 10;
            const lineHeight = 4;
            const maxWidth = 70;

            // Add receipt content
            const lines = this.formatReceiptForPDF(receiptData);
            
            for (const line of lines) {
                if (yPosition > 190) { // New page if needed
                    doc.addPage();
                    yPosition = 10;
                }

                // Handle different line types
                if (line.type === 'header') {
                    doc.setFontSize(12);
                    doc.text(line.text, 40, yPosition, { align: 'center' });
                } else if (line.type === 'bold') {
                    doc.setFont('courier', 'bold');
                    doc.text(line.text, 5, yPosition);
                    doc.setFont('courier', 'normal');
                } else if (line.type === 'center') {
                    doc.text(line.text, 40, yPosition, { align: 'center' });
                } else {
                    doc.text(line.text, 5, yPosition);
                }

                yPosition += lineHeight;
            }

            // Generate blob
            const pdfBlob = doc.output('blob');
            
            // Store in history
            const receiptRecord = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                format: 'pdf',
                data: receiptData,
                blob: pdfBlob,
                filename: this.generateFilename('pdf')
            };
            
            this.receiptHistory.push(receiptRecord);
            
            return receiptRecord;
            
        } catch (error) {
            console.error('Failed to generate PDF:', error);
            throw error;
        }
    }

    // Generate text receipt
    generateTextReceipt(receiptData, options = {}) {
        try {
            const lines = this.formatReceiptForText(receiptData);
            const textContent = lines.join('\n');
            
            const textBlob = new Blob([textContent], { type: 'text/plain' });
            
            const receiptRecord = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                format: 'text',
                data: receiptData,
                blob: textBlob,
                content: textContent,
                filename: this.generateFilename('txt')
            };
            
            this.receiptHistory.push(receiptRecord);
            
            return receiptRecord;
            
        } catch (error) {
            console.error('Failed to generate text receipt:', error);
            throw error;
        }
    }

    // Format receipt data for PDF
    formatReceiptForPDF(receiptData) {
        const lines = [];
        
        // Header
        if (receiptData.storeName) {
            lines.push({ type: 'header', text: receiptData.storeName });
            lines.push({ type: 'center', text: '--------------------------------' });
        }
        
        // Store info
        if (receiptData.storeAddress) {
            lines.push({ type: 'center', text: receiptData.storeAddress });
        }
        if (receiptData.storePhone) {
            lines.push({ type: 'center', text: receiptData.storePhone });
        }
        
        lines.push({ type: 'center', text: '' });
        
        // Transaction info
        lines.push({ type: 'normal', text: `Date: ${receiptData.date || new Date().toLocaleDateString()}` });
        lines.push({ type: 'normal', text: `Time: ${receiptData.time || new Date().toLocaleTimeString()}` });
        lines.push({ type: 'normal', text: `Receipt #: ${receiptData.receiptNumber || this.generateReceiptNumber()}` });
        
        if (receiptData.cashier) {
            lines.push({ type: 'normal', text: `Cashier: ${receiptData.cashier}` });
        }
        
        lines.push({ type: 'center', text: '--------------------------------' });
        
        // Items
        if (receiptData.items && receiptData.items.length > 0) {
            for (const item of receiptData.items) {
                lines.push({ type: 'normal', text: item.name });
                const itemLine = `${item.quantity || 1} x $${(item.price || 0).toFixed(2)}`;
                const totalLine = `$${((item.quantity || 1) * (item.price || 0)).toFixed(2)}`;
                lines.push({ type: 'normal', text: `  ${itemLine.padEnd(20)} ${totalLine.padStart(10)}` });
            }
        }
        
        lines.push({ type: 'center', text: '--------------------------------' });
        
        // Totals
        const subtotal = receiptData.subtotal || this.calculateSubtotal(receiptData.items);
        const tax = receiptData.tax || (subtotal * 0.08); // Default 8% tax
        const total = receiptData.total || (subtotal + tax);
        
        lines.push({ type: 'normal', text: `Subtotal:              $${subtotal.toFixed(2)}` });
        lines.push({ type: 'normal', text: `Tax:                   $${tax.toFixed(2)}` });
        lines.push({ type: 'bold', text: `Total:                 $${total.toFixed(2)}` });
        
        // Payment info
        if (receiptData.paymentMethod) {
            lines.push({ type: 'center', text: '' });
            lines.push({ type: 'normal', text: `Payment: ${receiptData.paymentMethod}` });
            
            if (receiptData.cardNumber) {
                const maskedCard = this.maskCardNumber(receiptData.cardNumber);
                lines.push({ type: 'normal', text: `Card: ${maskedCard}` });
            }
            
            if (receiptData.authCode) {
                lines.push({ type: 'normal', text: `Auth Code: ${receiptData.authCode}` });
            }
        }
        
        // Footer
        lines.push({ type: 'center', text: '' });
        lines.push({ type: 'center', text: 'Thank you for your business!' });
        
        return lines;
    }

    // Format receipt data for text
    formatReceiptForText(receiptData) {
        const lines = [];
        const width = 32; // Character width for thermal receipt
        
        // Header
        if (receiptData.storeName) {
            lines.push(this.centerText(receiptData.storeName, width));
            lines.push('='.repeat(width));
        }
        
        // Store info
        if (receiptData.storeAddress) {
            lines.push(this.centerText(receiptData.storeAddress, width));
        }
        if (receiptData.storePhone) {
            lines.push(this.centerText(receiptData.storePhone, width));
        }
        
        lines.push('');
        
        // Transaction info
        lines.push(`Date: ${receiptData.date || new Date().toLocaleDateString()}`);
        lines.push(`Time: ${receiptData.time || new Date().toLocaleTimeString()}`);
        lines.push(`Receipt #: ${receiptData.receiptNumber || this.generateReceiptNumber()}`);
        
        if (receiptData.cashier) {
            lines.push(`Cashier: ${receiptData.cashier}`);
        }
        
        lines.push('-'.repeat(width));
        
        // Items
        if (receiptData.items && receiptData.items.length > 0) {
            for (const item of receiptData.items) {
                lines.push(item.name);
                const qty = item.quantity || 1;
                const price = item.price || 0;
                const itemTotal = qty * price;
                
                const itemLine = `${qty} x $${price.toFixed(2)}`;
                const totalStr = `$${itemTotal.toFixed(2)}`;
                const spacing = width - itemLine.length - totalStr.length;
                lines.push(`  ${itemLine}${' '.repeat(Math.max(0, spacing))}${totalStr}`);
            }
        }
        
        lines.push('-'.repeat(width));
        
        // Totals
        const subtotal = receiptData.subtotal || this.calculateSubtotal(receiptData.items);
        const tax = receiptData.tax || (subtotal * 0.08);
        const total = receiptData.total || (subtotal + tax);
        
        lines.push(this.rightAlignAmount('Subtotal:', subtotal, width));
        lines.push(this.rightAlignAmount('Tax:', tax, width));
        lines.push(this.rightAlignAmount('TOTAL:', total, width));
        
        // Payment info
        if (receiptData.paymentMethod) {
            lines.push('');
            lines.push(`Payment: ${receiptData.paymentMethod}`);
            
            if (receiptData.cardNumber) {
                const maskedCard = this.maskCardNumber(receiptData.cardNumber);
                lines.push(`Card: ${maskedCard}`);
            }
            
            if (receiptData.authCode) {
                lines.push(`Auth Code: ${receiptData.authCode}`);
            }
        }
        
        // Footer
        lines.push('');
        lines.push(this.centerText('Thank you for your business!', width));
        lines.push('');
        
        return lines;
    }

    // Helper functions
    centerText(text, width) {
        const padding = Math.max(0, (width - text.length) / 2);
        return ' '.repeat(Math.floor(padding)) + text;
    }

    rightAlignAmount(label, amount, width) {
        const amountStr = `$${amount.toFixed(2)}`;
        const spacing = width - label.length - amountStr.length;
        return label + ' '.repeat(Math.max(0, spacing)) + amountStr;
    }

    maskCardNumber(cardNumber) {
        if (!cardNumber || cardNumber.length < 4) return '****';
        return '*'.repeat(cardNumber.length - 4) + cardNumber.slice(-4);
    }

    calculateSubtotal(items) {
        if (!items || items.length === 0) return 0;
        return items.reduce((sum, item) => {
            return sum + ((item.quantity || 1) * (item.price || 0));
        }, 0);
    }

    generateReceiptNumber() {
        return `R${Date.now().toString().slice(-8)}`;
    }

    generateFilename(extension) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        return `receipt-${timestamp}.${extension}`;
    }

    // Download receipt to local machine
    async downloadReceipt(receiptRecord, customFilename = null) {
        try {
            const filename = customFilename || receiptRecord.filename;
            
            // Create download link
            const url = URL.createObjectURL(receiptRecord.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Clean up
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            return true;
        } catch (error) {
            console.error('Failed to download receipt:', error);
            throw error;
        }
    }

    // Email receipt
    async emailReceipt(receiptRecord, recipientEmail = null, options = {}) {
        try {
            const email = recipientEmail || this.defaultEmail;
            
            if (!this.emailConfig.configured) {
                throw new Error('Email not configured. Please set up SMTP settings.');
            }

            const emailData = {
                to: email,
                subject: options.subject || `Receipt ${receiptRecord.id}`,
                body: this.generateEmailBody(receiptRecord, options),
                attachment: {
                    filename: receiptRecord.filename,
                    content: receiptRecord.blob,
                    type: receiptRecord.format === 'pdf' ? 'application/pdf' : 'text/plain'
                }
            };

            // Send email via service worker
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'SEND_EMAIL',
                    data: emailData
                }, (response) => {
                    if (response && response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response?.error || 'Failed to send email'));
                    }
                });
            });

        } catch (error) {
            console.error('Failed to email receipt:', error);
            throw error;
        }
    }

    generateEmailBody(receiptRecord, options = {}) {
        const defaultBody = `
Hello,

Please find your receipt attached to this email.

Receipt Details:
- Receipt Number: ${receiptRecord.data.receiptNumber || 'N/A'}
- Date: ${receiptRecord.data.date || new Date().toLocaleDateString()}
- Time: ${receiptRecord.data.time || new Date().toLocaleTimeString()}
- Total: $${(receiptRecord.data.total || 0).toFixed(2)}

Thank you for your business!

This email was sent from the POS Peripheral Simulator.
        `;

        return options.customBody || defaultBody.trim();
    }

    // Configure email settings
    configureEmail(settings) {
        this.emailConfig = {
            smtp: settings.smtpServer,
            port: settings.smtpPort || 587,
            secure: settings.secure || false,
            userEmail: settings.email,
            userPassword: settings.password,
            configured: true
        };

        // Save to storage
        this.saveEmailConfig();
        
        return true;
    }

    // Load email configuration from storage
    async loadEmailConfig() {
        try {
            if (chrome?.storage?.local) {
                const result = await chrome.storage.local.get(['emailConfig']);
                if (result.emailConfig) {
                    this.emailConfig = { ...this.emailConfig, ...result.emailConfig };
                }
            }
        } catch (error) {
            console.warn('Failed to load email config:', error);
        }
    }

    // Save email configuration to storage
    async saveEmailConfig() {
        try {
            if (chrome?.storage?.local) {
                await chrome.storage.local.set({ emailConfig: this.emailConfig });
            }
        } catch (error) {
            console.warn('Failed to save email config:', error);
        }
    }

    // jsPDF is bundled in the extension package and loaded by a <script> tag in
    // panel.html — MV3 forbids loading remote code, so there is no CDN fallback.
    // This just resolves once the global is present (it is, synchronously, after
    // panel.html's script tag runs).
    async loadJsPDF() {
        if ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF) return;
        throw new Error('jsPDF vendor bundle not loaded — check panel.html includes vendor/jspdf.umd.min.js');
    }

    // Get receipt history
    getReceiptHistory() {
        return this.receiptHistory;
    }

    // Clear receipt history
    clearReceiptHistory() {
        this.receiptHistory = [];
        return true;
    }

    // Extract receipt data from ESC/POS commands
    parseEscPosReceipt(escPosData) {
        try {
            // This would integrate with the existing ESC/POS parser
            const parser = new EscPosParser();
            const parsed = parser.parse(escPosData);
            
            // Extract meaningful data for receipt generation
            const receiptData = {
                storeName: this.extractStoreName(parsed),
                items: this.extractItems(parsed),
                total: this.extractTotal(parsed),
                paymentMethod: 'Cash', // Default
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            };

            return receiptData;
        } catch (error) {
            console.error('Failed to parse ESC/POS receipt:', error);
            return null;
        }
    }

    // EscPosParser.parse() returns { lines: [{ text, style } | { type:'command', ... }], commands }.
    // These helpers read the printable text lines (not the non-existent .text array).
    _textLines(parsedData) {
        const lines = (parsedData && Array.isArray(parsedData.lines)) ? parsedData.lines : [];
        return lines
            .filter(l => l && typeof l.text === 'string')
            .map(l => l.text);
    }

    extractStoreName(parsedData) {
        const lines = this._textLines(parsedData).filter(t => t.trim().length > 0);
        return lines.length > 0 ? lines[0] : 'Store Name';
    }

    extractItems(parsedData) {
        const items = [];
        for (const line of this._textLines(parsedData)) {
            // Look for lines that might be items (contain price patterns)
            const priceMatch = line.match(/\$([\d.]+)/);
            if (priceMatch) {
                items.push({
                    name: line.replace(/\$[\d.]+/, '').trim(),
                    price: parseFloat(priceMatch[1]),
                    quantity: 1
                });
            }
        }
        return items;
    }

    extractTotal(parsedData) {
        for (const line of this._textLines(parsedData)) {
            if (line.toLowerCase().includes('total')) {
                const priceMatch = line.match(/\$([\d.]+)/);
                if (priceMatch) {
                    return parseFloat(priceMatch[1]);
                }
            }
        }
        return 0;
    }
}