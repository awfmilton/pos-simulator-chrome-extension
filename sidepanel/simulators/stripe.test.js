describe('Stripe Simulator', () => {
    let stripeSimulator;

    beforeEach(() => {
        // Mock global scope and helpers
        global.window = {};

        global.window.TerminalSimulatorHelpers = {
            uid: (prefix, len) => `${prefix}mock_uid_12345678901234567890`.substring(0, prefix.length + len),
            numStr: (len) => '1234567890'.substring(0, len),
            amountCents: (req) => Math.round(parseFloat(req.amount) * 100),
            partialCents: (req, partialPercent) => Math.round((parseFloat(req.amount) * 100) * partialPercent / 100)
        };

        global.window.TerminalSimulatorDebug = false;

        global.window.TerminalSimulators = {};

        // Mock document object for updateUI
        global.document = {
            getElementById: jest.fn().mockReturnValue({ style: { display: '' } })
        };

        // Mock Date.now() for deterministic created timestamp
        jest.spyOn(global.Date, 'now').mockImplementation(() => 1600000000000);

        // Require the stripe simulator
        // Since it's an IIFE that attaches to window.TerminalSimulators, we need to load it
        // But since it's a browser script, we read it and evaluate it in the context
        const fs = require('fs');
        const path = require('path');
        const stripeScript = fs.readFileSync(path.join(__dirname, 'stripe.js'), 'utf8');
        eval(stripeScript);

        stripeSimulator = global.window.TerminalSimulators.stripe;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('updateUI', () => {
        it('should show the row when true', () => {
            const mockRow = { style: { display: 'none' } };
            global.document.getElementById.mockReturnValue(mockRow);

            stripeSimulator.updateUI(true);

            expect(global.document.getElementById).toHaveBeenCalledWith('stripe-card-row');
            expect(mockRow.style.display).toBe('');
        });

        it('should hide the row when false', () => {
            const mockRow = { style: { display: '' } };
            global.document.getElementById.mockReturnValue(mockRow);

            stripeSimulator.updateUI(false);

            expect(global.document.getElementById).toHaveBeenCalledWith('stripe-card-row');
            expect(mockRow.style.display).toBe('none');
        });

        it('should not throw if row is not found', () => {
            global.document.getElementById.mockReturnValue(null);

            expect(() => {
                stripeSimulator.updateUI(true);
            }).not.toThrow();
        });
    });

    describe('buildPayload', () => {
        const baseReq = { amount: '10.50', currency: 'CAD' };

        it('should return approved payload', () => {
            const result = stripeSimulator.buildPayload('approved', 'insert', baseReq, 0);

            expect(result.object).toBe('payment_intent');
            expect(result.status).toBe('succeeded');
            expect(result.amount).toBe(1050);
            expect(result.amount_received).toBe(1050);
            expect(result.currency).toBe('cad');
            expect(result.latest_charge.amount).toBe(1050);
            expect(result.latest_charge.amount_captured).toBe(1050);
            expect(result.latest_charge.payment_method_details.card_present.read_method).toBe('contact_emv');
            expect(result.latest_charge.partial_authorization).toBeNull();
            expect(result.created).toBe(1600000000);
        });

        it('should return partial_auth payload', () => {
            const result = stripeSimulator.buildPayload('partial_auth', 'swipe', baseReq, 50);

            expect(result.object).toBe('payment_intent');
            expect(result.status).toBe('requires_capture');
            expect(result.amount).toBe(1050);
            expect(result.amount_received).toBe(525);
            expect(result.latest_charge.amount).toBe(1050);
            expect(result.latest_charge.amount_captured).toBe(525);
            expect(result.latest_charge.payment_method_details.card_present.read_method).toBe('magnetic_stripe_fallback');
            expect(result.latest_charge.partial_authorization).toEqual({
                status: 'partially_authorized',
                amount_requested: 1050,
                amount_authorized: 525
            });
        });

        it('should use tap (contactless_emv) for read_method', () => {
            const result = stripeSimulator.buildPayload('approved', 'tap', baseReq, 0);
            expect(result.latest_charge.payment_method_details.card_present.read_method).toBe('contactless_emv');
        });

        describe('Decline conditions', () => {
            it('should return decline payload for generic decline', () => {
                const result = stripeSimulator.buildPayload('declined', 'generic', baseReq, 0);

                expect(result.object).toBe('payment_intent');
                expect(result.status).toBe('requires_payment_method');
                expect(result.last_payment_error.code).toBe('card_declined');
                expect(result.last_payment_error.decline_code).toBe('generic_decline');
                expect(result.last_payment_error.message).toBe('Your card was declined.');
            });

            it('should return decline payload for nsf', () => {
                const result = stripeSimulator.buildPayload('declined', 'nsf', baseReq, 0);

                expect(result.last_payment_error.code).toBe('card_declined');
                expect(result.last_payment_error.decline_code).toBe('insufficient_funds');
                expect(result.last_payment_error.message).toBe('Your card has insufficient funds.');
            });

            it('should return decline payload for stolen', () => {
                const result = stripeSimulator.buildPayload('declined', 'stolen', baseReq, 0);

                expect(result.last_payment_error.code).toBe('card_declined');
                expect(result.last_payment_error.decline_code).toBe('stolen_card');
                expect(result.last_payment_error.message).toBe('Your card has been declined.');
            });

            it('should return decline payload for expired', () => {
                const result = stripeSimulator.buildPayload('declined', 'expired', baseReq, 0);

                expect(result.last_payment_error.code).toBe('expired_card');
                expect(result.last_payment_error.decline_code).toBe('expired_card');
                expect(result.last_payment_error.message).toBe('Your card has expired.');
            });

            it('should return decline payload for cvc', () => {
                const result = stripeSimulator.buildPayload('declined', 'cvc', baseReq, 0);

                expect(result.last_payment_error.code).toBe('incorrect_cvc');
                expect(result.last_payment_error.decline_code).toBe('incorrect_cvc');
                expect(result.last_payment_error.message).toBe("Your card's security code is incorrect.");
            });

            it('should return decline payload for processing_error', () => {
                const result = stripeSimulator.buildPayload('declined', 'processing_error', baseReq, 0);

                expect(result.last_payment_error.code).toBe('processing_error');
                expect(result.last_payment_error.decline_code).toBe('processing_error');
                expect(result.last_payment_error.message).toBe('An error occurred while processing your card.');
            });

            it('should return timeout payload', () => {
                const result = stripeSimulator.buildPayload('timeout', 'timeout', baseReq, 0);

                expect(result.status).toBe('canceled');
                expect(result.last_payment_error.code).toBe('payment_intent_timeout');
                expect(result.last_payment_error.decline_code).toBeNull();
                expect(result.last_payment_error.message).toBe('The operation timed out.');
            });
        });

        describe('Debug mode', () => {
            it('should log correctly when debug is true', () => {
                global.window.TerminalSimulatorDebug = true;
                const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                stripeSimulator.buildPayload('approved', 'insert', baseReq, 0);

                expect(consoleSpy).toHaveBeenCalledTimes(2);
                expect(consoleSpy).toHaveBeenNthCalledWith(1, '[TerminalSim][Stripe] buildPayload called', expect.any(Object));
                expect(consoleSpy).toHaveBeenNthCalledWith(2, '[TerminalSim][Stripe] Approved payload built', expect.any(Object));

                consoleSpy.mockClear();

                stripeSimulator.buildPayload('declined', 'nsf', baseReq, 0);

                expect(consoleSpy).toHaveBeenCalledTimes(2);
                expect(consoleSpy).toHaveBeenNthCalledWith(1, '[TerminalSim][Stripe] buildPayload called', expect.any(Object));
                expect(consoleSpy).toHaveBeenNthCalledWith(2, '[TerminalSim][Stripe] Decline payload built', expect.any(Object));
            });
        });
    });
});
