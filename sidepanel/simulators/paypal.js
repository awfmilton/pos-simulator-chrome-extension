/*
 * simulators/paypal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PayPal / Zettle Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.paypal.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * The response shape matches the Zettle SDK payment object.
 */

'use strict';

window.TerminalSimulators.paypal = (function () {

    function updateUI(show) {
        // No PayPal-specific UI elements in the side panel
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved = outcome === 'approved';
        const isPartial  = outcome === 'partial_auth';
        const isTimeout  = outcome === 'timeout';

        const pCents    = partialCents(req, partialPercent);
        const maskedPan = '4111 **** **** ' + numStr(4);
        const now       = new Date().toISOString();

        const zettleState = (isApproved || isPartial) ? 'PAID' : 'FAILED';

        const zettleErrorMsg = isTimeout ? 'Payment terminal timed out.'
            : {
                nsf:              'Payment declined: Insufficient funds.',
                stolen:           'Payment declined: Card not accepted.',
                expired:          'Payment declined: Expired card.',
                cvc:              'Payment declined: CVV check failed.',
                processing_error: 'Payment declined: Processing error.',
            }[method] ?? 'Payment declined.';

        const entryMode = method === 'swipe' ? 'MAGNETIC_STRIPE'
            : method === 'insert'            ? 'CHIP'
            : 'CONTACTLESS';

        return {
            uuid:  uid('', 32),
            state: zettleState,
            type:  'PAYMENT',
            amount: {
                value:      isPartial ? (pCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
                currencyId: req.currency || 'CAD',
            },
            requestedAmount: {
                value:      parseFloat(req.amount).toFixed(2),
                currencyId: req.currency || 'CAD',
            },
            cardPayment: {
                maskedPan,
                cardType:          'VISA',
                entryMode,
                statusMessage:     (isApproved || isPartial) ? 'APPROVED' : 'DECLINED',
                authorizationCode: (isApproved || isPartial) ? numStr(6) : null,
                gratuityAmount:    0,
            },
            references: {
                paymentReference: req.id,
                receiptReference: (isApproved || isPartial) ? uid('R', 12).toUpperCase() : null,
            },
            refundFailureReason: null,
            errorMessage: (isApproved || isPartial) ? null : zettleErrorMsg,
            timestamp: now,
        };
    }

    return { updateUI, buildPayload };

})();
