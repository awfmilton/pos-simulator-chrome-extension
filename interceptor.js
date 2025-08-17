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

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data.type) {
            return;
        }

        if (event.data.type === 'UPDATE_SCALE_VARIABLES') {
            window.posScaleWeight = event.data.weight;
            window.posScaleUnit = event.data.unit;
            window.posScaleStable = event.data.stable;
            console.log(`[Interceptor] Updated scale variables:`, {weight: window.posScaleWeight, unit: window.posScaleUnit, stable: window.posScaleStable });
        }
    });

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

// --- Weight Scale Devices ---
const scaleDevices = {
    // USB Scales
    mettlerToledo: {
        vendorId: 0x0eb8,
        productId: 0xf000,
        productName: 'Virtual Mettler Toledo Scale',
        opened: false,
        weight: 0,
        unit: 'lb',
        stable: true,
        zero: true
    },

    detecto: {
        vendorId: 0x1a86,
        productId: 0x7523,
        productName: 'Virtual Detecto Scale',
        opened: false,
        weight: 0,
        unit: 'lb',
        stable: true,
        zero: true
    },

    // Generic Serial Scale
    serialScale: {
        vendorId: 0x10C4,
        productId: 0xEA60,
        productName: 'Virtual Serial Scale',
        opened: false,
        weight: 0,
        unit: 'lb',
        stable: true,
        zero: true
    }
};

