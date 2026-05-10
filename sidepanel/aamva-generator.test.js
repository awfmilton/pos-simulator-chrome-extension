const AAMVAGenerator = require('./aamva-generator');

describe('AAMVAGenerator', () => {
    let generator;

    beforeEach(() => {
        generator = new AAMVAGenerator();
    });

    test('should initialize with standard data', () => {
        expect(generator.data).toBeDefined();
        expect(generator.data.states.length).toBeGreaterThan(0);
    });

    test('should generate a barcode string', () => {
        const barcode = generator.generate();
        expect(typeof barcode).toBe('string');
        expect(barcode.length).toBeGreaterThan(100);
    });

    test('should generate a Drivers License specifically', () => {
        const barcode = generator.generateDriversLicense();
        expect(barcode.includes('DL\r')).toBe(true);
    });

    test('should generate an ID Card specifically', () => {
        const barcode = generator.generateIDCard();
        expect(barcode.includes('ID\r')).toBe(true);
    });

    test('should generate a valid AAMVA Header format', () => {
        const barcode = generator.generate();
        // Header: @[RS]ANSI [IIN][Version][Jurisdiction Version][Number of Entries][CR]
        // Which means starting with @\x1eANSI
        expect(barcode.startsWith('@\x1eANSI ')).toBe(true);

        // After "ANSI ", there should be exactly 6 (IIN) + 2 (Version) + 2 (Jur Vers) + 2 (Num Entries) = 12 characters, then a carriage return (\r).
        const match = barcode.match(/^@\x1eANSI\s(\d{6})(\d{2})(\d{2})(\d{2})\r/);
        expect(match).not.toBeNull();
        expect(match[2]).toBe('08'); // AAMVA Version
        expect(match[3]).toBe('00'); // Jurisdiction Version
        expect(match[4]).toBe('01'); // Number of entries
    });

    test('should correctly compute exact age using generate(cardType, age)', () => {
        const age = 30;
        const barcode = generator.generate(null, age);

        // Find Date of Birth element: DBB
        const dbbMatch = barcode.match(/DBB(\d{8})\r/);
        expect(dbbMatch).not.toBeNull();

        const dbbStr = dbbMatch[1]; // MMDDYYYY
        const mm = parseInt(dbbStr.slice(0, 2), 10);
        const dd = parseInt(dbbStr.slice(2, 4), 10);
        const yyyy = parseInt(dbbStr.slice(4, 8), 10);

        const now = new Date();
        const expectedYear = now.getFullYear() - age;

        expect(yyyy).toBe(expectedYear);
        expect(mm).toBe(now.getMonth() + 1);
        expect(dd).toBe(now.getDate());
    });

    test('should separate data elements with carriage return (\\r)', () => {
        const barcode = generator.generate();

        // Subfile designator is followed by \r, and the subfile itself ends with \r.
        // It's structured as:
        // Header...[CR]LengthSubfileDesignator[CR]DataElements[CR]
        // Since we checked Header earlier:
        const subfileSplit = barcode.split('\r');

        // At least header, designator, and many elements should yield many parts
        expect(subfileSplit.length).toBeGreaterThan(20); // 22 data elements + headers/designators

        // Subfile designator check
        expect(barcode).toMatch(/(DL|ID)\rDAC[A-Z]+/);
    });
});