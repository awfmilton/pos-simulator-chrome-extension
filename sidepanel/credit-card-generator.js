/*
Owned and Distributed by: tbay.tk LLC, MT, 59601
Developed by: Alexander Milton
Version: 2.1
Website: https://tbay.tk
License: personal use $5/month, business use $100/month
*/

// Credit Card Generator Module
// Generates valid test credit card numbers for POS testing

class CreditCardGenerator {
    constructor() {
        this.providers = {
            visa: {
                name: 'Visa',
                prefixes: ['4'],
                lengths: [13, 16, 19],
                cvvLength: 3,
                icon: '💳'
            },
            mastercard: {
                name: 'MasterCard',
                prefixes: ['51', '52', '53', '54', '55', '222100-272099'],
                lengths: [16],
                cvvLength: 3,
                icon: '💳'
            },
            amex: {
                name: 'American Express',
                prefixes: ['34', '37'],
                lengths: [15],
                cvvLength: 4,
                icon: '💳'
            },
            discover: {
                name: 'Discover',
                prefixes: ['6011', '622126-622925', '644', '645', '646', '647', '648', '649', '65'],
                lengths: [16, 19],
                cvvLength: 3,
                icon: '💳'
            },
            jcb: {
                name: 'JCB',
                prefixes: ['3528-3589'],
                lengths: [16],
                cvvLength: 3,
                icon: '💳'
            },
            dinersclub: {
                name: 'Diners Club',
                prefixes: ['300-305', '36', '38'],
                lengths: [14],
                cvvLength: 3,
                icon: '💳'
            },
            unionpay: {
                name: 'UnionPay',
                prefixes: ['62'],
                lengths: [16, 17, 18, 19],
                cvvLength: 3,
                icon: '💳'
            }
        };

        this.testCardNumbers = {
            visa: [
                '4111111111111111',
                '4012888888881881',
                '4222222222222',
                '4000000000000002'
            ],
            mastercard: [
                '5555555555554444',
                '5105105105105100',
                '5431111111111111',
                '2223003122003222'
            ],
            amex: [
                '378282246310005',
                '371449635398431',
                '378734493671000'
            ],
            discover: [
                '6011111111111117',
                '6011000990139424',
                '6011981111111113'
            ]
        };
    }

    // Generate a random valid credit card number
    generateCardNumber(provider) {
        const providerInfo = this.providers[provider];
        if (!providerInfo) {
            throw new Error(`Unknown card provider: ${provider}`);
        }

        // Use test card numbers for known providers
        if (this.testCardNumbers[provider]) {
            const testCards = this.testCardNumbers[provider];
            return testCards[Math.floor(Math.random() * testCards.length)];
        }

        // Generate new number for other providers
        const prefix = this.getRandomPrefix(providerInfo.prefixes);
        const length = providerInfo.lengths[Math.floor(Math.random() * providerInfo.lengths.length)];
        
        let cardNumber = prefix;
        
        // Fill remaining digits (except last one for checksum)
        while (cardNumber.length < length - 1) {
            cardNumber += Math.floor(Math.random() * 10).toString();
        }

        // Calculate and append Luhn checksum
        const checksum = this.calculateLuhnChecksum(cardNumber);
        cardNumber += checksum.toString();

        return cardNumber;
    }

    getRandomPrefix(prefixes) {
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        
        // Handle range prefixes like "222100-272099"
        if (prefix.includes('-')) {
            const [start, end] = prefix.split('-').map(Number);
            return (Math.floor(Math.random() * (end - start + 1)) + start).toString();
        }
        
        return prefix;
    }

