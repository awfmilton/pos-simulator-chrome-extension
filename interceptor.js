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
        if (!event.data || !event.data.type) {
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
        if (typeof source === 'object' && source !== null && typeof source.length === 'number') {
            return Array.from(source);
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

// --- Cash Drawer Devices ---
const drawerDevices = {
    // USB Cash Drawer
    usbDrawer: {
        vendorId: 0x04d9, // APG Cash Drawer
        productId: 0x1203,
        productName: 'Virtual Cash Drawer',
        opened: false
    },

    // Serial Cash Drawer
    serialDrawer: {
        vendorId: 0x0403, // FTDI
        productId: 0x6001,
        productName: 'Virtual Serial Cash Drawer',
        opened: false
    }
};

// Helper function to create virtual USB drawer device
function createUSBDrawerDevice(drawerType, config) {
    return {
        vendorId: config.vendorId,
        productId: config.productId,
        productName: config.productName,
        opened: false,

        open: async () => {
            console.log(`[Interceptor] FAKE ${drawerType.toUpperCase()} DRAWER.open`);
            return Promise.resolve();
        },

        close: async () => {
            console.log(`[Interceptor] FAKE ${drawerType.toUpperCase()} DRAWER.close`);
            return Promise.resolve();
        },

        selectConfiguration: async () => {
            console.log(`[Interceptor] FAKE ${drawerType.toUpperCase()} DRAWER.selectConfiguration`);
            return Promise.resolve();
        },

        claimInterface: async () => {
            console.log(`[Interceptor] FAKE ${drawerType.toUpperCase()} DRAWER.claimInterface`);
            return Promise.resolve();
        },

        transferOut: async function(endpointNumber, data) {
            console.log(`[Interceptor] FAKE ${drawerType.toUpperCase()} DRAWER.transferOut - OPENING DRAWER!`);

            // Send drawer open command
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webusb',
                deviceType: 'cash-drawer',
                drawerType: drawerType,
                payload: Array.from(data),
                command: 'open'
            }, '*');

            return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
        }
    };
}

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

// Enhanced USB printer devices with proper vendor/product IDs
const printerUSBDevices = {
    epson: {
        // Epson TM series printers
        tm_t88vi: { vendorId: 0x04b8, productId: 0x0202, name: 'EPSON TM-T88VI' },
        tm_t20iii: { vendorId: 0x04b8, productId: 0x0219, name: 'EPSON TM-T20III' },
        tm_m30ii: { vendorId: 0x04b8, productId: 0x0220, name: 'EPSON TM-M30II' }
    },
    star: {
        // Star Micronics TSP series
        tsp100: { vendorId: 0x0519, productId: 0x0003, name: 'Star TSP100' },
        tsp650ii: { vendorId: 0x0519, productId: 0x0007, name: 'Star TSP650II' },
        tsp143iii: { vendorId: 0x0519, productId: 0x0015, name: 'Star TSP143III' }
    },
    citizen: {
        // Citizen CT-S series
        ct_s310a: { vendorId: 0x1d90, productId: 0x2037, name: 'Citizen CT-S310A' },
        ct_s4000: { vendorId: 0x1d90, productId: 0x2061, name: 'Citizen CT-S4000' }
    }
};

