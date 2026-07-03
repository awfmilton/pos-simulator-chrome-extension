/*
 * simulators/moneris.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Moneris Cloud Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.moneris.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * buildPayload(outcome, method, req, partialPercent)
 *   Returns the vendor-accurate Moneris mpg-style JSON that TerminalBridge
 *   delivers to MonerisForm.vue as `data.vendorPayload`.
 *
 * updateUI(show)
 *   Shows or hides the iPP320 virtual display, Moneris test card selector,
 *   and generates a 9-character Cloud pairing token on first show.
 */

'use strict';

window.TerminalSimulators.moneris = (function () {

    function updateUI(show) {
        const displaySection = document.getElementById('moneris-display-section');
        const cardRow        = document.getElementById('moneris-card-row');
        const pairingToken   = document.getElementById('moneris-pairing-token');
        const credSection    = document.getElementById('moneris-credentials-section');

        if (displaySection) displaySection.style.display = show ? '' : 'none';
        if (cardRow)        cardRow.style.display        = show ? '' : 'none';
        if (credSection)    credSection.style.display    = show ? '' : 'none';

        // Generate a pairing token on first display (Moneris Cloud terminal pairing)
        if (show && pairingToken && !pairingToken.textContent) {
            pairingToken.textContent = _generatePairingToken();
            if (window.TerminalSimulatorDebug) {
                console.log('[TerminalSim][Moneris] Pairing token generated:', pairingToken.textContent);
            }
        }
    }

    /** Generate a 9-character alphanumeric Moneris Cloud pairing token (no O, 0, I, 1). */
    function _generatePairingToken() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let token = '';
        for (let i = 0; i < 9; i++) token += chars[Math.floor(Math.random() * chars.length)];
        return token;
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { numStr, uid, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved = outcome === 'approved' || outcome === 'approved_not_captured'; // delayed-capture approval is not a decline
        const isPartial  = outcome === 'partial_auth';
        const isTimeout  = outcome === 'timeout';

        const pCents   = partialCents(req, partialPercent);

        // Moneris response codes (§4 of implementation plan):
        //   027 = Approved
        //   101 = System Timeout (host unreachable)
        //   400 = Expired card
        //   402 = Stolen card
        //   475 = Processing error
        //   478 = CVD mismatch
        //   481 = Standard decline (NSF)
        //   914 = Terminal timeout (customer did not interact)
        const monerisCode = (isApproved || isPartial) ? '027'
            : isTimeout ? '101'
            : { nsf: '481', stolen: '402', expired: '400', cvc: '478', processing_error: '475' }[method] ?? '481';

        const monerisMsg = (isApproved || isPartial) ? 'APPROVED *'
            : isTimeout ? 'SYSTEM TIMEOUT'
            : { nsf: 'DECLINED', stolen: 'PICK UP CARD', expired: 'EXPIRED CARD', cvc: 'CVD FAILURE', processing_error: 'SYSTEM ERROR' }[method] ?? 'DECLINED';

        const avsResultCode = (isApproved || isPartial) ? 'Y' : 'N';
        const cvdResultCode = (method === 'cvc') ? '2'
            : (isApproved || isPartial)           ? '1'
            : '3';

        const transId   = numStr(13);
        const transDate = new Date().toISOString().slice(0, 10);
        const transTime = new Date().toTimeString().slice(0, 8);

        if (window.TerminalSimulatorDebug) {
            console.log('[TerminalSim][Moneris] Response code mapping', {
                outcome, method, monerisCode, monerisMsg,
                transId, ApprovalCode: (isApproved || isPartial) ? '(6-digit numStr)' : null,
            });
        }

        return {
            ResponseCode:     monerisCode,
            Message:          monerisMsg,
            TransID:          transId,
            ReceiptId:        'REC-' + numStr(6) + '-' + numStr(4),
            ReferenceNum:     '660' + numStr(17),
            CardType:         'V',
            txn_num:          transId,
            ApprovalCode:     (isApproved || isPartial) ? numStr(6) : null,
            Ticket:           uid('T', 8).toUpperCase(),
            iso_code:         (isApproved || isPartial) ? '00' : (isTimeout ? '68' : '05'),
            AvsResultCode:    avsResultCode,
            CvdResultCode:    cvdResultCode,
            TransDate:        transDate,
            TransTime:        transTime,
            TransAmount:      parseFloat(req.amount).toFixed(2),
            Complete:         (isApproved || isPartial) ? 'true' : 'false',
            TimedOut:         isTimeout ? 'true' : 'false',
            requested_amount:  parseFloat(req.amount).toFixed(2),
            authorized_amount: isPartial ? (pCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
        };
    }

    return { updateUI, buildPayload };

})();
