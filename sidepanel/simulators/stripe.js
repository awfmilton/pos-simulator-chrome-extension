/*
 * simulators/stripe.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe Terminal simulator controller.
 *
 * Registered into window.TerminalSimulators.stripe.
 * Requires window.TerminalSimulatorHelpers (helpers.js loaded first).
 *
 * buildPayload(outcome, method, req, partialPercent)
 *   Returns the vendor-accurate Stripe PaymentIntent JSON that TerminalBridge
 *   delivers to StripeForm.vue as `data.vendorPayload`.
 *
 * updateUI(show)
 *   Shows or hides the Stripe-specific Engineer's Toolbar card selector row.
 */

'use strict';

window.TerminalSimulators.stripe = (function () {

    function updateUI(show) {
        const row = document.getElementById('stripe-card-row');
        if (row) row.style.display = show ? '' : 'none';
    }

    function buildPayload(outcome, method, req, partialPercent) {
        const { uid, numStr, amountCents, partialCents } = window.TerminalSimulatorHelpers;

        const isApproved    = outcome === 'approved';
        const isPartial     = outcome === 'partial_auth';
        const isTimeout     = outcome === 'timeout';

        const totalCents   = amountCents(req);
        const pCents       = partialCents(req, partialPercent);
        const last4        = numStr(4);
        const now          = Math.floor(Date.now() / 1000);

        const piId = uid('pi_', 24);
        const chId = uid('ch_', 24);

        if (isApproved || isPartial) {
            const authorizedCents = isPartial ? pCents : totalCents;
            const readMethod = method === 'swipe' ? 'magnetic_stripe_fallback'
                : method === 'insert'             ? 'contact_emv'
                : 'contactless_emv';

            return {
                id: piId,
                object: 'payment_intent',
                status: isPartial ? 'requires_capture' : 'succeeded',
                amount: totalCents,
                amount_received: authorizedCents,
                currency: (req.currency || 'CAD').toLowerCase(),
                payment_method: uid('pm_', 24),
                latest_charge: {
                    id: chId,
                    paid: true,
                    amount: totalCents,
                    amount_captured: authorizedCents,
                    payment_method_details: {
                        type: 'card_present',
                        card_present: {
                            brand: 'visa',
                            last4,
                            exp_month: 12,
                            exp_year: 2027,
                            read_method: readMethod,
                        },
                    },
                    partial_authorization: isPartial ? {
                        status: 'partially_authorized',
                        amount_requested: totalCents,
                        amount_authorized: authorizedCents,
                    } : null,
                },
                // Legacy charges.data shape for back-compat
                charges: {
                    data: [{
                        id: chId,
                        paid: true,
                        amount: authorizedCents,
                        payment_method_details: {
                            type: 'card_present',
                            card_present: {
                                brand: 'visa', last4, exp_month: 12, exp_year: 2027,
                                read_method: readMethod,
                            },
                        },
                    }],
                },
                created: now,
            };
        }

        // Decline / timeout
        const stripeDeclineCode = {
            nsf:              'insufficient_funds',
            stolen:           'stolen_card',
            expired:          'expired_card',
            cvc:              'incorrect_cvc',
            processing_error: 'processing_error',
        }[method] ?? 'generic_decline';

        const stripeErrorCode = {
            expired:          'expired_card',
            cvc:              'incorrect_cvc',
            processing_error: 'processing_error',
        }[method] ?? (isTimeout ? 'payment_intent_timeout' : 'card_declined');

        return {
            id: piId,
            object: 'payment_intent',
            status: isTimeout ? 'canceled' : 'requires_payment_method',
            last_payment_error: {
                code:         stripeErrorCode,
                decline_code: isTimeout ? null : stripeDeclineCode,
                message: {
                    nsf:              'Your card has insufficient funds.',
                    stolen:           'Your card has been declined.',
                    expired:          'Your card has expired.',
                    cvc:              "Your card's security code is incorrect.",
                    processing_error: 'An error occurred while processing your card.',
                    timeout:          'The operation timed out.',
                }[method] ?? 'Your card was declined.',
            },
        };
    }

    return { updateUI, buildPayload };

})();