    // Calculate Luhn algorithm checksum
    calculateLuhnChecksum(cardNumber) {
        const digits = cardNumber.split('').map(Number).reverse();
        let sum = 0;

        for (let i = 0; i < digits.length; i++) {
            let digit = digits[i];
            
            if (i % 2 === 1) { // Every second digit from right
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            
            sum += digit;
        }

        return (10 - (sum % 10)) % 10;
    }

    // Validate credit card number using Luhn algorithm
    validateCardNumber(cardNumber) {
        if (!cardNumber || cardNumber.length < 13) {
            return false;
        }

        const digits = cardNumber.split('').map(Number).reverse();
        let sum = 0;

        for (let i = 0; i < digits.length; i++) {
            let digit = digits[i];
            
            if (i % 2 === 1) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            
            sum += digit;
        }

        return sum % 10 === 0;
    }

    // Detect card provider from number
    detectCardProvider(cardNumber) {
        const cleanNumber = cardNumber.replace(/\D/g, '');
        
        for (const [provider, info] of Object.entries(this.providers)) {
            for (const prefix of info.prefixes) {
                if (prefix.includes('-')) {
                    const [start, end] = prefix.split('-').map(Number);
                    const cardPrefix = parseInt(cleanNumber.substring(0, start.toString().length));
                    if (cardPrefix >= start && cardPrefix <= end) {
                        return provider;
                    }
                } else {
                    if (cleanNumber.startsWith(prefix)) {
                        return provider;
                    }
                }
            }
        }
        
        return 'unknown';
    }

    // Generate CVV
    generateCVV(provider) {
        const providerInfo = this.providers[provider] || { cvvLength: 3 };
        const length = providerInfo.cvvLength;
        let cvv = '';
        
        for (let i = 0; i < length; i++) {
            cvv += Math.floor(Math.random() * 10).toString();
        }
        
        return cvv;
    }

    // Generate expiration date
    generateExpirationDate() {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
        
        // Generate date 1-5 years in the future
        const futureYears = Math.floor(Math.random() * 5) + 1;
        const expYear = currentYear + futureYears;
        const expMonth = Math.floor(Math.random() * 12) + 1;
        
        return {
            month: expMonth.toString().padStart(2, '0'),
            year: expYear.toString().slice(-2),
            fullYear: expYear.toString()
        };
    }

    // Generate cardholder name
    generateCardholderName() {
        const firstNames = [
            'JOHN', 'JANE', 'MICHAEL', 'SARAH', 'DAVID', 'EMILY', 'JAMES', 'JESSICA',
            'ROBERT', 'ASHLEY', 'WILLIAM', 'AMANDA', 'RICHARD', 'JENNIFER', 'JOSEPH', 'MELISSA'
        ];
        const lastNames = [
            'SMITH', 'JOHNSON', 'WILLIAMS', 'BROWN', 'JONES', 'GARCIA', 'MILLER', 'DAVIS',
            'RODRIGUEZ', 'MARTINEZ', 'HERNANDEZ', 'LOPEZ', 'GONZALEZ', 'WILSON', 'ANDERSON', 'TAYLOR'
        ];
        
        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
        
        return `${firstName} ${lastName}`;
    }

    // Generate complete card data
    generateCard(provider = null) {
        if (!provider) {
            const providers = Object.keys(this.providers);
            provider = providers[Math.floor(Math.random() * providers.length)];
        }

        const cardNumber = this.generateCardNumber(provider);
        const cvv = this.generateCVV(provider);
        const expiration = this.generateExpirationDate();
        const cardholderName = this.generateCardholderName();

        return {
            provider: provider,
            providerName: this.providers[provider].name,
            number: cardNumber,
            formattedNumber: this.formatCardNumber(cardNumber),
            cvv: cvv,
            expirationMonth: expiration.month,
            expirationYear: expiration.year,
            expirationFullYear: expiration.fullYear,
            cardholderName: cardholderName,
            track1: this.generateTrack1(cardNumber, cardholderName, expiration),
            track2: this.generateTrack2(cardNumber, expiration)
        };
    }

    // Format card number with spaces
    formatCardNumber(cardNumber) {
        return cardNumber.replace(/(.{4})/g, '$1 ').trim();
    }

    // Generate Track 1 data for MSR
    generateTrack1(cardNumber, name, expiration) {
        const servicCode = '101'; // Standard service code
        const discretionaryData = '000100000000000000000';
        return `%B${cardNumber}^${name}^${expiration.year}${expiration.month}${servicCode}${discretionaryData}?`;
    }

    // Generate Track 2 data for MSR
    generateTrack2(cardNumber, expiration) {
        const servicCode = '101';
        const discretionaryData = '00010000000';
        return `;${cardNumber}=${expiration.year}${expiration.month}${servicCode}${discretionaryData}?`;
    }

    // Generate cards for tap-to-pay simulation
    generateNFCData(provider = null) {
        const card = this.generateCard(provider);
        
        return {
            ...card,
            applicationId: this.generateApplicationId(card.provider),
            applicationLabel: this.providers[card.provider].name,
            transactionCounter: Math.floor(Math.random() * 65535),
            unpredictableNumber: Math.floor(Math.random() * 4294967295)
        };
    }

    generateApplicationId(provider) {
        const aids = {
            visa: 'A0000000031010',
            mastercard: 'A0000000041010', 
            amex: 'A000000025',
            discover: 'A0000001523010',
            jcb: 'A0000000651010',
            dinersclub: 'A0000001544442',
            unionpay: 'A000000333010100'
        };
        
        return aids[provider] || 'A0000000031010';
    }
}