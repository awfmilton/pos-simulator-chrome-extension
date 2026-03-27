/*
 * simulators/square_pos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Square Point of Sale API (App-Switch) simulator controller.
 *
 * Registered into window.TerminalSimulators.square_pos.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * This simulator handles the mock App-Switch flow: when the POS is in
 * 'mock' environment, SquarePOSForm.vue sends POS_SQUARE_POS_MOCK_REQUEST
 * instead of navigating to the square-commerce-v1:// URL scheme.
 * The request appears in the Terminal tab approval queue and the operator
 * approves/declines it like a normal terminal charge request.
 *
 * Response format mirrors the iOS callback JSON data object:
 *   success: { status: 'ok', transaction_id, client_transaction_id }
 *   error:   { status: 'error', error_code, error_description }
 *
 * Note: updateUI is a no-op — this brand uses the shared approval buttons
 * with no brand-specific DOM rows.
 */

'use strict';

window.TerminalSimulators = window.TerminalSimulators || {};

window.TerminalSimulators.square_pos = (function () {

    function updateUI(show) {
        // No brand-specific DOM rows — all handled by the shared approval UI
    }

    function buildPayload(outcome, method, req) {
        const { uid } = window.TerminalSimulatorHelpers;

        const isApproved = (outcome === 'approved');

        // Simulate Square's callback data format (iOS JSON structure)
        if (isApproved) {
            return {
                status:                'ok',
                transaction_id:        uid('', 26).toUpperCase(),   // Square Order ID
                client_transaction_id: uid('', 20).toUpperCase(),
                error_code:            null,
                error_description:     null,
            };
        }

        // Map simulator decline methods to Square error codes
        const errorCodeMap = {
            nsf:              'card_declined',
            stolen:           'card_declined',
            expired:          'card_declined',
            cvc:              'card_declined',
            processing_error: 'card_declined',
            timeout:          'TRANSACTION_CANCELED',
        };
        const errorDescMap = {
            nsf:              'Card declined: insufficient funds.',
            stolen:           'Card declined: suspected fraud.',
            expired:          'Card declined: card expired.',
            cvc:              'Card declined: CVV check failed.',
            processing_error: 'Processing error — please retry.',
            timeout:          'Transaction was cancelled.',
        };

        return {
            status:                'error',
            transaction_id:        null,
            client_transaction_id: uid('', 20).toUpperCase(),
            error_code:            errorCodeMap[method]  ?? 'card_declined',
            error_description:     errorDescMap[method]  ?? 'Card declined.',
        };
    }

    return { updateUI, buildPayload };

})();
