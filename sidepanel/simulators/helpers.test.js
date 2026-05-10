beforeEach(() => {
    global.window = {};
});

describe('TerminalSimulatorHelpers', () => {
    let helpers;

    beforeEach(() => {
        // Clear module cache to re-evaluate the IIFE
        jest.resetModules();
        require('./helpers.js');
        helpers = window.TerminalSimulatorHelpers;
    });

    it('should be defined', () => {
        expect(helpers).toBeDefined();
    });

    describe('amountCents', () => {
        it('should correctly convert a standard dollar string to cents', () => {
            expect(helpers.amountCents({ amount: '10.50' })).toBe(1050);
            expect(helpers.amountCents({ amount: '9.99' })).toBe(999);
            expect(helpers.amountCents({ amount: '0.01' })).toBe(1);
        });

        it('should correctly convert a standard number to cents', () => {
            expect(helpers.amountCents({ amount: 10.50 })).toBe(1050);
            expect(helpers.amountCents({ amount: 9.99 })).toBe(999);
            expect(helpers.amountCents({ amount: 0.01 })).toBe(1);
        });

        it('should handle zero values correctly', () => {
            expect(helpers.amountCents({ amount: 0 })).toBe(0);
            expect(helpers.amountCents({ amount: '0' })).toBe(0);
            expect(helpers.amountCents({ amount: '0.00' })).toBe(0);
        });

        it('should return NaN for undefined or missing amount', () => {
            expect(helpers.amountCents({})).toBeNaN();
            expect(helpers.amountCents({ amount: undefined })).toBeNaN();
            expect(helpers.amountCents({ amount: null })).toBeNaN();
        });

        it('should correctly handle integer strings without decimals', () => {
            expect(helpers.amountCents({ amount: '42' })).toBe(4200);
            expect(helpers.amountCents({ amount: '100' })).toBe(10000);
        });

        it('should handle negative amounts correctly', () => {
            expect(helpers.amountCents({ amount: '-5.25' })).toBe(-525);
            expect(helpers.amountCents({ amount: -5.25 })).toBe(-525);
        });

        it('should handle floating point precision issues correctly', () => {
            // E.g. parseFloat('1.13') * 100 in JS can sometimes be 112.99999999999999
            expect(helpers.amountCents({ amount: '1.13' })).toBe(113);
            expect(helpers.amountCents({ amount: 1.13 })).toBe(113);
        });
    });
});
