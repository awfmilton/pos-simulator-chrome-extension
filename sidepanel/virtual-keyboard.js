/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/

// Virtual Keyboard Module
// Simulates HID keyboard input for POS systems

class VirtualKeyboard {
    constructor() {
        this.isShiftPressed = false;
        this.isCapsLockOn = false;
        this.isNumLockOn = true;
        this.keyboardMode = 'full'; // 'full' or 'keypad'
        
        this.keyMappings = {
            // QWERTY Layout
            'q': { key: 'q', shiftKey: 'Q', code: 'KeyQ' },
            'w': { key: 'w', shiftKey: 'W', code: 'KeyW' },
            'e': { key: 'e', shiftKey: 'E', code: 'KeyE' },
            'r': { key: 'r', shiftKey: 'R', code: 'KeyR' },
            't': { key: 't', shiftKey: 'T', code: 'KeyT' },
            'y': { key: 'y', shiftKey: 'Y', code: 'KeyY' },
            'u': { key: 'u', shiftKey: 'U', code: 'KeyU' },
            'i': { key: 'i', shiftKey: 'I', code: 'KeyI' },
            'o': { key: 'o', shiftKey: 'O', code: 'KeyO' },
            'p': { key: 'p', shiftKey: 'P', code: 'KeyP' },
            'a': { key: 'a', shiftKey: 'A', code: 'KeyA' },
            's': { key: 's', shiftKey: 'S', code: 'KeyS' },
            'd': { key: 'd', shiftKey: 'D', code: 'KeyD' },
            'f': { key: 'f', shiftKey: 'F', code: 'KeyF' },
            'g': { key: 'g', shiftKey: 'G', code: 'KeyG' },
            'h': { key: 'h', shiftKey: 'H', code: 'KeyH' },
            'j': { key: 'j', shiftKey: 'J', code: 'KeyJ' },
            'k': { key: 'k', shiftKey: 'K', code: 'KeyK' },
            'l': { key: 'l', shiftKey: 'L', code: 'KeyL' },
            'z': { key: 'z', shiftKey: 'Z', code: 'KeyZ' },
            'x': { key: 'x', shiftKey: 'X', code: 'KeyX' },
            'c': { key: 'c', shiftKey: 'C', code: 'KeyC' },
            'v': { key: 'v', shiftKey: 'V', code: 'KeyV' },
            'b': { key: 'b', shiftKey: 'B', code: 'KeyB' },
            'n': { key: 'n', shiftKey: 'N', code: 'KeyN' },
            'm': { key: 'm', shiftKey: 'M', code: 'KeyM' },
            
            // Numbers
            '1': { key: '1', shiftKey: '!', code: 'Digit1' },
            '2': { key: '2', shiftKey: '@', code: 'Digit2' },
            '3': { key: '3', shiftKey: '#', code: 'Digit3' },
            '4': { key: '4', shiftKey: '$', code: 'Digit4' },
            '5': { key: '5', shiftKey: '%', code: 'Digit5' },
            '6': { key: '6', shiftKey: '^', code: 'Digit6' },
            '7': { key: '7', shiftKey: '&', code: 'Digit7' },
            '8': { key: '8', shiftKey: '*', code: 'Digit8' },
            '9': { key: '9', shiftKey: '(', code: 'Digit9' },
            '0': { key: '0', shiftKey: ')', code: 'Digit0' },
            
            // Symbols
            '-': { key: '-', shiftKey: '_', code: 'Minus' },
            '=': { key: '=', shiftKey: '+', code: 'Equal' },
            '[': { key: '[', shiftKey: '{', code: 'BracketLeft' },
            ']': { key: ']', shiftKey: '}', code: 'BracketRight' },
            '\\': { key: '\\', shiftKey: '|', code: 'Backslash' },
            ';': { key: ';', shiftKey: ':', code: 'Semicolon' },
            '\'': { key: '\'', shiftKey: '"', code: 'Quote' },
            '`': { key: '`', shiftKey: '~', code: 'Backquote' },
            ',': { key: ',', shiftKey: '<', code: 'Comma' },
            '.': { key: '.', shiftKey: '>', code: 'Period' },
            '/': { key: '/', shiftKey: '?', code: 'Slash' },
            
            // Special keys
            'Space': { key: ' ', shiftKey: ' ', code: 'Space' },
            'Enter': { key: 'Enter', shiftKey: 'Enter', code: 'Enter' },
            'Tab': { key: 'Tab', shiftKey: 'Tab', code: 'Tab' },
            'Backspace': { key: 'Backspace', shiftKey: 'Backspace', code: 'Backspace' },
            'Delete': { key: 'Delete', shiftKey: 'Delete', code: 'Delete' },
            'Escape': { key: 'Escape', shiftKey: 'Escape', code: 'Escape' },
            
            // Numeric Keypad
            'Numpad0': { key: '0', code: 'Numpad0' },
            'Numpad1': { key: '1', code: 'Numpad1' },
            'Numpad2': { key: '2', code: 'Numpad2' },
            'Numpad3': { key: '3', code: 'Numpad3' },
            'Numpad4': { key: '4', code: 'Numpad4' },
            'Numpad5': { key: '5', code: 'Numpad5' },
            'Numpad6': { key: '6', code: 'Numpad6' },
            'Numpad7': { key: '7', code: 'Numpad7' },
            'Numpad8': { key: '8', code: 'Numpad8' },
            'Numpad9': { key: '9', code: 'Numpad9' },
            'NumpadDecimal': { key: '.', code: 'NumpadDecimal' },
            'NumpadAdd': { key: '+', code: 'NumpadAdd' },
            'NumpadSubtract': { key: '-', code: 'NumpadSubtract' },
            'NumpadMultiply': { key: '*', code: 'NumpadMultiply' },
            'NumpadDivide': { key: '/', code: 'NumpadDivide' },
            'NumpadEnter': { key: 'Enter', code: 'NumpadEnter' }
        };

        this.keyboardLayouts = {
            qwerty: [
                ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
                ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
                ['CapsLock', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', '\'', 'Enter'],
                ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'Shift'],
                ['Ctrl', 'Alt', 'Space', 'Alt', 'Ctrl']
            ],
            numpad: [
                ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'Backspace'],
                ['Numpad7', 'Numpad8', 'Numpad9', 'NumpadSubtract'],
                ['Numpad4', 'Numpad5', 'Numpad6', 'NumpadAdd'],
                ['Numpad1', 'Numpad2', 'Numpad3', 'NumpadEnter'],
                ['Numpad0', 'NumpadDecimal']
            ]
        };

        this.hidDescriptor = {
            deviceClass: 0x03, // HID
            subClass: 0x01,    // Boot Interface
            protocol: 0x01,    // Keyboard
            vendorId: 0x046D,  // Logitech (common keyboard vendor)
            productId: 0xC31C, // Generic keyboard
            deviceName: 'Virtual POS Keyboard'
        };
    }

    // Generate HID descriptor for device emulation
    getHIDDescriptor() {
        return {
            ...this.hidDescriptor,
            reportDescriptor: this.generateHIDReportDescriptor()
        };
    }

    generateHIDReportDescriptor() {
        // Standard HID keyboard report descriptor
        return new Uint8Array([
            0x05, 0x01,        // Usage Page (Generic Desktop)
            0x09, 0x06,        // Usage (Keyboard)
            0xA1, 0x01,        // Collection (Application)
            0x05, 0x07,        //   Usage Page (Keyboard/Keypad)
            0x19, 0xE0,        //   Usage Minimum (0xE0)
            0x29, 0xE7,        //   Usage Maximum (0xE7)
            0x15, 0x00,        //   Logical Minimum (0)
            0x25, 0x01,        //   Logical Maximum (1)
            0x75, 0x01,        //   Report Size (1)
            0x95, 0x08,        //   Report Count (8)
            0x81, 0x02,        //   Input (Data,Var,Abs)
            0x95, 0x01,        //   Report Count (1)
            0x75, 0x08,        //   Report Size (8)
            0x81, 0x01,        //   Input (Cnst,Ary,Abs)
            0x95, 0x05,        //   Report Count (5)
            0x75, 0x01,        //   Report Size (1)
            0x05, 0x08,        //   Usage Page (LEDs)
            0x19, 0x01,        //   Usage Minimum (1)
            0x29, 0x05,        //   Usage Maximum (5)
            0x91, 0x02,        //   Output (Data,Var,Abs)
            0x95, 0x01,        //   Report Count (1)
            0x75, 0x03,        //   Report Size (3)
            0x91, 0x01,        //   Output (Cnst,Ary,Abs)
            0x95, 0x06,        //   Report Count (6)
            0x75, 0x08,        //   Report Size (8)
            0x15, 0x00,        //   Logical Minimum (0)
            0x25, 0x65,        //   Logical Maximum (101)
            0x05, 0x07,        //   Usage Page (Keyboard/Keypad)
            0x19, 0x00,        //   Usage Minimum (0)
            0x29, 0x65,        //   Usage Maximum (101)
            0x81, 0x00,        //   Input (Data,Ary,Abs)
            0xC0               // End Collection
        ]);
    }

    // Simulate key press
    pressKey(keyId, options = {}) {
        const keyInfo = this.keyMappings[keyId];
        if (!keyInfo) {
            console.warn(`Unknown key: ${keyId}`);
            return false;
        }

        let keyValue = keyInfo.key;
        let isShift = this.isShiftPressed || options.shift;
        
        // Handle caps lock for letters
        if (keyInfo.shiftKey && /[a-zA-Z]/.test(keyInfo.key)) {
            if (this.isCapsLockOn) {
                isShift = !isShift;
            }
        }

        // Get the correct character
        if (isShift && keyInfo.shiftKey) {
            keyValue = keyInfo.shiftKey;
        }

        // Create keyboard event data
        const eventData = {
            type: 'keypress',
            key: keyValue,
            code: keyInfo.code,
            keyCode: this.getKeyCode(keyId),
            which: this.getKeyCode(keyId),
            charCode: keyValue.charCodeAt(0),
            shiftKey: isShift,
            ctrlKey: options.ctrl || false,
            altKey: options.alt || false,
            metaKey: options.meta || false,
            repeat: false,
            timestamp: Date.now(),
            device: 'virtual-keyboard'
        };

        return this.sendKeyEvent(eventData);
    }

    // Send key event to POS system
    sendKeyEvent(eventData) {
        try {
            // Send via extension messaging system
            if (chrome?.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    type: 'KEYBOARD_INPUT',
                    data: eventData
                });
            }

            // Also dispatch as DOM event if available
            if (typeof window !== 'undefined' && window.document) {
                const event = new KeyboardEvent('keydown', {
                    key: eventData.key,
                    code: eventData.code,
                    keyCode: eventData.keyCode,
                    which: eventData.which,
                    shiftKey: eventData.shiftKey,
                    ctrlKey: eventData.ctrlKey,
                    altKey: eventData.altKey,
                    metaKey: eventData.metaKey,
                    bubbles: true,
                    cancelable: true
                });

                document.activeElement?.dispatchEvent(event);
            }

            return true;
        } catch (error) {
            console.error('Failed to send key event:', error);
            return false;
        }
    }

    // Get key code for legacy support
    getKeyCode(keyId) {
        const keyCodes = {
            // Letters
            'a': 65, 'b': 66, 'c': 67, 'd': 68, 'e': 69, 'f': 70, 'g': 71, 'h': 72,
            'i': 73, 'j': 74, 'k': 75, 'l': 76, 'm': 77, 'n': 78, 'o': 79, 'p': 80,
            'q': 81, 'r': 82, 's': 83, 't': 84, 'u': 85, 'v': 86, 'w': 87, 'x': 88,
            'y': 89, 'z': 90,
            
            // Numbers
            '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55,
            '8': 56, '9': 57,
            
            // Special keys
            'Space': 32, 'Enter': 13, 'Tab': 9, 'Backspace': 8, 'Delete': 46,
            'Escape': 27,
            
            // Symbols
            ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192,
            '[': 219, '\\': 220, ']': 221, '\'': 222,
            
            // Numpad
            'Numpad0': 96, 'Numpad1': 97, 'Numpad2': 98, 'Numpad3': 99, 'Numpad4': 100,
            'Numpad5': 101, 'Numpad6': 102, 'Numpad7': 103, 'Numpad8': 104, 'Numpad9': 105,
            'NumpadMultiply': 106, 'NumpadAdd': 107, 'NumpadSubtract': 109,
            'NumpadDecimal': 110, 'NumpadDivide': 111, 'NumpadEnter': 13
        };

        return keyCodes[keyId] || 0;
    }

    // Type a string
    typeString(text, options = {}) {
        const delay = options.delay || 50; // ms between keystrokes
        const chars = text.split('');
        
        let index = 0;
        const typeNext = () => {
            if (index < chars.length) {
                const char = chars[index];
                const keyId = this.findKeyForChar(char);
                
                if (keyId) {
                    this.pressKey(keyId, { 
                        shift: this.needsShift(char) 
                    });
                }
                
                index++;
                setTimeout(typeNext, delay);
            }
        };

        typeNext();
    }

    // Find key ID for character
    findKeyForChar(char) {
        for (const [keyId, keyInfo] of Object.entries(this.keyMappings)) {
            if (keyInfo.key === char || keyInfo.shiftKey === char) {
                return keyId;
            }
        }
        return null;
    }

    // Check if character needs shift
    needsShift(char) {
        for (const keyInfo of Object.values(this.keyMappings)) {
            if (keyInfo.shiftKey === char) {
                return true;
            }
        }
        return false;
    }

    // Toggle modifier keys
    toggleShift() {
        this.isShiftPressed = !this.isShiftPressed;
        return this.isShiftPressed;
    }

    toggleCapsLock() {
        this.isCapsLockOn = !this.isCapsLockOn;
        return this.isCapsLockOn;
    }

    toggleNumLock() {
        this.isNumLockOn = !this.isNumLockOn;
        return this.isNumLockOn;
    }

    // Set keyboard mode
    setMode(mode) {
        if (['full', 'keypad'].includes(mode)) {
            this.keyboardMode = mode;
            return true;
        }
        return false;
    }

    // Get current layout based on mode
    getCurrentLayout() {
        return this.keyboardMode === 'keypad' ? 
            this.keyboardLayouts.numpad : 
            this.keyboardLayouts.qwerty;
    }

    // Generate key matrix for UI
    generateKeyMatrix() {
        const layout = this.getCurrentLayout();
        return layout.map(row => {
            return row.map(keyId => ({
                id: keyId,
                label: this.getKeyLabel(keyId),
                type: this.getKeyType(keyId),
                width: this.getKeyWidth(keyId)
            }));
        });
    }

    // Get display label for key
    getKeyLabel(keyId) {
        const specialLabels = {
            'Space': '⎵',
            'Enter': '↵',
            'Tab': '⇥',
            'Backspace': '⌫',
            'Delete': '⌦',
            'Escape': 'Esc',
            'CapsLock': 'Caps',
            'Shift': '⇧',
            'Ctrl': 'Ctrl',
            'Alt': 'Alt',
            'NumLock': 'Num',
            'NumpadEnter': '↵',
            'NumpadAdd': '+',
            'NumpadSubtract': '-',
            'NumpadMultiply': '×',
            'NumpadDivide': '÷',
            'NumpadDecimal': '.'
        };

        if (specialLabels[keyId]) {
            return specialLabels[keyId];
        }

        const keyInfo = this.keyMappings[keyId];
        if (keyInfo) {
            if (this.isShiftPressed && keyInfo.shiftKey) {
                return keyInfo.shiftKey;
            }
            return keyInfo.key;
        }

        return keyId;
    }

    // Get key type for styling
    getKeyType(keyId) {
        const modifierKeys = ['Shift', 'Ctrl', 'Alt', 'CapsLock', 'NumLock'];
        const functionKeys = ['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'NumpadEnter'];
        
        if (modifierKeys.includes(keyId)) {
            return 'modifier';
        }
        if (functionKeys.includes(keyId)) {
            return 'function';
        }
        if (keyId === 'Space') {
            return 'space';
        }
        if (keyId.startsWith('Numpad')) {
            return 'numpad';
        }
        
        return 'normal';
    }

    // Get key width multiplier for layout
    getKeyWidth(keyId) {
        const wideKeys = {
            'Tab': 1.5,
            'CapsLock': 1.75,
            'Shift': 2.25,
            'Enter': 2.25,
            'Backspace': 2,
            'Space': 6,
            'NumpadEnter': 2,
            'Numpad0': 2
        };

        return wideKeys[keyId] || 1;
    }
}