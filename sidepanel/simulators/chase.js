/*
 * simulators/chase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chase / CyberSource OmniPay Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.chase.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * Uses CyberSource reason codes (docs section 6).
 */

'use strict';

window.TerminalSimulators.chase = (function () {

    function updateUI(show) {
        // No Chase-specific UI elements in the side panel
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved = outcome === 'approved' || outcome === 'approved_not_captured'; // delayed-capture approval is not a decline
        const isPartial  = outcome === 'partial_auth';
        const isTimeout  = outcome === 'timeout';

        const pCents = partialCents(req, partialPercent);
        const now    = new Date().toISOString();

        // CyberSource reason codes
        const csReasonCode = isApproved ? '100'
            : isPartial  ? '110'
            : isTimeout  ? '151'
            : {
                nsf:              '204',
                stolen:           '205',
                expired:          '202',
                cvc:              '230',
                processing_error: '150',
            }[method] ?? '200';

        const csDecision = (csReasonCode === '100' || csReasonCode === '110') ? 'ACCEPT'
            : (csReasonCode === '150' || csReasonCode === '151')              ? 'ERROR'
            : 'DECLINE';

        if (window.TerminalSimulatorDebug) {
            console.log('[TerminalSim][Chase] CyberSource reason code mapping', {
                outcome,
                method,
                csReasonCode,
                csDecision,
                authorizationCode: (isApproved || isPartial) ? '(6-digit)' : null,
            });
        }

        return {
            decision:      csDecision,
            requestID:     numStr(20),
            requestToken:  uid('Axj', 40),
            reasonCode:    csReasonCode,
            purchaseTotals: {
                currency:         req.currency || 'CAD',
                grandTotalAmount: parseFloat(req.amount).toFixed(2),
            },
            ccAuthReply: {
                reasonCode:        csReasonCode,
                amount:            (isPartial ? pCents / 100 : parseFloat(req.amount)).toFixed(2),
                authorizationCode: (isApproved || isPartial) ? numStr(6) : null,
                avsCode:           (isApproved || isPartial) ? 'Y' : null,
                avsCodeRaw:        (isApproved || isPartial) ? 'Y' : null,
                cvCode:            method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                cvCodeRaw:         method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                authorizedDateTime: now,
                processorResponse: (isApproved || isPartial) ? '00' : '05',
                cardCategory:      'VISA',
            },
            // Signature field (would be HMAC-SHA256 in production)
            signature:          uid('sig_', 40),
            signed_field_names: 'decision,reasonCode,requestID,requestToken,purchaseTotals',
        };
    }

    return { updateUI, buildPayload };

})();
