/*
 * simulators/square.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Square Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.square.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * The Square "Approved Not Captured" button and partial auth button are shared
 * UI handled by the main payment-terminal-simulator.js router; this file has
 * no brand-specific DOM to show/hide (updateUI is a no-op).
 */

'use strict';

window.TerminalSimulators.square = (function () {

    function updateUI(show) {
        // No brand-specific DOM beyond the shared not-captured button
        // (handled by the router in payment-terminal-simulator.js)
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved    = outcome === 'approved';
        const isPartial     = outcome === 'partial_auth';
        const isNotCaptured = outcome === 'approved_not_captured';
        const isTimeout     = outcome === 'timeout';

        const totalCents = amountCents(req);
        const pCents     = partialCents(req, partialPercent);
        const last4      = numStr(4);
        const now        = new Date().toISOString();

        const squareStatus = isApproved    ? 'COMPLETED'
            : isNotCaptured               ? 'APPROVED'
            : isPartial                   ? 'APPROVED'
            : isTimeout                   ? 'CANCELED'
            : 'FAILED';

        const squareCardStatus = (isApproved || isNotCaptured || isPartial) ? 'CAPTURED' : 'FAILED';

        const squareErrorCode = {
            nsf:              'CARD_DECLINED',
            stolen:           'CARD_DECLINED',
            expired:          'CARD_EXPIRED',
            cvc:              'CVV_FAILURE',
            processing_error: 'GENERIC_DECLINE',
            timeout:          'PAYMENT_LIMIT_EXCEEDED',
        }[method] ?? 'CARD_DECLINED';

        const squareErrorDetail = {
            nsf:              'Card declined: insufficient funds.',
            stolen:           'Card declined: suspected fraud.',
            expired:          'Card expired.',
            cvc:              'CVV check failed.',
            processing_error: 'Processing error — please retry.',
            timeout:          'Terminal timed out.',
        }[method] ?? 'Card declined.';

        const entryMethod = method === 'swipe' ? 'SWIPED' : method === 'insert' ? 'CHIP' : 'CONTACTLESS';
        const payId = uid('', 32).toUpperCase();

        return {
            payment: {
                id: payId,
                status: squareStatus,
                autocomplete: !isNotCaptured,
                amount_money:   { amount: totalCents,                                   currency: req.currency || 'CAD' },
                approved_money: { amount: isPartial ? pCents : totalCents,              currency: req.currency || 'CAD' },
                card_details: {
                    status:       squareCardStatus,
                    entry_method: entryMethod,
                    card: {
                        card_brand:  'VISA',
                        last_4:      last4,
                        exp_month:   12,
                        exp_year:    2027,
                        fingerprint: uid('sq_fp_', 16),
                    },
                    avs_status: (isApproved || isPartial || isNotCaptured) ? 'AVS_MATCHED' : null,
                    cvv_status: method === 'cvc' ? 'CVV_FAILURE'
                        : (isApproved || isPartial || isNotCaptured) ? 'CVV_MATCHED' : null,
                },
                location_id: uid('L', 13).toUpperCase(),
                order_id:    uid('', 32).toUpperCase(),
                created_at:  now,
                updated_at:  now,
                receipt_url: (isApproved || isPartial || isNotCaptured)
                    ? `https://squareup.com/receipt/preview/${payId}` : null,
                errors: (isApproved || isPartial || isNotCaptured) ? [] : [{
                    category: 'PAYMENT_METHOD_ERROR',
                    code:     squareErrorCode,
                    detail:   squareErrorDetail,
                }],
            },
        };
    }

    return { updateUI, buildPayload };

})();
