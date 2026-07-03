/*
 * simulators/elavon.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Elavon Converge Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.elavon.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 */

'use strict';

window.TerminalSimulators.elavon = (function () {

    function updateUI(show) {
        // No Elavon-specific UI elements in the side panel
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved = outcome === 'approved' || outcome === 'approved_not_captured'; // delayed-capture approval is not a decline
        const isPartial  = outcome === 'partial_auth';
        const isTimeout  = outcome === 'timeout';

        const pCents    = partialCents(req, partialPercent);
        const maskedPan = '4111 **** **** ' + numStr(4);
        const now       = new Date().toISOString();

        const elavonResult = (isApproved || isPartial) ? '0' : '1';

        const elavonMsg = isApproved ? 'APPROVAL'
            : isPartial              ? 'PARTIAL APPROVAL'
            : isTimeout              ? 'TIMEOUT'
            : {
                nsf:              'DECLINE',
                stolen:           'DECLINE - CALL',
                expired:          'DECLINE - EXPIRED CARD',
                cvc:              'DECLINE - CVV2 FAILURE',
                processing_error: 'SYSTEM ERROR',
            }[method] ?? 'DECLINE';

        // Elavon SSL error codes
        const elavonErrorCode = {
            nsf:              'E00012',
            stolen:           'E00052',
            expired:          'E00014',
            cvc:              'E00044',
            processing_error: 'E00013',
            timeout:          'E00013',
        }[method] ?? 'E00012';

        const entryMode = method === 'swipe' ? 'SWIPE' : method === 'insert' ? 'CHIP' : 'CONTACTLESS';

        if (window.TerminalSimulatorDebug) {
            console.log('[TerminalSim][Elavon] ssl_ mapping', {
                outcome,
                method,
                ssl_result:         elavonResult,
                ssl_result_message: elavonMsg,
                errorCode:          (isApproved || isPartial) ? null : elavonErrorCode,
                entryMode,
            });
        }

        return {
            ssl_result:            elavonResult,
            ssl_result_message:    elavonMsg,
            ssl_txn_id:            numStr(6) + 'C' + numStr(2) + '-' + uid('', 8).toUpperCase(),
            ssl_approval_code:     (isApproved || isPartial) ? numStr(6) : null,
            ssl_card_type:         'VISA',
            ssl_card_number:       maskedPan,
            ssl_exp_date:          '1227',
            ssl_amount:            parseFloat(req.amount).toFixed(2),
            ssl_requested_amount:  parseFloat(req.amount).toFixed(2),
            ssl_authorized_amount: isPartial ? (pCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
            ssl_salestax:          '0.00',
            ssl_invoice_number:    req.id,
            ssl_avs_response:      (isApproved || isPartial) ? 'X' : null,
            ssl_cvv2_response:     method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
            ssl_entry_mode:        entryMode,
            ssl_txn_time:          now,
            errorCode:    (isApproved || isPartial) ? null : elavonErrorCode,
            errorName:    (isApproved || isPartial) ? null : elavonMsg,
            errorMessage: (isApproved || isPartial) ? null : elavonMsg,
        };
    }

    return { updateUI, buildPayload };

})();