// Helper function to create virtual USB scale device
function createUSBScaleDevice(scaleType, config) {
    return {
        vendorId: config.vendorId,
        productId: config.productId,
        productName: config.productName,
        opened: false,

        open: async () => {
            console.log(`[Interceptor] FAKE ${scaleType.toUpperCase()} SCALE.open`);
            return Promise.resolve();
        },

        close: async () => {
            console.log(`[Interceptor] FAKE ${scaleType.toUpperCase()} SCALE.close`);
            return Promise.resolve();
        },

        selectConfiguration: async () => {
            console.log(`[Interceptor] FAKE ${scaleType.toUpperCase()} SCALE.selectConfiguration`);
            return Promise.resolve();
        },

        claimInterface: async () => {
            console.log(`[Interceptor] FAKE ${scaleType.toUpperCase()} SCALE.claimInterface`);
            return Promise.resolve();
        },

        transferIn: async function(endpointNumber, length) {
            console.log(`[Interceptor] FAKE ${scaleType.toUpperCase()} SCALE.transferIn requested ${length} bytes`);

            // Get current weight from extension
            const currentWeight = window.posScaleWeight || 0;
            const currentUnit = window.posScaleUnit || 'lb';
            const isStable = window.posScaleStable !== false;
            const isZero = Math.abs(currentWeight) < 0.001;

            let data;
            // Mettler Toledo format (example)
            if (scaleType === 'mettlerToledo') {
                const status = isStable ? 2 : 1; // 2 = stable, 1 = unstable
                const weightLb = currentWeight.toFixed(2);
                const response = `${status} ${weightLb} lb\r\n`;
                data = new TextEncoder().encode(response);
            }
            // Detecto format (example)
            else if (scaleType === 'detecto') {
                 const weightKg = (currentWeight * 0.453592).toFixed(3);
                 const response = `S_S_${weightKg}_kg\r\n`;
                 data = new TextEncoder().encode(response);
            }
            // Generic fallback
            else {
                const response = `${currentWeight.toFixed(2)}${currentUnit}`;
                data = new TextEncoder().encode(response);
            }

             window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webusb',
                deviceType: 'scale',
                scaleType: scaleType,
                payload: Array.from(data)
            }, '*');

            return Promise.resolve({
                status: 'ok',
                data: new DataView(data.buffer)
            });
        },
    };
}

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
        // Existing printer devices...
        epson: createPrinterDevice('epson', 0x04b8, 0x0202),
        star: createPrinterDevice('star', 0x0519, 0x0003),
        citizen: createPrinterDevice('citizen', 0x1d90, 0x2037),

        // Add scale devices
        mettlerScale: createUSBScaleDevice('mettlerToledo', scaleDevices.mettlerToledo),
        detectoScale: createUSBScaleDevice('detecto', scaleDevices.detecto),
        serialScale: createUSBScaleDevice('serialScale', scaleDevices.serialScale),

        // Existing line display...
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

    // Update USB device mapping
    const scaleUSBDevices = new Map([
        [0x0eb8, devices.mettlerScale], // Mettler Toledo
        [0x1a86, devices.detectoScale], // Detecto
        [0x10C4, devices.serialScale]   // Generic serial scale
    ]);

    // Update requestDevice to handle scales
    navigator.usb.requestDevice = async (options) => {
        console.log('[Interceptor] Intercepted navigator.usb.requestDevice with options:', options);

        if (!options || !options.filters || options.filters.length === 0) {
            console.warn('[Interceptor] requestDevice called with no filters. Returning default scale.');
            return Promise.resolve(devices.mettlerScale);
        }

        for (const filter of options.filters) {
            // Check for scales first
            if (scaleUSBDevices.has(filter.vendorId)) {
                const scale = scaleUSBDevices.get(filter.vendorId);
                console.log(`[Interceptor] Scale detected. Returning virtual scale device.`);
                return Promise.resolve(scale);
            }

            // Existing printer detection...
            if (printerDevices.has(filter.vendorId)) {
                const printer = printerDevices.get(filter.vendorId);
                console.log(`[Interceptor] Matched ${printer.brand.toUpperCase()} printer. Returning virtual device.`);
                return Promise.resolve(printer);
            }

            // Line display detection...
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

    // Enhanced WebHID for scales
    const fakeHIDScaleDevice = {
        vendorId: 0x0922, // Dymo scales
        productId: 0x8003,
        productName: 'Virtual HID Scale',
        collections: [{
            usage: 0x01,
            usagePage: 0x8d, // Scale usage page
            inputReports: [{ reportId: 1, items: [] }],
            outputReports: [{ reportId: 1, items: [] }]
        }],
        opened: false,

        open: async function() {
            console.log('[Interceptor] FAKE HID SCALE.open');
            this.opened = true;

            // Start sending weight reports
            this.startWeightReports();
            return Promise.resolve();
        },

        close: async function() {
            console.log('[Interceptor] FAKE HID SCALE.close');
            this.opened = false;
            if (this.reportInterval) {
                clearInterval(this.reportInterval);
            }
            return Promise.resolve();
        },

        sendReport: async function(reportId, data) {
            console.log(`[Interceptor] FAKE HID SCALE.sendReport ${reportId}`);

            // Handle scale commands
            const command = Array.from(new Uint8Array(data));
            if (command[0] === 0x02) { // Tare command
                window.posScaleWeight = 0;
                console.log('[Interceptor] Scale tared via HID');
            }

            return Promise.resolve();
        },

        addEventListener: function(type, callback) {
            if (type === 'inputreport') {
                this.inputReportCallback = callback;
            }
        },

        startWeightReports: function() {
            this.reportInterval = setInterval(() => {
                if (!this.opened || !this.inputReportCallback) return;

                const weight = window.posScaleWeight || 0;
                const weightGrams = Math.round(weight * 453.592); // Convert to grams
                const isStable = window.posScaleStable !== false;

                // Create HID weight report (simplified format)
                const reportData = new ArrayBuffer(6);
                const view = new DataView(reportData);
                view.setUint8(0, 0x03); // Report ID
                view.setUint8(1, isStable ? 0x04 : 0x02); // Status byte
                view.setUint32(2, weightGrams, true); // Weight in grams (little endian)

                const event = {
                    device: this,
                    reportId: 0x03,
                    data: view
                };

                this.inputReportCallback(event);

                // Also send to extension
                window.postMessage({
                    type: 'POS_SIMULATOR_RAW_DATA',
                    source: 'webhid',
                    deviceType: 'scale',
                    payload: Array.from(new Uint8Array(reportData))
                }, '*');

            }, 500);
        }
    };

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
        if (options && options.filters) {
            for (const filter of options.filters) {
                if (filter.vendorId === 0x0922 && filter.productId === 0x8003) {
                    console.log('[Interceptor] HID Scale requested. Returning virtual scale.');
                    return Promise.resolve([fakeHIDScaleDevice]);
                }
                if (filter.vendorId === 0x1504 && filter.productId === 0x0006) {
                    console.log('[Interceptor] HID Line Display requested. Returning virtual display.');
                    return Promise.resolve([fakeHIDDevice]);
                }
            }
        }
        // Default or fallback
        console.log('[Interceptor] No specific HID filter match, returning default Line Display.');
        return Promise.resolve([fakeHIDDevice]);
    };

    navigator.hid.getDevices = async () => {
        console.log('[Interceptor] Intercepted navigator.hid.getDevices');
        return Promise.resolve([fakeHIDDevice, fakeHIDScaleDevice]);
    };

    // --- WebSerial Interception ---
    if (!navigator.serial) navigator.serial = {};

    const fakeSerialScalePort = {
        getInfo: () => ({
            usbVendorId: 0x10C4,  // Common for serial scales
            usbProductId: 0xEA60,
            bluetoothServiceClassId: undefined
        }),

        opened: false,
        writable: null,
        readable: null,

        open: async function(options) {
            console.log('[Interceptor] Enhanced serial port opening for scale with options:', options);
            this.opened = true;

            // Create writable stream for commands to scale
            this.writable = new WritableStream({
                write(chunk) {
                    const command = new TextDecoder().decode(chunk);
                    console.log('[Interceptor] Scale command received:', command);

                    // Handle common scale commands
                    if (command.includes('W') || command.includes('weight')) {
                        // Weight request - respond via readable stream
                        console.log('[Interceptor] Weight request received');
                    } else if (command.includes('Z') || command.includes('zero')) {
                        window.posScaleWeight = 0;
                        console.log('[Interceptor] Scale zeroed via serial');
                    }

                    window.postMessage({
                        type: 'POS_SIMULATOR_RAW_DATA',
                        source: 'webserial',
                        deviceType: 'scale',
                        payload: Array.from(chunk)
                    }, '*');
                }
            });

            // Create readable stream for scale responses
            this.readable = new ReadableStream({
                start(controller) {
                    // Set up interval to send weight data
                    const sendWeight = () => {
                        const currentWeight = window.posScaleWeight || 0;
                        const currentUnit = window.posScaleUnit || 'lb';
                        const isStable = window.posScaleStable !== false;

                        // Generic scale response format
                        const response = `${currentWeight.toFixed(2)},${currentUnit},${isStable ? 'S' : 'U'}\n`;
                        const responseBytes = new TextEncoder().encode(response);

                        try {
                            controller.enqueue(new Uint8Array(responseBytes));
                        } catch (error) {
                            console.log('[Interceptor] Scale readable stream closed');
                            clearInterval(weightInterval);
                        }
                    };

                    // Send weight every 500ms when requested
                    let weightInterval;

                    // Listen for weight requests
                    window.addEventListener('message', (event) => {
                        if (event.data.type === 'SCALE_START_READING') {
                            weightInterval = setInterval(sendWeight, 500);
                        } else if (event.data.type === 'SCALE_STOP_READING') {
                            clearInterval(weightInterval);
                        }
                    });

                    // Initial response
                    setTimeout(() => {
                        controller.enqueue(new TextEncoder().encode('SCALE READY\n'));
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
        if (options && options.filters) {
            for (const filter of options.filters) {
                // Check for scale
                if (filter.usbVendorId === 0x10C4 && filter.usbProductId === 0xEA60) {
                     console.log('[Interceptor] Serial Scale requested. Returning virtual scale port.');
                     return Promise.resolve(fakeSerialScalePort);
                }
                // Check for line display
                if (filter.usbVendorId === 0x1504 && filter.usbProductId === 0x0006) {
                     console.log('[Interceptor] Serial Line Display requested. Returning virtual display port.');
                     return Promise.resolve(enhancedFakeSerialPort);
                }
            }
        }
        console.log('[Interceptor] No specific serial filter match, returning default Line Display port.');
        return Promise.resolve(enhancedFakeSerialPort);
    };

    // Auto-populate available devices
    navigator.serial.getPorts = async () => {
        console.log('[Interceptor] Intercepted navigator.serial.getPorts');
        return Promise.resolve([enhancedFakeSerialPort, fakeSerialScalePort]);
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
