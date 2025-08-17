/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/
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

    // Helper function to create a virtual printer device
    function createPrinterDevice(brand, vendorId, productId) {
        return {
            brand: brand,
            vendorId: vendorId,
            productId: productId,
            productName: `Virtual ${brand} Printer`,
            opened: false,
            open: async () => { console.log(`[Interceptor] FAKE ${brand.toUpperCase()}.open`); return Promise.resolve(); },
            close: async () => { console.log(`[Interceptor] FAKE ${brand.toUpperCase()}.close`); return Promise.resolve(); },
            selectConfiguration: async () => { console.log(`[Interceptor] FAKE ${brand.toUpperCase()}.selectConfiguration`); return Promise.resolve(); },
            claimInterface: async () => { console.log(`[Interceptor] FAKE ${brand.toUpperCase()}.claimInterface`); return Promise.resolve(); },
            transferOut: async function(endpointNumber, data) {
                console.log(`[Interceptor] FAKE ${brand.toUpperCase()}.transferOut with ${data.byteLength} bytes.`);
                const payloadArray = bufferSourceToByteArray(data);
                window.postMessage({
                    type: 'POS_SIMULATOR_RAW_DATA',
                    source: 'webusb',
                    deviceType: 'printer',
                    brand: this.brand, // Pass the brand
                    payload: payloadArray
                }, '*');
                return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
            },
        };
    }

    const devices = {
        // Printer devices
        epson: createPrinterDevice('epson', 0x04b8, 0x0202),
        star: createPrinterDevice('star', 0x0519, 0x0003), // Common product ID for Star
        citizen: createPrinterDevice('citizen', 0x1d90, 0x2037), // Common product ID for Citizen

        // Other devices
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

    // Store printers in a separate map for easy lookup
    const printerDevices = new Map([
        [devices.epson.vendorId, devices.epson],
        [devices.star.vendorId, devices.star],
        [devices.citizen.vendorId, devices.citizen]
    ]);

    navigator.usb.requestDevice = async (options) => {
        console.log('[Interceptor] Intercepted navigator.usb.requestDevice with options:', options);

        if (!options || !options.filters || options.filters.length === 0) {
            console.warn('[Interceptor] requestDevice called with no filters. Returning default Epson printer.');
            return Promise.resolve(devices.epson); // Default to Epson
        }

        for (const filter of options.filters) {
            // Check for printers
            if (printerDevices.has(filter.vendorId)) {
                const printer = printerDevices.get(filter.vendorId);
                console.log(`[Interceptor] Matched ${printer.brand.toUpperCase()} printer. Returning virtual device.`);
                return Promise.resolve(printer);
            }

            // Check for other devices like Line Display
            if (filter.vendorId === devices.lineDisplay.vendorId) {
                console.log('[Interceptor] Line Display requested. Returning virtual line display.');
                return Promise.resolve(devices.lineDisplay);
            }
        }

        console.error('[Interceptor] No matching device found for filters:', options.filters);
        return Promise.reject(new Error("No device selected."));
    };

    // --- WebHID Interception ---
    if (!navigator.hid) navigator.hid = {};

    const fakeHIDDevice = {
        vendorId: 0x1504, // Logic Controls (common for line displays)
        productId: 0x0006,
        productName: 'Virtual Line Display',
        collections: [],
        opened: false,

        open: async function() {
            console.log('[Interceptor] FAKE HID.open');
            this.opened = true;
            return Promise.resolve();
        },

        close: async function() {
            console.log('[Interceptor] FAKE HID.close');
            this.opened = false;
            return Promise.resolve();
        },

        sendReport: async function(reportId, data) {
            console.log(`[Interceptor] FAKE HID.sendReport with ${data.byteLength} bytes`);
            const payloadArray = bufferSourceToByteArray(data);
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webhid',
                deviceType: 'line-display',
                payload: payloadArray
            }, '*');
            return Promise.resolve();
        }
    };

    navigator.hid.requestDevice = async (options) => {
        console.log('[Interceptor] Intercepted navigator.hid.requestDevice with options:', options);
        return Promise.resolve([fakeHIDDevice]);
    };

    navigator.hid.getDevices = async () => {
        console.log('[Interceptor] Intercepted navigator.hid.getDevices');
        return Promise.resolve([fakeHIDDevice]);
    };

    // --- WebSerial Interception ---
    if (!navigator.serial) navigator.serial = {};

    // Enhanced WebSerial with better device simulation
    const enhancedFakeSerialPort = {
        getInfo: () => ({
            usbVendorId: 0x1504,  // Logic Controls
            usbProductId: 0x0006,
            bluetoothServiceClassId: undefined
        }),

        opened: false,
        writable: null,
        readable: null,

        open: async function(options) {
            console.log('[Interceptor] Enhanced serial port opening with options:', options);
            this.opened = true;

            // Create enhanced writable stream that handles line display commands
            this.writable = new WritableStream({
                write(chunk) {
                    const payloadArray = bufferSourceToByteArray(chunk);

                    // Check if it's a line display command pattern
                    const hex = Array.from(payloadArray).map(b => b.toString(16).padStart(2, '0')).join('');
                    console.log('[Interceptor] Serial command:', hex);

                    window.postMessage({
                        type: 'POS_SIMULATOR_RAW_DATA',
                        source: 'webserial',
                        deviceType: 'line-display',
                        payload: payloadArray
                    }, '*');
                }
            });

            // Create readable stream for device responses
            this.readable = new ReadableStream({
                start(controller) {
                    // Simulate device ready response
                    setTimeout(() => {
                        controller.enqueue(new Uint8Array([0x06])); // ACK
                    }, 100);
                }
            });

            return Promise.resolve();
        },

        close: async function() {
            this.opened = false;
            return Promise.resolve();
        }
    };

    navigator.serial.requestPort = (options) => {
        console.log('[Interceptor] Intercepted navigator.serial.requestPort with options:', options);
        return Promise.resolve(enhancedFakeSerialPort);
    };

    // Auto-populate available devices
    navigator.serial.getPorts = async () => {
        console.log('[Interceptor] Intercepted navigator.serial.getPorts');
        return Promise.resolve([enhancedFakeSerialPort]);
    };

    // Simulate device connection events
    setTimeout(() => {
        if (navigator.serial.addEventListener) {
            const connectEvent = new Event('connect');
            connectEvent.port = enhancedFakeSerialPort;
            navigator.serial.dispatchEvent(connectEvent);
        }
    }, 2000);

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
