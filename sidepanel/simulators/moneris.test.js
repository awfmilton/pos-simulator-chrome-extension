// Set up global mocks BEFORE requiring the modules
global.window = { TerminalSimulators: {} };

require('./helpers.js');
require('./moneris.js');

describe('Moneris Simulator', () => {
    let originalHelpers;
    let originalDocument;
    let originalWindow;
    let elements;

    beforeEach(() => {
        // Setup mock window environment
        originalHelpers = global.window.TerminalSimulatorHelpers;
        originalDocument = global.document;

        // Mock TerminalSimulatorHelpers
        global.window.TerminalSimulatorHelpers = {
            uid: jest.fn((prefix, len) => prefix + '12345678901234567890'.slice(0, len)),
            numStr: jest.fn((len) => '12345678901234567890'.slice(0, len)),
            amountCents: jest.fn((req) => Math.round(parseFloat(req.amount) * 100)),
            partialCents: jest.fn((req, percent) => Math.round(parseFloat(req.amount) * percent))
        };

        global.window.TerminalSimulators = global.window.TerminalSimulators || {};

        // Mock document and getElementById
        elements = {
            'moneris-display-section': { style: { display: '' } },
            'moneris-card-row': { style: { display: '' } },
            'moneris-credentials-section': { style: { display: '' } },
            'moneris-pairing-token': { textContent: '' }
        };

        global.document = {
            getElementById: jest.fn(id => elements[id] || null)
        };
    });

    afterEach(() => {
        // Restore original environment
        global.window.TerminalSimulatorHelpers = originalHelpers;
        global.document = originalDocument;
    });

    describe('updateUI', () => {
        it('should show all sections when show is true', () => {
            elements['moneris-display-section'].style.display = 'none';
            elements['moneris-card-row'].style.display = 'none';
            elements['moneris-credentials-section'].style.display = 'none';

            window.TerminalSimulators.moneris.updateUI(true);

            expect(elements['moneris-display-section'].style.display).toBe('');
            expect(elements['moneris-card-row'].style.display).toBe('');
            expect(elements['moneris-credentials-section'].style.display).toBe('');
        });

        it('should hide all sections when show is false', () => {
            window.TerminalSimulators.moneris.updateUI(false);

            expect(elements['moneris-display-section'].style.display).toBe('none');
            expect(elements['moneris-card-row'].style.display).toBe('none');
            expect(elements['moneris-credentials-section'].style.display).toBe('none');
        });

        it('should generate a pairing token on first display', () => {
            window.TerminalSimulators.moneris.updateUI(true);

            expect(elements['moneris-pairing-token'].textContent).toBeTruthy();
            expect(elements['moneris-pairing-token'].textContent.length).toBe(9);
            // Verify it only uses allowed characters
            expect(elements['moneris-pairing-token'].textContent).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{9}$/);
        });

        it('should not regenerate pairing token if one already exists', () => {
            elements['moneris-pairing-token'].textContent = 'EXISTING1';

            window.TerminalSimulators.moneris.updateUI(true);

            expect(elements['moneris-pairing-token'].textContent).toBe('EXISTING1');
        });

        it('should handle missing DOM elements gracefully', () => {
            global.document.getElementById.mockReturnValue(null);
            expect(() => {
                window.TerminalSimulators.moneris.updateUI(true);
            }).not.toThrow();
        });
    });

    describe('buildPayload', () => {
        it('should handle approved outcome', () => {
            const req = { amount: '15.00' };
            const payload = window.TerminalSimulators.moneris.buildPayload('approved', 'purchase', req, 100);

            expect(payload.ResponseCode).toBe('027');
            expect(payload.Message).toBe('APPROVED *');
            expect(payload.TransAmount).toBe('15.00');
            expect(payload.Complete).toBe('true');
            expect(payload.TimedOut).toBe('false');
            expect(payload.ApprovalCode).toBe('123456');
            expect(payload.iso_code).toBe('00');
            expect(payload.AvsResultCode).toBe('Y');
            expect(payload.CvdResultCode).toBe('1');
        });

        it('should handle partial_auth outcome', () => {
            const req = { amount: '20.00' };
            // Mock partialCents to return 1000 for 50%
            global.window.TerminalSimulatorHelpers.partialCents.mockReturnValue(1000);

            const payload = window.TerminalSimulators.moneris.buildPayload('partial_auth', 'purchase', req, 50);

            expect(payload.ResponseCode).toBe('027');
            expect(payload.Message).toBe('APPROVED *');
            expect(payload.TransAmount).toBe('20.00'); // Original amount
            expect(payload.authorized_amount).toBe('10.00'); // Partial amount
            expect(payload.Complete).toBe('true');
            expect(payload.TimedOut).toBe('false');
            expect(payload.ApprovalCode).toBe('123456');
            expect(payload.iso_code).toBe('00');
            expect(payload.AvsResultCode).toBe('Y');
            expect(payload.CvdResultCode).toBe('1');
        });

        it('should handle timeout outcome', () => {
            const req = { amount: '10.00' };
            const payload = window.TerminalSimulators.moneris.buildPayload('timeout', 'purchase', req, 100);

            expect(payload.ResponseCode).toBe('101');
            expect(payload.Message).toBe('SYSTEM TIMEOUT');
            expect(payload.TransAmount).toBe('10.00');
            expect(payload.Complete).toBe('false');
            expect(payload.TimedOut).toBe('true');
            expect(payload.ApprovalCode).toBeNull();
            expect(payload.iso_code).toBe('68');
            expect(payload.AvsResultCode).toBe('N');
            expect(payload.CvdResultCode).toBe('3');
        });

        describe('decline scenarios', () => {
            const req = { amount: '10.00' };

            it('should handle NSF decline', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'nsf', req, 100);
                expect(payload.ResponseCode).toBe('481');
                expect(payload.Message).toBe('DECLINED');
                expect(payload.Complete).toBe('false');
                expect(payload.iso_code).toBe('05');
                expect(payload.ApprovalCode).toBeNull();
            });

            it('should handle stolen card decline', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'stolen', req, 100);
                expect(payload.ResponseCode).toBe('402');
                expect(payload.Message).toBe('PICK UP CARD');
            });

            it('should handle expired card decline', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'expired', req, 100);
                expect(payload.ResponseCode).toBe('400');
                expect(payload.Message).toBe('EXPIRED CARD');
            });

            it('should handle cvc decline', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'cvc', req, 100);
                expect(payload.ResponseCode).toBe('478');
                expect(payload.Message).toBe('CVD FAILURE');
                expect(payload.CvdResultCode).toBe('2');
            });

            it('should handle processing error decline', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'processing_error', req, 100);
                expect(payload.ResponseCode).toBe('475');
                expect(payload.Message).toBe('SYSTEM ERROR');
            });

            it('should fallback to default decline for unknown methods', () => {
                const payload = window.TerminalSimulators.moneris.buildPayload('declined', 'unknown_method', req, 100);
                expect(payload.ResponseCode).toBe('481');
                expect(payload.Message).toBe('DECLINED');
            });
        });

        it('should correctly format transaction ids and references', () => {
            const req = { amount: '5.50' };
            const payload = window.TerminalSimulators.moneris.buildPayload('approved', 'purchase', req, 100);

            expect(payload.TransID).toBe('1234567890123'); // 13 chars
            expect(payload.txn_num).toBe('1234567890123');
            expect(payload.ReceiptId).toBe('REC-123456-1234');
            expect(payload.ReferenceNum).toBe('66012345678901234567');
            expect(payload.Ticket).toBe('T12345678');

            // Check that dates and times have correct format (YYYY-MM-DD, HH:MM:SS)
            expect(payload.TransDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(payload.TransTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        });
    });
});
