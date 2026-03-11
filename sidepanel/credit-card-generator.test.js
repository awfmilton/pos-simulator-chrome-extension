const CreditCardGenerator = require('./credit-card-generator');

describe('CreditCardGenerator', () => {
    let generator;

    beforeEach(() => {
        generator = new CreditCardGenerator();
    });

    describe('generateCardNumber', () => {
        it('should generate a valid card number for all providers', () => {
            const providers = Object.keys(generator.providers);
            providers.forEach(provider => {
                const cardNumber = generator.generateCardNumber(provider);
                expect(generator.validateCardNumber(cardNumber)).toBe(true);
            });
        });

        it('should throw error for unknown provider', () => {
            expect(() => generator.generateCardNumber('invalid')).toThrow('Unknown card provider: invalid');
        });

        it('should return a test card number if available', () => {
            const visaCard = generator.generateCardNumber('visa');
            expect(generator.testCardNumbers.visa).toContain(visaCard);
        });

        it('should generate a new number for providers without test numbers', () => {
            // UnionPay has no test numbers in current implementation
            const unionPayCard = generator.generateCardNumber('unionpay');
            expect(generator.validateCardNumber(unionPayCard)).toBe(true);
            expect(unionPayCard.startsWith('62')).toBe(true);
        });
    });

    describe('validateCardNumber', () => {
        it('should return true for valid Luhn numbers', () => {
            expect(generator.validateCardNumber('4111111111111111')).toBe(true);
            expect(generator.validateCardNumber('4012888888881881')).toBe(true);
        });

        it('should return false for invalid Luhn numbers', () => {
            expect(generator.validateCardNumber('4111111111111112')).toBe(false);
        });

        it('should return false for short numbers', () => {
            expect(generator.validateCardNumber('123')).toBe(false);
        });

        it('should return false for null or empty input', () => {
            expect(generator.validateCardNumber(null)).toBe(false);
            expect(generator.validateCardNumber('')).toBe(false);
        });
    });

    describe('detectCardProvider', () => {
        it('should detect Visa', () => {
            expect(generator.detectCardProvider('4111111111111111')).toBe('visa');
        });

        it('should detect MasterCard', () => {
            expect(generator.detectCardProvider('5100000000000000')).toBe('mastercard');
            expect(generator.detectCardProvider('2221000000000000')).toBe('mastercard');
        });

        it('should detect Amex', () => {
            expect(generator.detectCardProvider('340000000000000')).toBe('amex');
            expect(generator.detectCardProvider('370000000000000')).toBe('amex');
        });

        it('should detect Discover', () => {
            expect(generator.detectCardProvider('6011000000000000')).toBe('discover');
            expect(generator.detectCardProvider('6500000000000000')).toBe('discover');
        });

        it('should detect JCB', () => {
            expect(generator.detectCardProvider('3528000000000000')).toBe('jcb');
        });

        it('should detect Diners Club', () => {
            expect(generator.detectCardProvider('30000000000000')).toBe('dinersclub');
            expect(generator.detectCardProvider('36000000000000')).toBe('dinersclub');
        });

        it('should detect UnionPay', () => {
            expect(generator.detectCardProvider('6200000000000000')).toBe('unionpay');
        });

        it('should return unknown for unrecognized numbers', () => {
            expect(generator.detectCardProvider('9999999999999999')).toBe('unknown');
        });
    });

    describe('generateCVV', () => {
        it('should generate 3 digits for Visa', () => {
            const cvv = generator.generateCVV('visa');
            expect(cvv).toMatch(/^\d{3}$/);
        });

        it('should generate 4 digits for Amex', () => {
            const cvv = generator.generateCVV('amex');
            expect(cvv).toMatch(/^\d{4}$/);
        });

        it('should default to 3 digits for unknown provider', () => {
            const cvv = generator.generateCVV('unknown');
            expect(cvv).toMatch(/^\d{3}$/);
        });
    });

    describe('generateExpirationDate', () => {
        it('should return an object with correct fields', () => {
            const exp = generator.generateExpirationDate();
            expect(exp).toHaveProperty('month');
            expect(exp).toHaveProperty('year');
            expect(exp).toHaveProperty('fullYear');

            expect(exp.month).toMatch(/^(0[1-9]|1[0-2])$/);
            expect(exp.year).toMatch(/^\d{2}$/);
            expect(exp.fullYear).toMatch(/^\d{4}$/);
        });

        it('should be in the future', () => {
            const exp = generator.generateExpirationDate();
            const currentYear = new Date().getFullYear();
            expect(parseInt(exp.fullYear)).toBeGreaterThanOrEqual(currentYear + 1);
        });
    });

    describe('generateCardholderName', () => {
        it('should return a string with first and last name', () => {
            const name = generator.generateCardholderName();
            expect(typeof name).toBe('string');
            expect(name.split(' ').length).toBe(2);
        });
    });

    describe('generateCard', () => {
        it('should generate a complete card object', () => {
            const card = generator.generateCard('visa');
            expect(card.provider).toBe('visa');
            expect(card.providerName).toBe('Visa');
            expect(card.number).toBeDefined();
            expect(card.formattedNumber).toBeDefined();
            expect(card.cvv).toBeDefined();
            expect(card.expirationMonth).toBeDefined();
            expect(card.expirationYear).toBeDefined();
            expect(card.expirationFullYear).toBeDefined();
            expect(card.cardholderName).toBeDefined();
            expect(card.track1).toBeDefined();
            expect(card.track2).toBeDefined();
        });

        it('should generate a card for a random provider if none specified', () => {
            const card = generator.generateCard();
            expect(card.provider).toBeDefined();
            expect(Object.keys(generator.providers)).toContain(card.provider);
        });
    });

    describe('formatCardNumber', () => {
        it('should add spaces every 4 digits', () => {
            expect(generator.formatCardNumber('1234567812345678')).toBe('1234 5678 1234 5678');
            expect(generator.formatCardNumber('1234567812345')).toBe('1234 5678 1234 5');
        });
    });

    describe('generateTrack1', () => {
        it('should generate a valid Track 1 string', () => {
            const expiration = { year: '25', month: '12' };
            const track1 = generator.generateTrack1('4111111111111111', 'JOHN DOE', expiration);
            expect(track1).toBe('%B4111111111111111^JOHN DOE^2512101000100000000000000000?');
        });
    });

    describe('generateTrack2', () => {
        it('should generate a valid Track 2 string', () => {
            const expiration = { year: '25', month: '12' };
            const track2 = generator.generateTrack2('4111111111111111', expiration);
            expect(track2).toBe(';4111111111111111=251210100010000000?');
        });
    });
});
