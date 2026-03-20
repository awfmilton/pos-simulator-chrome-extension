/*
 * simulators/globalpayments.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Global Payments Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.globalpayments.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * Uses ISO 8583 response codes as produced by the Global Payments gateway.
 */

'use strict';

window.TerminalSimulators.globalpayments = (function () {

    function updateUI(show) {
        // No Global Payments-specific UI elements in the side panel
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved    = outcome === 'approved';
        const isPartial     = outcome === 'partial_auth';
        const isNotCaptured = outcome === 'approved_not_captured';
        const isTimeout     = outcome === 'timeout';

        const pCents    = partialCents(req, partialPercent);
        const maskedPan = '4111 **** **** ' + numStr(4);
        const last4     = maskedPan.slice(-4);
        const now       = new Date().toISOString();

        // ISO 8583 response codes
        const gpCode = (isApproved || isPartial || isNotCaptured) ? '00'
            : isTimeout ? '68'
            : {
                nsf:              '05',
                stolen:           '41',
                expired:          '54',
                cvc:              '82',
                processing_error: '96',
            }[method] ?? '05';

        const gpMsg = {
            '00': 'Approved',
            '05': 'Do Not Honour',
            '41': 'Pick Up Card (Stolen)',
            '54': 'Expired Card',
            '68': 'Response Received Too Late',
            '82': 'CVV2/CVC2/CAV2 Verification Failed',
            '96': 'System Malfunction',
        }[gpCode] ?? 'Declined';

        const gpResult = (isApproved || isPartial || isNotCaptured) ? 'SUCCESS'
            : isTimeout ? 'TIMEOUT' : 'DECLINED';

        const entryMode = method === 'swipe' ? 'SWIPE' : method === 'insert' ? 'CHIP' : 'CONTACTLESS';

        return {
            id:              uid('txn_', 20),
            result:          gpResult,
            status:          (isApproved || isNotCaptured) ? 'CAPTURED'
                : isPartial ? 'PARTIALLY_CAPTURED' : 'FAILED',
            amount:          parseFloat(req.amount).toFixed(2),
            amount_authorized: isPartial ? (pCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
            currency:        req.currency || 'CAD',
            batchNumber:     numStr(6),
            idempotencyKey:  uid('idem_', 16),
            duplicateRequest: false,
            card: {
                maskedNumber:   maskedPan,
                expiry:         '1227',
                cardholderName: 'TEST CARDHOLDER',
                brand:          'VISA',
                last4,
                authCode:       (isApproved || isPartial || isNotCaptured) ? numStr(6) : null,
                entryMode,
                avsResult:  (isApproved || isPartial || isNotCaptured) ? 'MATCHED' : null,
                cvnResult:  method === 'cvc' ? 'NOT_MATCHED'
                    : (isApproved || isPartial || isNotCaptured) ? 'MATCHED' : null,
            },
            responseCode:    gpCode,
            responseMessage: gpMsg,
            timestamp:       now,
        };
    }

    return { updateUI, buildPayload };

})();
