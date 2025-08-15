// interceptor.js
// This script is injected into the main world to intercept peripheral API calls.

(function() {
    console.log('[interceptor.js] Running in main world.');

    // --- WebUSB Interception ---
    if (!navigator.usb) navigator.usb = {};
    const fakeUsbDevice = {
        // ... (all the properties from your fakeDevice object)
        vendorId: 0x04b8,
        productId: 0x0202,
        productName: 'Virtual ESC/POS Printer',
        opened: false,
        open: async () => { console.log('[Interceptor] FAKE USB.open'); return Promise.resolve(); },
        close: async () => { console.log('[Interceptor] FAKE USB.close'); return Promise.resolve(); },
        selectConfiguration: async () => { console.log('[Interceptor] FAKE USB.selectConfiguration'); return Promise.resolve(); },
        claimInterface: async () => { console.log('[Interceptor] FAKE USB.claimInterface'); return Promise.resolve(); },
        releaseInterface: async () => { console.log('[Interceptor] FAKE USB.releaseInterface'); return Promise.resolve(); },
        reset: async () => { console.log('[Interceptor] FAKE USB.reset'); return Promise.resolve(); },

        transferOut: async function(endpointNumber, data) {
            console.log(`[Interceptor] FAKE USB.transferOut called with ${data.byteLength} bytes.`);
            const payloadArray = Array.from(new Uint8Array(data.buffer));

            // Use window.postMessage to send data to the content script
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webusb',
                payload: payloadArray
            }, '*');

            return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
        },
    };
    navigator.usb.requestDevice = () => {
        console.log('[Interceptor] Intercepted navigator.usb.requestDevice');
        return Promise.resolve(fakeUsbDevice);
    };

    // --- WebSerial Interception ---
    if (!navigator.serial) navigator.serial = {};
    const fakeSerialPort = {
        getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
        opened: false,
        writable: null,
        readable: null,
        open: async function(options) {
            this.opened = true;
            this.writable = new WritableStream({
                write(chunk) {
                    const payloadArray = Array.from(new Uint8Array(chunk));
                    window.postMessage({
                        type: 'POS_SIMULATOR_RAW_DATA',
                        source: 'webserial',
                        payload: payloadArray
                    }, '*');
                }
            });
            this.readable = new ReadableStream();
            return Promise.resolve();
        },
        close: async function() { this.opened = false; return Promise.resolve(); },
    };
    navigator.serial.requestPort = () => {
        console.log('[Interceptor] Intercepted navigator.serial.requestPort');
        return Promise.resolve(fakeSerialPort);
    };

    // --- WebBluetooth Interception ---
    if (!navigator.bluetooth) navigator.bluetooth = {};
    const fakeBluetoothDevice = {
        id: 'FAKE_BT_DEVICE_ID',
        name: 'Virtual Bluetooth Printer',
        gatt: {
            connected: false,
            connect: async function() {
                this.connected = true;
                return Promise.resolve(this);
            },
            getPrimaryService: async () => {
                return Promise.resolve({
                    getCharacteristic: async () => {
                        return Promise.resolve({
                            writeValue: async (value) => {
                                const payloadArray = Array.from(new Uint8Array(value));
                                window.postMessage({
                                    type: 'POS_SIMULATOR_RAW_DATA',
                                    source: 'webbluetooth',
                                    payload: payloadArray
                                }, '*');
                                return Promise.resolve();
                            }
                        });
                    }
                });
            },
            disconnect: function() { this.connected = false; }
        }
    };
    navigator.bluetooth.requestDevice = () => {
        console.log('[Interceptor] Intercepted navigator.bluetooth.requestDevice');
        return Promise.resolve(fakeBluetoothDevice);
    };

    console.log('[interceptor.js] All APIs intercepted.');
})();