// Enhanced USB printer device creation
function createUSBPrinterDevice(brand, model, config) {
    return {
        vendorId: config.vendorId,
        productId: config.productId,
        productName: config.name,
        manufacturerName: brand.toUpperCase(),
        serialNumber: `SIM-${self.crypto.randomUUID().toUpperCase()}`,
        opened: false,
        // CRITICAL FIX: Add mocked configuration object
        configuration: {
            interfaces: [{
                alternate: {
                    endpoints: [{ direction: 'out', endpointNumber: 1 }]
                }
            }]
        },
        configurations: [{
            configurationValue: 1,
            interfaces: [{
                interfaceNumber: 0,
                alternates: [{
                    alternateSetting: 0,
                    interfaceClass: 7, // Printer class
                    interfaceSubclass: 1,
                    interfaceProtocol: 2, // Bidirectional
                    endpoints: [
                        { endpointNumber: 1, direction: 'out', type: 'bulk' },
                        { endpointNumber: 2, direction: 'in', type: 'bulk' }
                    ]
                }]
            }]
        }],

        open: async function() {
            console.log(`[USB] Opening ${brand} ${model} printer`);
            this.opened = true;
            return Promise.resolve();
        },

        close: async function() {
            console.log(`[USB] Closing ${brand} ${model} printer`);
            this.opened = false;
            return Promise.resolve();
        },

        selectConfiguration: async function(configValue) {
            console.log(`[USB] Selecting configuration ${configValue}`);
            return Promise.resolve();
        },

        claimInterface: async function(interfaceNumber) {
            console.log(`[USB] Claiming interface ${interfaceNumber}`);
            return Promise.resolve();
        },

        transferOut: async function(endpointNumber, data) {
            console.log(`[USB] ${brand} printer receiving ${data.byteLength} bytes on endpoint ${endpointNumber}`);

            const payloadArray = bufferSourceToByteArray(data);
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webusb',
                deviceType: 'printer',
                model: model,
                payload: payloadArray,
                connectionType: 'usb'
            }, '*');

            return Promise.resolve({
                status: 'ok',
                bytesWritten: data.byteLength
            });
        },

        transferIn: async function(endpointNumber, length) {
            console.log(`[USB] ${brand} printer status request on endpoint ${endpointNumber}`);
            // Return printer status (online, no errors)
            const statusData = new Uint8Array([0x12, 0x00, 0x00, 0x00]); // Online status
            return Promise.resolve({
                status: 'ok',
                data: new DataView(statusData.buffer)
            });
        }
    };
}

    const devices = {
        // Existing devices...
        // Scale devices
        mettlerScale: createUSBScaleDevice('mettlerToledo', scaleDevices.mettlerToledo),
        detectoScale: createUSBScaleDevice('detecto', scaleDevices.detecto),
        serialScale: createUSBScaleDevice('serialScale', scaleDevices.serialScale),

        // Add drawer devices
        usbDrawer: createUSBDrawerDevice('usbDrawer', drawerDevices.usbDrawer),
        serialDrawer: createUSBDrawerDevice('serialDrawer', drawerDevices.serialDrawer),

        // Line display
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

    // Update USB device mapping
    const scaleUSBDevices = new Map([
        [0x0eb8, devices.mettlerScale], // Mettler Toledo
        [0x1a86, devices.detectoScale], // Detecto
        [0x10C4, devices.serialScale]   // Generic serial scale
    ]);

    // Update USB device mapping to include drawers
    const drawerUSBDevices = new Map([
        [0x04d9, devices.usbDrawer], // APG Cash Drawer
        [0x0403, devices.serialDrawer] // FTDI Serial Drawer
    ]);

    // Enhanced WebUSB device enumeration
    navigator.usb.requestDevice = async (options) => {
        console.log('[USB] Printer device requested with filters:', options);

        if (options && options.filters) {
            for (const filter of options.filters) {
                // Check for printers
                for (const [brand, models] of Object.entries(printerUSBDevices)) {
                    for (const [model, config] of Object.entries(models)) {
                        if (filter.vendorId === config.vendorId &&
                            (!filter.productId || filter.productId === config.productId)) {
                            console.log(`[USB] Returning ${brand} ${model} printer`);
                            return Promise.resolve(createUSBPrinterDevice(brand, model, config));
                        }
                    }
                }

                // Check for cash drawers
                if (drawerUSBDevices.has(filter.vendorId)) {
                    const drawer = drawerUSBDevices.get(filter.vendorId);
                    console.log(`[Interceptor] Cash Drawer detected. Returning virtual drawer device.`);
                    return Promise.resolve(drawer);
                }

                // Check for scales
                if (scaleUSBDevices.has(filter.vendorId)) {
                    const scale = scaleUSBDevices.get(filter.vendorId);
                    console.log(`[Interceptor] Scale detected. Returning virtual scale device.`);
                    return Promise.resolve(scale);
                }

                // Line display detection
                if (filter.vendorId === devices.lineDisplay.vendorId) {
                    console.log('[Interceptor] Line Display requested. Returning virtual line display.');
                    return Promise.resolve(devices.lineDisplay);
                }
            }
        }

        if (!options?.filters?.length) {
            // Return default printer if no filters
            console.log('[USB] No filters provided, returning default Epson printer.');
            return Promise.resolve(createUSBPrinterDevice('epson', 'tm_t88vi', printerUSBDevices.epson.tm_t88vi));
        }

        throw new Error('No matching device found for filters: ' + JSON.stringify(options.filters));
    };

    navigator.usb.getDevices = async () => {
        console.log('[USB] Enumerating available printer devices');
        const allDevices = [];

        // Add all printer models
        for (const [brand, models] of Object.entries(printerUSBDevices)) {
            for (const [model, config] of Object.entries(models)) {
                allDevices.push(createUSBPrinterDevice(brand, model, config));
            }
        }

        // Add other USB devices
        allDevices.push(...scaleUSBDevices.values());
        allDevices.push(...drawerUSBDevices.values());
        allDevices.push(devices.lineDisplay);

        return Promise.resolve(allDevices);
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

    // Serial printer port implementation
function createSerialPrinterPort(brand, model, config) {
    return {
        getInfo: () => ({
            usbVendorId: config.vendorId,
            usbProductId: config.productId,
            bluetoothServiceClassId: undefined
        }),

        opened: false,
        readable: null,
        writable: null,

        open: async function(options = {}) {
            console.log(`[Serial] Opening ${brand} ${model} on COM port`);
            console.log('[Serial] Port options:', options);

            this.opened = true;

            // Create writable stream for ESC/POS commands
            this.writable = new WritableStream({
                write: (chunk) => {
                    console.log(`[Serial] ${brand} printer receiving ${chunk.byteLength} bytes`);

                    const payloadArray = bufferSourceToByteArray(chunk);
                    window.postMessage({
                        type: 'POS_SIMULATOR_RAW_DATA',
                        source: 'webserial',
                        deviceType: 'printer',
                        model: model,
                        payload: payloadArray,
                        connectionType: 'serial'
                    }, '*');
                },

                close: () => {
                    console.log(`[Serial] ${brand} printer write stream closed`);
                }
            });

            // Create readable stream for printer status
            this.readable = new ReadableStream({
                start: (controller) => {
                    console.log(`[Serial] ${brand} printer readable stream started`);

                    // Send initial ready status
                    setTimeout(() => {
                        const readyStatus = new Uint8Array([0x16]); // SYN - printer ready
                        controller.enqueue(readyStatus);
                    }, 100);

                    // Periodic status updates
                    this.statusInterval = setInterval(() => {
                        if (this.opened) {
                            const status = new Uint8Array([0x12, 0x00, 0x00, 0x00]); // Online, no errors
                            try {
                                controller.enqueue(status);
                            } catch (e) {
                                clearInterval(this.statusInterval);
                            }
                        }
                    }, 5000);
                }
            });

            return Promise.resolve();
        },

        close: async function() {
            console.log(`[Serial] Closing ${brand} ${model}`);
            this.opened = false;
            if (this.statusInterval) {
                clearInterval(this.statusInterval);
            }
            return Promise.resolve();
        }
    };
}

// Serial port enumeration
const serialPrinterPorts = {
    epson_tm_t88vi: createSerialPrinterPort('epson', 'TM-T88VI', { vendorId: 0x04b8, productId: 0x0202 }),
    star_tsp100: createSerialPrinterPort('star', 'TSP100', { vendorId: 0x0519, productId: 0x0003 }),
    citizen_cts310: createSerialPrinterPort('citizen', 'CT-S310', { vendorId: 0x1d90, productId: 0x2037 })
};

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

    // Enhanced WebSerial port enumeration
    navigator.serial.requestPort = async (options) => {
        console.log('[Serial] Printer port requested:', options);

        if (!options?.filters?.length) {
            return Promise.resolve(serialPrinterPorts.epson_tm_t88vi);
        }

        for (const filter of options.filters) {
            for (const [key, port] of Object.entries(serialPrinterPorts)) {
                const info = port.getInfo();
                if (filter.usbVendorId === info.usbVendorId &&
                    (!filter.usbProductId || filter.usbProductId === info.usbProductId)) {
                    console.log(`[Serial] Returning ${key} printer port`);
                    return Promise.resolve(port);
                }
            }
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

        throw new Error('No matching serial printer found');
    };

    navigator.serial.getPorts = async () => {
        console.log('[Serial] Enumerating available printer ports');
        const existingPorts = [enhancedFakeSerialPort, fakeSerialScalePort];
        const printerPorts = Object.values(serialPrinterPorts);
        return Promise.resolve([...existingPorts, ...printerPorts]);
    };

    // Simulate device connection events
    setTimeout(() => {
        if (navigator.serial.addEventListener) {
            const connectEvent = new Event('connect');
            connectEvent.port = enhancedFakeSerialPort;
            navigator.serial.dispatchEvent(connectEvent);
        }
    }, 2000);

// Enhanced Bluetooth Printer Implementation
// Enhanced Bluetooth printer with proper service UUIDs
const bluetoothPrinterServices = {
    // Standard Bluetooth printer service UUIDs
    PRINT_SERVICE: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    WRITE_CHARACTERISTIC: '49535343-8841-43f4-a8d4-ecbe34729bb3',
    NOTIFY_CHARACTERISTIC: '49535343-1e4d-4bd9-ba61-23c647249616'
};

function createBluetoothPrinterDevice(brand, model) {
    const device = {
        id: `bt_${brand}_${model}_${self.crypto.randomUUID()}`,
        name: `${brand.toUpperCase()} ${model}`,
        gatt: null
    };

    const writeCharacteristic = {
        uuid: bluetoothPrinterServices.WRITE_CHARACTERISTIC,
        properties: {
            write: true,
            writeWithoutResponse: true,
            read: false,
            notify: false
        },

        writeValue: async function(value) {
            console.log(`[Bluetooth] ${brand} printer receiving ${value.byteLength} bytes`);

            const payloadArray = bufferSourceToByteArray(value);
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'webbluetooth',
                deviceType: 'printer',
                model: model,
                payload: payloadArray,
                connectionType: 'bluetooth'
            }, '*');

            return Promise.resolve();
        },

        writeValueWithResponse: async function(value) {
            await this.writeValue(value);
            return Promise.resolve();
        },

        writeValueWithoutResponse: async function(value) {
            return this.writeValue(value);
        }
    };

    const printService = {
        uuid: bluetoothPrinterServices.PRINT_SERVICE,

        getCharacteristic: async function(uuid) {
            if (uuid === bluetoothPrinterServices.WRITE_CHARACTERISTIC) {
                return Promise.resolve(writeCharacteristic);
            }
            throw new Error('Characteristic not found');
        },

        getCharacteristics: async function() {
            return Promise.resolve([writeCharacteristic]);
        }
    };

    device.gatt = {
        device: device,
        connected: false,

        connect: async function() {
            console.log(`[Bluetooth] Connecting to ${brand} ${model}`);
            this.connected = true;
            return Promise.resolve(this);
        },

        disconnect: function() {
            console.log(`[Bluetooth] Disconnecting from ${brand} ${model}`);
            this.connected = false;
        },

        getPrimaryService: async function(serviceUuid) {
            console.log(`[Bluetooth] Service requested: ${serviceUuid}`);
            // For compatibility, we'll return the print service even if the UUID doesn't match.
            // This handles cases where the POS might be using a proprietary or different standard UUID.
            if (serviceUuid !== bluetoothPrinterServices.PRINT_SERVICE) {
                console.warn(`[Bluetooth] Non-standard service UUID detected. Expected ${bluetoothPrinterServices.PRINT_SERVICE}.`);
            }
            return Promise.resolve(printService);
        }
    };

    return device;
}

// Enhanced WebBluetooth device enumeration
navigator.bluetooth.requestDevice = async (options) => {
    console.log('[Bluetooth] Printer device requested:', options);

    // Check if requesting printer services
    const printerServiceRequested = options?.filters?.some(filter =>
        filter.services?.includes(bluetoothPrinterServices.PRINT_SERVICE)
    ) || options?.optionalServices?.includes(bluetoothPrinterServices.PRINT_SERVICE);

    if (printerServiceRequested || options?.acceptAllDevices) {
        return Promise.resolve(createBluetoothPrinterDevice('epson', 'TM-T88VI'));
    }

    throw new Error('No matching Bluetooth printer found');
};

    // Enhanced network printer interception
const networkPrinterEndpoints = [
    '/api/printer',
    '/api/print',
    '/api/proxy_printer.php',
    '/printer/print',
    '/pos/printer',
    '/escpos/print'
];

// Network printer protocols
const networkProtocols = {
    // Raw TCP socket printing (common for network printers)
    RAW_TCP: 9100,
    // HTTP-based printing
    HTTP: 80,
    HTTPS: 443,
    // IPP (Internet Printing Protocol)
    IPP: 631
};

// Enhanced fetch interception for network printers
const originalFetch = window.fetch;
window.fetch = async function(resource, config = {}) {
    let url = '';
    let requestObj = null;

    if (resource instanceof Request) {
        url = resource.url;
        requestObj = resource;
    } else {
        url = resource;
    }

    // Check if this is a printer-related network call
    const isPrinterCall = networkPrinterEndpoints.some(endpoint => url.includes(endpoint));

    if (isPrinterCall) {
        console.log(`[Network] Intercepted printer call to: ${url}`);
        console.log('[Network] Request config:', config);

        let payload = '';
        let contentType = 'application/octet-stream';

        const getHeader = (name) => {
            const lowerName = name.toLowerCase();
            if (requestObj && requestObj.headers) {
                return requestObj.headers.get(name);
            }
            if (config.headers) {
                if (typeof config.headers.get === 'function') {
                    return config.headers.get(name);
                }
                const key = Object.keys(config.headers).find(k => k.toLowerCase() === lowerName);
                return key ? config.headers[key] : null;
            }
            return null;
        };

        let bodyData = requestObj ? await requestObj.clone().arrayBuffer() : config.body;

        // Broadcast print job to extension
        window.postMessage({
            type: 'POS_SIMULATOR_RAW_DATA',
            source: 'network',
            deviceType: 'printer',
            connectionType: 'network',
            // BUG 1 FIX: Dynamically read the X-Printer-Brand header sent by printing.js.
            // Previously this was hardcoded to 'epson', scrambling Star/Citizen receipts.
            brand: (config.headers && config.headers['X-Printer-Brand'])
                ? config.headers['X-Printer-Brand'].toLowerCase()
                : 'epson',
            // CRITICAL FIX: Convert Uint8Array to standard Array for MV3 port transport
            payload: bufferSourceToByteArray(config.body),
            contentType: typeof config.body === 'string' ? 'text/xml' : 'application/octet-stream'
        }, '*');

        // Return appropriate success response
        const responseData = JSON.stringify({
            status: 'success',
            message: 'Print job accepted',
            jobId: self.crypto.randomUUID()
        });

        return Promise.resolve(new Response(responseData, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'application/json',
                'X-Printer-Status': 'online'
            }
        }));
    }

        // Check for drawer commands via network
        if (url.includes('/api/drawer.php') || url.includes('drawer') || url.includes('cash')) {
            console.log(`[Interceptor] Intercepted drawer network call to: ${url}`);

            // Send drawer command
            window.postMessage({
                type: 'POS_SIMULATOR_RAW_DATA',
                source: 'network',
                deviceType: 'cash-drawer',
                command: 'open',
                payload: config.body ? bufferSourceToByteArray(config.body) : []
            }, '*');

            return Promise.resolve(new Response('{"status":"ok","drawer":"opened"}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }));
        }

    // For non-printer calls, use original fetch
    return originalFetch.apply(this, arguments);
};


    console.log('[interceptor.js] All APIs intercepted.');
})();
