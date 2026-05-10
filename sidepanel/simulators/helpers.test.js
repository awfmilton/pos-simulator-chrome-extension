describe('TerminalSimulatorHelpers', () => {
    let TerminalSimulatorHelpers;

    beforeEach(() => {
        global.window = {};
        jest.resetModules();
        require('./helpers.js');
        TerminalSimulatorHelpers = global.window.TerminalSimulatorHelpers;
    });

    afterEach(() => {
        delete global.window;
    });

    describe('uid', () => {
        it('should generate a string with the correct prefix and length', () => {
            const result = TerminalSimulatorHelpers.uid('prefix_', 10);
            expect(result.startsWith('prefix_')).toBe(true);
            expect(result.length).toBe(7 + 10); // 'prefix_'.length + 10
        });

        it('should use only allowed characters in the suffix', () => {
            const result = TerminalSimulatorHelpers.uid('', 100);
            expect(/^[a-z0-9]+$/.test(result)).toBe(true);
        });
    });

    describe('numStr', () => {
        it('should generate a numeric string of exact length', () => {
            const result = TerminalSimulatorHelpers.numStr(15);
            expect(typeof result).toBe('string');
            expect(result.length).toBe(15);
            expect(/^[0-9]+$/.test(result)).toBe(true);
        });

        it('should return empty string if length is 0', () => {
            const result = TerminalSimulatorHelpers.numStr(0);
            expect(result).toBe('');
        });
    });

    describe('amountCents', () => {
        it('should convert string dollar amount to integer cents', () => {
            const req = { amount: '12.34' };
            expect(TerminalSimulatorHelpers.amountCents(req)).toBe(1234);
        });

        it('should convert numeric dollar amount to integer cents', () => {
            const req = { amount: 12.34 };
            expect(TerminalSimulatorHelpers.amountCents(req)).toBe(1234);
        });

        it('should handle roundings correctly', () => {
            const req = { amount: '12.345' };
            expect(TerminalSimulatorHelpers.amountCents(req)).toBe(1235); // 12.345 * 100 = 1234.5 -> 1235
        });
    });

    describe('partialCents', () => {
        it('should compute partial auth amount in cents based on percentage', () => {
            const req = { amount: '100.00' };
            expect(TerminalSimulatorHelpers.partialCents(req, 70)).toBe(7000);
        });

        it('should handle rounding when computing partial cents', () => {
            const req = { amount: '10.00' }; // 1000 cents
            // 1000 * 33 / 100 = 330
            expect(TerminalSimulatorHelpers.partialCents(req, 33)).toBe(330);

            // 1000 * 33.3 / 100 = 333
            expect(TerminalSimulatorHelpers.partialCents(req, 33.3)).toBe(333);

            // Testing rounding up: 1000 * 33.35 / 100 = 333.5 -> 334
            expect(TerminalSimulatorHelpers.partialCents(req, 33.35)).toBe(334);
        });
    });
});
