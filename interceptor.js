// interceptor.js
// This script is injected into the main world to intercept peripheral API calls.

(function() {
    console.log('[interceptor.js] Running in main world.');

    // A helper to safely convert BufferSource to a byte array
    function bufferSourceToByteArray(source) {
        if (source instanceof ArrayBuffer) {
            return Array.from(new Uint8Array(source));
        }
        if (ArrayBuffer.isView(source)) {
            return Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
        }
        // Fallback for other cases, though less common
        return Array.from(new Uint8Array(source));
    }


    // --- WebUSB Interception ---
    if (!navigator.usb) navigator.usb = {};
    const fakeUsbDevice = {
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
            const payloadArray = bufferSourceToByteArray(data);

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
                    const payloadArray = bufferSourceToByteArray(chunk);
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

    // --- WebBluetooth Interception (Corrected) ---
    if (!navigator.bluetooth) navigator.bluetooth = {};

    // 1. Define the device first, without the gatt server
    const fakeBluetoothDevice = {
        id: 'FAKE_BT_DEVICE_ID',
        name: 'Virtual Bluetooth Printer',
        gatt: null, // We'll attach this next
    };

    // 2. Create the GATT server with a back-reference to the device
    const gattServer = {
        device: fakeBluetoothDevice, // This is the required back-reference
        connected: false,
        connect: async function() {
            console.log('[Interceptor] FAKE BT GATT.connect');
            this.connected = true;
            return Promise.resolve(this); // 'this' is the gattServer object
        },
        disconnect: function() {
            console.log('[Interceptor] FAKE BT GATT.disconnect');
            this.connected = false;
        },
        getPrimaryService: async () => {
            console.log('[Interceptor] FAKE BT GATT.getPrimaryService');
            return Promise.resolve({
                getCharacteristic: async () => {
                    console.log('[Interceptor] FAKE BT Service.getCharacteristic');
                    return Promise.resolve({
                        writeValue: async (value) => {
                            console.log(`[Interceptor] FAKE BT Char.writeValue with ${value.byteLength} bytes`);
                            const payloadArray = bufferSourceToByteArray(value);
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
    };

    // 3. Attach the fully-formed GATT server to the device
    fakeBluetoothDevice.gatt = gattServer;

    // 4. Intercept the requestDevice call
    navigator.bluetooth.requestDevice = () => {
        console.log('[Interceptor] Intercepted navigator.bluetooth.requestDevice');
        return Promise.resolve(fakeBluetoothDevice);
    };


    console.log('[interceptor.js] All APIs intercepted.');
})();
