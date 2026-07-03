/*
 * simulators/helcim.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Helcim Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.helcim.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 */

'use strict';

window.TerminalSimulators.helcim = (function () {

    function updateUI(show) {
        // No Helcim-specific UI elements in the side panel
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved = outcome === 'approved' || outcome === 'approved_not_captured'; // delayed-capture approval is not a decline
        const isPartial  = outcome === 'partial_auth';
        const isTimeout  = outcome === 'timeout';

        const pCents         = partialCents(req, partialPercent);
        const maskedPan      = '4111 **** **** ' + numStr(4);
        const now            = new Date().toISOString();

        const helcimMsg = isApproved ? 'APPROVED'
            : isPartial              ? 'PARTIAL APPROVAL'
            : isTimeout              ? 'TIMEOUT - NO RESPONSE'
            : {
                nsf:              'DECLINED - INSUFFICIENT FUNDS',
                stolen:           'DECLINED - PICK UP CARD',
                expired:          'DECLINED - EXPIRED CARD',
                cvc:              'DECLINED - CVV MISMATCH',
                processing_error: 'SYSTEM ERROR',
            }[method] ?? 'DECLINED';

        const approvedAmount = isPartial ? (pCents / 100) : parseFloat(req.amount);

        const transactionId = parseInt(numStr(8));
        const approvalCode  = (isApproved || isPartial) ? numStr(6) : null;
        const cardToken     = (isApproved || isPartial) ? uid('helcim_tok_', 16) : null;

        if (window.TerminalSimulatorDebug) {
            console.log('[TerminalSim][Helcim] Generated IDs', {
                transactionId,
                approvalCode,
                cardToken,
                maskedPan,
                outcome,
                method,
            });
        }

        return {
            response:        (isApproved || isPartial) ? 1 : 0,
            responseMessage: helcimMsg,
            data: {
                transactionId,
                dateCreated:     now,
                approvalCode,
                cardType:        'visa',
                cardNumber:      maskedPan,
                cardExpiry:      '12/27',
                cardToken,
                currency:        req.currency || 'CAD',
                amount:          approvedAmount,
                requestedAmount: parseFloat(req.amount),
                avsResponse:     (isApproved || isPartial) ? 'X' : null,
                cvvResponse:     method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                invoice:         req.id,
                terminalId:      uid('HT', 6).toUpperCase(),
                errors:          (isApproved || isPartial) ? null : [{ field: 'card', message: helcimMsg }],
            },
        };
    }

    return { updateUI, buildPayload };

})();
