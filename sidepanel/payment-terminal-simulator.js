/*
 * payment-terminal-simulator.js
 * ─────────────────────────────
 * Owned and Distributed by: tbay.tk LLC, MT, 59601
 * Developed by: Alexander Milton
 *
 * Module: Payment Terminal Simulator
 * Manages the Terminal tab in the POS Peripheral Simulator side panel.
 *
 * Communication flow (charge request → approval):
 *
 *   POS page
 *     └─ postMessage('POS_TERMINAL_CHARGE_REQUEST')
 *         └─ content-script forwards as { type: 'TERMINAL_CHARGE_REQUEST' } on SW port
 *             └─ service-worker forwards to sidePanelPort
 *                 └─ panel receives { type: 'TERMINAL_CHARGE_REQUEST' }  ← handled here
 *                    [operator clicks Approve / Decline / Timeout]
 *                 └─ panel sends { type: 'TERMINAL_SIMULATE_RESPONSE' } to SW port
 *             └─ service-worker broadcasts to content-script ports
 *         └─ content-script postMessage('POS_TERMINAL_CHARGE_RESPONSE')
 *     └─ TerminalBridge.js resolves/rejects the awaited Promise
 */

'use strict';

(function () {
    // ─── State ──────────────────────────────────────────────────────────────
    const state = {
        pendingRequests: [],    // queue of {id, gateway, amount, currency, timestamp}
        activeBrand: 'stripe',  // currently selected terminal brand
        swPort: null,           // reference to the SW MessagePort (injected via init)
    };

    // ─── DOM references (all resolved after panel.html loads) ─────────────
    let elBrandSelect, elLogList, elNoPending,
        elBtnTapApproved, elBtnInsertApproved,
        elBtnDeclineNSF, elBtnTimeout,
        elBadge;

    // ─────────────────────────────────────────────────────────────────────────
    // Public API – called from panel.js after DOMContentLoaded
    // ─────────────────────────────────────────────────────────────────────────
    window.initPaymentTerminalSimulator = function (swPort) {
        state.swPort = swPort;
        _cacheDOM();
        _bindEvents();
        console.log('[TerminalSim] Initialized.');
    };

    /**
     * Called by panel.js when a TERMINAL_CHARGE_REQUEST message arrives from SW.
     */
    window.handleTerminalChargeRequest = function (data) {
        const req = {
            id:        data.requestId ?? ('req_' + Date.now()),
            gateway:   data.gateway ?? 'unknown',
            amount:    typeof data.amount === 'number' ? data.amount.toFixed(2) : data.amount,
            currency:  data.currency ?? 'CAD',
            timestamp: new Date().toLocaleTimeString(),
        };

        state.pendingRequests.push(req);
        _addLogEntry(req);
        _refreshButtonState();
        _updateBadge();

        // Auto-switch to the Terminal tab to get the operator's attention
        const terminalTabBtn = document.querySelector('[data-tab="terminal"]');
        if (terminalTabBtn) {
            // Only pulse, don't force-switch — operator might be mid-action elsewhere
            terminalTabBtn.classList.add('tab-btn--pulse');
            setTimeout(() => terminalTabBtn.classList.remove('tab-btn--pulse'), 3000);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    function _cacheDOM() {
        elBrandSelect    = document.getElementById('terminal-brand-select');
        elLogList        = document.getElementById('terminal-log-list');
        elNoPending      = document.getElementById('terminal-no-pending');
        elBtnTapApproved = document.getElementById('terminal-btn-tap-approved');
        elBtnInsertApproved = document.getElementById('terminal-btn-insert-approved');
        elBtnDeclineNSF  = document.getElementById('terminal-btn-decline-nsf');
        elBtnTimeout     = document.getElementById('terminal-btn-timeout');
        elBadge          = document.getElementById('terminal-tab-badge');
    }

    function _bindEvents() {
        if (elBrandSelect) {
            elBrandSelect.addEventListener('change', () => {
                state.activeBrand = elBrandSelect.value;
                console.log('[TerminalSim] Brand changed to:', state.activeBrand);
            });
        }

        if (elBtnTapApproved) {
            elBtnTapApproved.addEventListener('click', () => _sendResponse('approved', 'tap'));
        }
        if (elBtnInsertApproved) {
            elBtnInsertApproved.addEventListener('click', () => _sendResponse('approved', 'insert'));
        }
        if (elBtnDeclineNSF) {
            elBtnDeclineNSF.addEventListener('click', () => _sendResponse('declined', 'nsf'));
        }
        if (elBtnTimeout) {
            elBtnTimeout.addEventListener('click', () => _sendResponse('timeout', 'timeout'));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vendor-accurate response payload builder
    // ─────────────────────────────────────────────────────────────────────────
    function _uid(prefix, len) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = prefix;
        for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }
    function _numStr(len) {
        let s = '';
        for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
        return s;
    }

    function _buildVendorPayload(brand, outcome, method, req) {
        const isApproved = outcome === 'approved';
        const amountCents = Math.round(parseFloat(req.amount) * 100);
        const maskedPan   = '4111 **** **** ' + _numStr(4);
        const now         = new Date().toISOString();

        switch (brand) {
            // ── Stripe ─────────────────────────────────────────────────────
            case 'stripe': {
                const piId = _uid('pi_', 24);
                return isApproved ? {
                    id: piId,
                    object: 'payment_intent',
                    status: 'succeeded',
                    amount: amountCents,
                    currency: (req.currency || 'CAD').toLowerCase(),
                    payment_method: _uid('pm_', 24),
                    charges: {
                        data: [{
                            id: _uid('ch_', 24),
                            paid: true,
                            amount: amountCents,
                            payment_method_details: {
                                type: method === 'tap' ? 'card_present' : 'card',
                                card_present: { brand: 'visa', last4: maskedPan.slice(-4), exp_month: 12, exp_year: 2027, read_method: method === 'tap' ? 'contactless_emv' : 'contact_emv' }
                            }
                        }]
                    },
                    created: Math.floor(Date.now() / 1000)
                } : {
                    id: piId,
                    object: 'payment_intent',
                    status: outcome === 'timeout' ? 'canceled' : 'requires_payment_method',
                    last_payment_error: {
                        code: outcome === 'timeout' ? 'payment_intent_timeout' : 'card_declined',
                        decline_code: outcome === 'timeout' ? null : 'insufficient_funds',
                        message: outcome === 'timeout' ? 'The operation timed out.' : 'Your card has insufficient funds.'
                    }
                };
            }

            // ── Moneris ────────────────────────────────────────────────────
            case 'moneris': {
                const transId = _numStr(13);
                return {
                    ResponseCode:  isApproved ? '027' : outcome === 'timeout' ? '914' : '481',
                    Message:       isApproved ? 'APPROVED' : outcome === 'timeout' ? 'TIMEOUT' : 'DECLINED',
                    TransID:       transId,
                    ReferenceNum:  _numStr(12),
                    CardType:      'V',
                    txn_num:       transId,
                    ApprovalCode:  isApproved ? _numStr(6) : null,
                    ticket:        _uid('T', 8).toUpperCase(),
                    iso_code:      isApproved ? '00' : '05',
                    receipt_id:    _uid('R', 12).toUpperCase(),
                };
            }

            // ── Square ─────────────────────────────────────────────────────
            case 'square': {
                const payId = _uid('', 32).toUpperCase();
                return {
                    payment: {
                        id: payId,
                        status: isApproved ? 'COMPLETED' : outcome === 'timeout' ? 'CANCELED' : 'FAILED',
                        amount_money: { amount: amountCents, currency: (req.currency || 'CAD') },
                        card_details: {
                            status: isApproved ? 'CAPTURED' : 'FAILED',
                            card: { card_brand: 'VISA', last_4: maskedPan.slice(-4), exp_month: 12, exp_year: 2027, fingerprint: _uid('sq_fp_', 16) },
                            entry_method: method === 'tap' ? 'CONTACTLESS' : 'CHIP',
                            avs_status: isApproved ? 'AVS_MATCHED' : null,
                        },
                        location_id: _uid('L', 13).toUpperCase(),
                        order_id:    _uid('', 32).toUpperCase(),
                        created_at:  now,
                        updated_at:  now,
                        receipt_url: isApproved ? `https://squareup.com/receipt/preview/${payId}` : null,
                        errors: isApproved ? [] : [{ category: 'PAYMENT_METHOD_ERROR', code: outcome === 'timeout' ? 'PAYMENT_LIMIT_EXCEEDED' : 'CARD_DECLINED', detail: outcome === 'timeout' ? 'Terminal timed out.' : 'Insufficient funds.' }],
                    }
                };
            }

            // ── Helcim ─────────────────────────────────────────────────────
            case 'helcim': {
                return {
                    response: isApproved ? 1 : 0,
                    responseMessage: isApproved ? 'APPROVED' : outcome === 'timeout' ? 'TIMEOUT' : 'DECLINED',
                    data: {
                        transactionId:  parseInt(_numStr(8)),
                        dateCreated:    now,
                        approvalCode:   isApproved ? _numStr(6) : null,
                        cardType:       'visa',
                        cardNumber:     maskedPan,
                        cardExpiry:     '12/27',
                        currency:        req.currency || 'CAD',
                        amount:          parseFloat(req.amount),
                        avsResponse:     isApproved ? 'X' : null,
                        cvvResponse:     isApproved ? 'M' : null,
                        invoice:         req.id,
                        terminalId:      _uid('HT', 6).toUpperCase(),
                    }
                };
            }

            // ── Elavon / Converge ──────────────────────────────────────────
            case 'elavon': {
                return {
                    ssl_result:       isApproved ? '0' : '1',
                    ssl_result_message: isApproved ? 'APPROVAL' : outcome === 'timeout' ? 'TIMEOUT' : 'DECLINE',
                    ssl_txn_id:       _numStr(16),
                    ssl_approval_code: isApproved ? _numStr(6) : null,
                    ssl_card_type:    'VISA',
                    ssl_card_number:  maskedPan,
                    ssl_exp_date:     '1227',
                    ssl_amount:       parseFloat(req.amount).toFixed(2),
                    ssl_salestax:     '0.00',
                    ssl_invoice_number: req.id,
                    ssl_avs_response: isApproved ? 'X' : null,
                    ssl_cvv2_response: isApproved ? 'M' : null,
                    ssl_txn_time:     now,
                    errorCode:        isApproved ? null : (outcome === 'timeout' ? 'E00013' : 'E00012'),
                    errorName:        isApproved ? null : (outcome === 'timeout' ? 'Timeout' : 'Declined'),
                    errorMessage:     isApproved ? null : (outcome === 'timeout' ? 'Terminal timed out.' : 'Insufficient funds.'),
                };
            }

            // ── Global Payments ────────────────────────────────────────────
            case 'globalpayments': {
                return {
                    id:           _uid('txn_', 20),
                    result:       isApproved ? 'SUCCESS' : outcome === 'timeout' ? 'TIMEOUT' : 'DECLINED',
                    status:       isApproved ? 'CAPTURED' : 'FAILED',
                    amount:       parseFloat(req.amount).toFixed(2),
                    currency:     req.currency || 'CAD',
                    batchNumber:  _numStr(6),
                    card: {
                        maskedNumber:  maskedPan,
                        expiry:        '1227',
                        cardholderName: 'TEST CARDHOLDER',
                        brand:         'VISA',
                        authCode:       isApproved ? _numStr(6) : null,
                        entryMethod:    method === 'tap' ? 'CONTACTLESS' : 'CHIP',
                    },
                    responseCode:  isApproved ? '00' : (outcome === 'timeout' ? '68' : '05'),
                    responseMessage: isApproved ? 'Approved' : (outcome === 'timeout' ? 'Timeout' : 'Do Not Honour'),
                    timestamp:     now,
                };
            }

            // ── Chase / CyberSource OmniPay ────────────────────────────────
            case 'chase': {
                return {
                    decision:    isApproved ? 'ACCEPT' : outcome === 'timeout' ? 'ERROR' : 'DECLINE',
                    requestID:   _numStr(20),
                    requestToken: _uid('Axj', 40),
                    reasonCode:  isApproved ? '100' : outcome === 'timeout' ? '150' : '481',
                    purchaseTotals: {
                        currency: req.currency || 'CAD',
                        grandTotalAmount: parseFloat(req.amount).toFixed(2),
                    },
                    ccAuthReply: {
                        reasonCode:   isApproved ? '100' : '481',
                        amount:       parseFloat(req.amount).toFixed(2),
                        authorizationCode: isApproved ? _numStr(6) : null,
                        avsCode:      isApproved ? 'Y' : null,
                        cvCode:       isApproved ? 'M' : null,
                        authorizedDateTime: now,
                        processorResponse: isApproved ? '00' : '05',
                    },
                };
            }

            // ── PayPal / Zettle ────────────────────────────────────────────
            case 'paypal': {
                return {
                    uuid:         _uid('', 32),
                    state:        isApproved ? 'PAID' : outcome === 'timeout' ? 'FAILED' : 'FAILED',
                    type:         'PAYMENT',
                    amount: {
                        value:        parseFloat(req.amount).toFixed(2),
                        currencyId:   req.currency || 'CAD',
                    },
                    cardPayment: {
                        maskedPan,
                        cardType:      'VISA',
                        entryMode:     method === 'tap' ? 'CONTACTLESS' : 'CHIP',
                        statusMessage: isApproved ? 'APPROVED' : 'DECLINED',
                        authorizationCode: isApproved ? _numStr(6) : null,
                    },
                    references: {
                        paymentReference: req.id,
                        receiptReference: isApproved ? _uid('R', 12).toUpperCase() : null,
                    },
                    errorMessage: isApproved ? null : (outcome === 'timeout' ? 'Payment terminal timed out.' : 'Payment declined due to insufficient funds.'),
                    timestamp: now,
                };
            }

            // ── Fallback ───────────────────────────────────────────────────
            default:
                return { outcome, reference, timestamp: now };
        }
    }

    function _sendResponse(outcome, method) {
        if (state.pendingRequests.length === 0) {
            console.warn('[TerminalSim] No pending requests to respond to.');
            return;
        }

        const req       = state.pendingRequests.shift(); // Serve oldest request first
        const brand     = state.activeBrand;
        const reference = `${brand}_${method}_${Date.now()}`;

        const vendorPayload = _buildVendorPayload(brand, outcome, method, req);

        const payload = {
            type:          'TERMINAL_SIMULATE_RESPONSE',
            requestId:     req.id,
            outcome,
            method,
            reference,
            gateway:       req.gateway,
            brand,
            timestamp:     new Date().toISOString(),
            vendorPayload, // ← vendor-accurate response shape
        };

        if (outcome !== 'approved') {
            payload.reason = outcome === 'timeout'
                ? 'Transaction timed out on terminal.'
                : 'Insufficient funds or card declined (NSF).';
        }

        // Send to service worker → content-script → POS page
        if (state.swPort) {
            state.swPort.postMessage(payload);
            console.log('[TerminalSim] Sent response:', payload);
        } else {
            console.error('[TerminalSim] SW port not available — cannot send response.');
        }

        _markLogEntryResolved(req.id, outcome, method);
        _refreshButtonState();
        _updateBadge();
    }

    function _addLogEntry(req) {
        if (!elLogList) return;

        // Hide "no pending" placeholder
        if (elNoPending) elNoPending.style.display = 'none';

        const li = document.createElement('li');
        li.className  = 'terminal-log-entry terminal-log-entry--pending';
        li.id         = 'terminal-entry-' + req.id;
        li.innerHTML  = `
          <span class="log-time">${req.timestamp}</span>
          <span class="log-gateway">${_gatewayLabel(req.gateway)}</span>
          <span class="log-amount">${req.currency} $${req.amount}</span>
          <span class="log-status log-status--pending">⏳ Waiting</span>
        `;
        elLogList.insertBefore(li, elLogList.firstChild);
    }

    function _markLogEntryResolved(reqId, outcome, method) {
        const li = document.getElementById('terminal-entry-' + reqId);
        if (!li) return;

        li.classList.remove('terminal-log-entry--pending');
        li.classList.add('terminal-log-entry--' + outcome);

        const statusEl = li.querySelector('.log-status');
        if (statusEl) {
            const icon = outcome === 'approved' ? '✅' : outcome === 'declined' ? '❌' : '⏰';
            statusEl.textContent     = `${icon} ${outcome.charAt(0).toUpperCase() + outcome.slice(1)} (${method})`;
            statusEl.className       = `log-status log-status--${outcome}`;
        }
    }

    function _refreshButtonState() {
        const hasPending = state.pendingRequests.length > 0;
        [elBtnTapApproved, elBtnInsertApproved, elBtnDeclineNSF, elBtnTimeout].forEach(btn => {
            if (btn) btn.disabled = !hasPending;
        });
        if (elNoPending && state.pendingRequests.length === 0 && elLogList && elLogList.children.length === 0) {
            elNoPending.style.display = '';
        }
    }

    function _updateBadge() {
        if (!elBadge) return;
        const count = state.pendingRequests.length;
        elBadge.textContent  = count > 0 ? String(count) : '';
        elBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    function _gatewayLabel(id) {
        const labels = {
            stripe: 'Stripe', moneris: 'Moneris', square: 'Square',
            paypal: 'PayPal', chase: 'Chase', helcim: 'Helcim',
            elavon: 'Elavon', globalpayments: 'Global Payments'
        };
        return labels[id] ?? id;
    }

})();
