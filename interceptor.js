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
    const devices = {
        printer: {
            vendorId: 0x04b8, // Epson
            productId: 0x0202,
            productName: 'Virtual ESC/POS Printer',
            opened: false,
            open: async () => { console.log('[Interceptor] FAKE PRINTER.open'); return Promise.resolve(); },
            close: async () => { console.log('[Interceptor] FAKE PRINTER.close'); return Promise.resolve(); },
            selectConfiguration: async () => { console.log('[Interceptor] FAKE PRINTER.selectConfiguration'); return Promise.resolve(); },
            claimInterface: async () => { console.log('[Interceptor] FAKE PRINTER.claimInterface'); return Promise.resolve(); },
            transferOut: async function(endpointNumber, data) {
                console.log(`[Interceptor] FAKE PRINTER.transferOut with ${data.byteLength} bytes.`);
                const payloadArray = bufferSourceToByteArray(data);
                window.postMessage({
                    type: 'POS_SIMULATOR_RAW_DATA',
                    source: 'webusb',
                    deviceType: 'printer',
                    payload: payloadArray
                }, '*');
                return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
            },
        },
        lineDisplay: {
            vendorId: 0x1504, // Logic Controls (Bematech)
            productId: 0x0006,
            productName: 'Virtual Line Display',
            opened: false,
            open: async () => { console.log('[Interceptor] FAKE LINEDISPLAY.open'); return Promise.resolve(); },
            close: async () => { console.log('[Interceptor] FAKE LINEDISPLAY.close'); return Promise.resolve(); },
            selectConfiguration: async () => { console.log('[Interceptor] FAKE LINEDISPLAY.selectConfiguration'); return Promise.resolve(); },
            claimInterface: async () => { console.log('[Interceptor] FAKE LINEDISPLAY.claimInterface'); return Promise.resolve(); },
            transferOut: async function(endpointNumber, data) {
                console.log(`[Interceptor] FAKE LINEDISPLAY.transferOut with ${data.byteLength} bytes.`);
                const payloadArray = bufferSourceToByteArray(data);
                window.postMessage({
                    type: 'POS_SIMULATOR_RAW_DATA',
                    source: 'webusb',
                    deviceType: 'line-display',
                    payload: payloadArray
                }, '*');
                return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
            },
        }
    };

    navigator.usb.requestDevice = async (options) => {
        console.log('[Interceptor] Intercepted navigator.usb.requestDevice with options:', options);

        if (!options || !options.filters || options.filters.length === 0) {
            console.warn('[Interceptor] requestDevice called with no filters. Returning default printer.');
            // This behavior is for backward compatibility or general requests.
            return Promise.resolve(devices.printer);
        }

        for (const filter of options.filters) {
            if (filter.vendorId === devices.lineDisplay.vendorId) {
                console.log('[Interceptor] Line Display requested. Returning virtual line display.');
                return Promise.resolve(devices.lineDisplay);
            }
            if (filter.vendorId === devices.printer.vendorId) {
                console.log('[Interceptor] Printer requested. Returning virtual printer.');
                return Promise.resolve(devices.printer);
            }
        }

        console.error('[Interceptor] No matching device found for filters:', options.filters);
        // To avoid breaking the POS app, we can either return a default or reject.
        // Rejecting is closer to the real API behavior if no device is found/chosen.
        return Promise.reject(new Error("No device selected."));
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
                        // We can't easily distinguish serial devices without more info,
                        // so we'll assume a generic 'serial' type for now.
                        deviceType: 'serial',
                        payload: payloadArray
                    }, '*');
                }
            });
            this.readable = new ReadableStream();
            return Promise.resolve();
        },
        close: async function() { this.opened = false; return Promise.resolve(); },
    };
    navigator.serial.requestPort = (options) => {
        console.log('[Interceptor] Intercepted navigator.serial.requestPort with options:', options);
        // The Web Serial API `requestPort` also has filters. We could expand this
        // in the future if needed, but for now, we return the single fake port.
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
            // Define the characteristic once to be reused.
            const fakeCharacteristic = {
                properties: {
                    write: true,
                    writeWithoutResponse: true,
                    read: false,
                    notify: false,
                    indicate: false
                },
                writeValue: async (value) => {
                    console.log(`[Interceptor] FAKE BT Char.writeValue with ${value.byteLength} bytes`);
                    const payloadArray = bufferSourceToByteArray(value);
                    window.postMessage({
                        type: 'POS_SIMULATOR_RAW_DATA',
                        source: 'webbluetooth',
                        deviceType: 'bluetooth-printer',
                        payload: payloadArray
                    }, '*');
                    return Promise.resolve();
                },
                // The `...WithResponse` and `...WithoutResponse` methods are often just aliases
                // in simulators, pointing to the core `writeValue` logic.
                writeValueWithResponse: async function(value) {
                    console.log(`[Interceptor] FAKE BT Char.writeValueWithResponse with ${value.byteLength} bytes`);
                    return this.writeValue(value);
                },
                writeValueWithoutResponse: async function(value) {
                    console.log(`[Interceptor] FAKE BT Char.writeValueWithoutResponse with ${value.byteLength} bytes`);
                    return this.writeValue(value);
                }
            };

            // Return a service object that has both singular and plural methods
            return Promise.resolve({
                getCharacteristic: async () => {
                    console.log('[Interceptor] FAKE BT Service.getCharacteristic (singular)');
                    return Promise.resolve(fakeCharacteristic);
                },
                getCharacteristics: async () => {
                    console.log('[Interceptor] FAKE BT Service.getCharacteristics (plural)');
                    // The spec returns an array of characteristics.
                    return Promise.resolve([fakeCharacteristic]);
                }
            });
        },
    };

    // 3. Attach the fully-formed GATT server to the device
    fakeBluetoothDevice.gatt = gattServer;

    // 4. Intercept the requestDevice call
    navigator.bluetooth.requestDevice = (options) => {
        console.log('[Interceptor] Intercepted navigator.bluetooth.requestDevice with options:', options);
        // Bluetooth filtering can be complex. For now, we'll return the single
        // fake printer device regardless of the filter.
        return Promise.resolve(fakeBluetoothDevice);
    };

    // --- Network (Fetch) Interception ---
    const originalFetch = window.fetch;
    window.fetch = async function(resource, config) {
        const url = resource instanceof Request ? resource.url : resource;

        // Check if it's the specific proxy URL we want to intercept
        if (url.includes('/api/proxy_printer.php')) {
            console.log(`[Interceptor] Intercepted fetch call to: ${url}`);

            // The body might be a string, blob, or buffer. The POS sends XML as a string.
            const body = await (config.body ? new Response(config.body).text() : Promise.resolve(''));

            // Post the data to the content script for the simulator UI
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'network',
                deviceType: 'network-printer',
                payload: body // Send the raw XML/text data
            }, '*');

            // Simulate a successful response from the printer proxy
            const successResponse = new Response(
                '<?xml version="1.0" encoding="UTF-8"?><response success="true"></response>', {
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        'Content-Type': 'text/xml'
                    }
                }
            );

            return Promise.resolve(successResponse);
        }

        // For all other requests, use the original fetch
        return originalFetch.apply(this, arguments);
    };


    console.log('[interceptor.js] All APIs intercepted.');
})();
