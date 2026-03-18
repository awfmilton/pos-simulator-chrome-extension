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
        partialAuthPercent: 70, // percentage of amount to authorize for partial auth (default 70%)
        forceResult: '',        // Engineer's Toolbar: force next result ('approved'|'nsf'|'stolen'|'expired'|'cvc'|'timeout'|'')
        environment: 'mock',    // 'sandbox' | 'mock' — from incoming charge request
        posOrigin: 'http://localhost:8000',  // POS server origin for stripe_simulate.php calls
        gearClickCount: 0,      // triple-click counter to reveal toolbar
        gearClickTimer: null,
    };

    // ─── DOM references ──────────────────────────────────────────────────────
    let elBrandSelect, elLogList, elNoPending,
        elBtnTapApproved, elBtnInsertApproved, elBtnSwipeApproved,
        elBtnPartialAuth, elBtnSquareNotCaptured,
        elBtnDeclineNSF, elBtnDeclineStolen, elBtnDeclineExpired,
        elBtnDeclineCVC, elBtnDeclineProcessing,
        elBtnTimeout,
        elPartialAuthInput,
        elBadge,
        // Engineer's Toolbar
        elEngineerToggle, elEngineerToolbar, elForceResultSelect,
        elSandboxStatusBadge, elSandboxConnectionRow, elSandboxConnectionText,
        elStripeCardSelect,
        elMonerisCardSelect, elMonerisCardRow,
        // Moneris iPP320 virtual display
        elMonerisScreenLine1, elMonerisScreenLine2,
        elMonerisPairingToken, elMonerisDisplaySection;

    // ─── Reason messages sent back to the POS form ───────────────────────────
    const REASON_MESSAGES = {
        nsf:              'Insufficient funds — card declined.',
        stolen:           'Stolen card — please retain the card.',
        expired:          'Card has expired.',
        cvc:              'CVV/CVC verification failed.',
        processing_error: 'A processing error occurred. Please try again.',
        timeout:          'Transaction timed out on terminal.',
        partial_auth:     'Partial authorisation — card had insufficient funds for the full amount.',
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Public API – called from panel.js after DOMContentLoaded
    // ─────────────────────────────────────────────────────────────────────────
    window.initPaymentTerminalSimulator = function (swPort) {
        state.swPort = swPort;
        _cacheDOM();
        _bindEvents();
        _refreshButtonState();
        console.log('[TerminalSim] Initialized.');
    };

    /**
     * Called by panel.js when a TERMINAL_CHARGE_REQUEST message arrives from SW.
     */
    window.handleTerminalChargeRequest = function (data) {
        const req = {
            id:               data.requestId ?? ('req_' + Date.now()),
            gateway:          data.gateway ?? 'unknown',
            amount:           typeof data.amount === 'number' ? data.amount.toFixed(2) : data.amount,
            currency:         data.currency ?? 'CAD',
            orderId:          data.orderId ?? null,
            timestamp:        new Date().toLocaleTimeString(),
            // Stripe Push-to-Reader sandbox fields
            payment_intent_id: data.payment_intent_id ?? null,
            reader_id:         data.reader_id         ?? null,
        };

        // Update environment from incoming request
        if (data.environment) {
            state.environment = data.environment;
            _updateSandboxBadge(data.environment);
        }
        if (data.posOrigin) {
            state.posOrigin = data.posOrigin;
        }

        // If a Force Result is set, auto-respond without operator interaction
        if (state.forceResult) {
            state.pendingRequests.push(req);
            _addLogEntry(req);
            _updateBadge();
            const forced = state.forceResult;
            // Map force result to (outcome, method)
            const forceMap = {
                approved: ['approved',  'tap'],
                nsf:      ['declined',  'nsf'],
                stolen:   ['declined',  'stolen'],
                expired:  ['declined',  'expired'],
                cvc:      ['declined',  'cvc'],
                timeout:  ['timeout',   'timeout'],
            };
            const [outcome, method] = forceMap[forced] ?? ['approved', 'tap'];
            setTimeout(() => _sendResponse(outcome, method), 300);
            return;
        }

        state.pendingRequests.push(req);
        _addLogEntry(req);
        _refreshButtonState();
        _updateBadge();

        // Update Moneris virtual screen to show "processing" state
        if (state.activeBrand === 'moneris') {
            _updateMonerisScreen('Processing...', 'Please Wait');
        }

        // Auto-pulse the Terminal tab to get the operator's attention
        const terminalTabBtn = document.querySelector('[data-tab="terminal"]');
        if (terminalTabBtn) {
            terminalTabBtn.classList.add('tab-btn--pulse');
            setTimeout(() => terminalTabBtn.classList.remove('tab-btn--pulse'), 3000);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    function _cacheDOM() {
        elBrandSelect           = document.getElementById('terminal-brand-select');
        elLogList               = document.getElementById('terminal-log-list');
        elNoPending             = document.getElementById('terminal-no-pending');
        elBtnTapApproved        = document.getElementById('terminal-btn-tap-approved');
        elBtnInsertApproved     = document.getElementById('terminal-btn-insert-approved');
        elBtnSwipeApproved      = document.getElementById('terminal-btn-swipe-approved');
        elBtnPartialAuth        = document.getElementById('terminal-btn-partial-auth');
        elBtnSquareNotCaptured  = document.getElementById('terminal-btn-square-not-captured');
        elBtnDeclineNSF         = document.getElementById('terminal-btn-decline-nsf');
        elBtnDeclineStolen      = document.getElementById('terminal-btn-decline-stolen');
        elBtnDeclineExpired     = document.getElementById('terminal-btn-decline-expired');
        elBtnDeclineCVC         = document.getElementById('terminal-btn-decline-cvc');
        elBtnDeclineProcessing  = document.getElementById('terminal-btn-decline-processing');
        elBtnTimeout            = document.getElementById('terminal-btn-timeout');
        elPartialAuthInput      = document.getElementById('terminal-partial-auth-pct');
        elBadge                 = document.getElementById('terminal-tab-badge');
        // Engineer's Toolbar
        elEngineerToggle        = document.getElementById('engineer-toolbar-toggle');
        elEngineerToolbar       = document.getElementById('engineer-toolbar');
        elForceResultSelect     = document.getElementById('force-result-select');
        elSandboxStatusBadge    = document.getElementById('sandbox-status-badge');
        elSandboxConnectionRow  = document.getElementById('sandbox-connection-row');
        elSandboxConnectionText = document.getElementById('sandbox-connection-text');
        elStripeCardSelect      = document.getElementById('stripe-test-card-select');
        // Moneris-specific
        elMonerisCardSelect     = document.getElementById('moneris-test-card-select');
        elMonerisCardRow        = document.getElementById('moneris-card-row');
        elMonerisDisplaySection = document.getElementById('moneris-display-section');
        elMonerisScreenLine1    = document.getElementById('moneris-screen-line1');
        elMonerisScreenLine2    = document.getElementById('moneris-screen-line2');
        elMonerisPairingToken   = document.getElementById('moneris-pairing-token');
    }

    function _bindEvents() {
        if (elBrandSelect) {
            elBrandSelect.addEventListener('change', () => {
                state.activeBrand = elBrandSelect.value;
                _updateBrandVisibility();
                console.log('[TerminalSim] Brand changed to:', state.activeBrand);
            });
        }
        if (elPartialAuthInput) {
            elPartialAuthInput.addEventListener('change', () => {
                const v = parseInt(elPartialAuthInput.value, 10);
                if (v > 0 && v < 100) state.partialAuthPercent = v;
            });
        }

        _btn(elBtnTapApproved,       () => _sendResponse('approved',             'tap'));
        _btn(elBtnInsertApproved,     () => _sendResponse('approved',             'insert'));
        _btn(elBtnSwipeApproved,      () => _sendResponse('approved',             'swipe'));
        _btn(elBtnPartialAuth,        () => _sendResponse('partial_auth',         'tap'));
        _btn(elBtnSquareNotCaptured,  () => _sendResponse('approved_not_captured','tap'));
        _btn(elBtnDeclineNSF,         () => _sendResponse('declined',             'nsf'));
        _btn(elBtnDeclineStolen,      () => _sendResponse('declined',             'stolen'));
        _btn(elBtnDeclineExpired,     () => _sendResponse('declined',             'expired'));
        _btn(elBtnDeclineCVC,         () => _sendResponse('declined',             'cvc'));
        _btn(elBtnDeclineProcessing,  () => _sendResponse('declined',             'processing_error'));
        _btn(elBtnTimeout,            () => _sendResponse('timeout',              'timeout'));

        // ── Engineer's Toolbar ───────────────────────────────────────────────
        // Triple-click the gear icon to reveal the toolbar
        if (elEngineerToggle) {
            elEngineerToggle.addEventListener('click', () => {
                state.gearClickCount++;
                clearTimeout(state.gearClickTimer);
                state.gearClickTimer = setTimeout(() => { state.gearClickCount = 0; }, 600);
                if (state.gearClickCount >= 3) {
                    state.gearClickCount = 0;
                    if (elEngineerToolbar) {
                        const visible = elEngineerToolbar.style.display !== 'none';
                        elEngineerToolbar.style.display = visible ? 'none' : 'block';
                        elEngineerToggle.style.opacity  = visible ? '0.15' : '0.8';
                    }
                }
            });
        }

        // Force Result dropdown
        if (elForceResultSelect) {
            elForceResultSelect.addEventListener('change', () => {
                state.forceResult = elForceResultSelect.value;
            });
        }

        // Stripe test card selector — value is read by _stripeCardForOutcome() at response time
    }

    function _btn(el, handler) {
        if (el) el.addEventListener('click', handler);
    }

    /** Show/hide brand-specific buttons and UI based on active brand */
    function _updateBrandVisibility() {
        const brand = state.activeBrand;

        // Partial auth: Stripe, Square, Helcim support it
        const supportsPartial = ['stripe', 'square', 'helcim', 'chase'].includes(brand);
        if (elBtnPartialAuth) elBtnPartialAuth.style.display = supportsPartial ? '' : 'none';

        // Square "Approved Not Captured" (delayed capture) — Square only
        if (elBtnSquareNotCaptured) {
            elBtnSquareNotCaptured.style.display = brand === 'square' ? '' : 'none';
        }

        // Swipe: all brands support it
        if (elBtnSwipeApproved) elBtnSwipeApproved.style.display = '';

        // Moneris virtual display + card selector (only when Moneris selected)
        const isMoneris = brand === 'moneris';
        if (elMonerisDisplaySection) elMonerisDisplaySection.style.display = isMoneris ? '' : 'none';
        if (elMonerisCardRow)        elMonerisCardRow.style.display        = isMoneris ? '' : 'none';

        // Stripe card row: only for Stripe
        const stripeCardRow = document.getElementById('stripe-card-row');
        if (stripeCardRow) stripeCardRow.style.display = brand === 'stripe' ? '' : 'none';

        // Generate a pairing token when Moneris is first selected
        if (isMoneris && elMonerisPairingToken && !elMonerisPairingToken.textContent) {
            elMonerisPairingToken.textContent = _generatePairingToken();
        }
    }

    /** Generate a 9-character alphanumeric Moneris Cloud pairing token */
    function _generatePairingToken() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Moneris-style: no O,0,I,1
        let token = '';
        for (let i = 0; i < 9; i++) token += chars[Math.floor(Math.random() * chars.length)];
        return token;
    }

    /** Update the Moneris iPP320 virtual screen */
    function _updateMonerisScreen(line1, line2 = '') {
        if (elMonerisScreenLine1) elMonerisScreenLine1.textContent = line1;
        if (elMonerisScreenLine2) elMonerisScreenLine2.textContent = line2;
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
    function _amountCents(req) {
        return Math.round(parseFloat(req.amount) * 100);
    }
    function _partialCents(req) {
        return Math.round(_amountCents(req) * state.partialAuthPercent / 100);
    }

    /**
     * Build a vendor-accurate response payload.
     * @param {string} brand     - gateway brand key
     * @param {string} outcome   - 'approved' | 'declined' | 'timeout' | 'partial_auth' | 'approved_not_captured'
     * @param {string} method    - 'tap' | 'insert' | 'swipe' | 'nsf' | 'stolen' | 'expired' | 'cvc' | 'processing_error' | 'timeout'
     * @param {object} req       - the pending request object
     */
    function _buildVendorPayload(brand, outcome, method, req) {
        const isApproved    = outcome === 'approved';
        const isPartial     = outcome === 'partial_auth';
        const isNotCaptured = outcome === 'approved_not_captured';
        const isTimeout     = outcome === 'timeout';

        const totalCents   = _amountCents(req);
        const partialCents = _partialCents(req);
        const maskedPan    = '4111 **** **** ' + _numStr(4);
        const last4        = maskedPan.slice(-4);
        const now          = new Date().toISOString();

        switch (brand) {
            // ── Stripe ───────────────────────────────────────────────────────
            case 'stripe': {
                const piId = _uid('pi_', 24);
                const chId = _uid('ch_', 24);

                if (isApproved || isPartial) {
                    const authorizedCents = isPartial ? partialCents : totalCents;
                    return {
                        id: piId,
                        object: 'payment_intent',
                        status: isPartial ? 'requires_capture' : 'succeeded',
                        amount: totalCents,
                        amount_received: authorizedCents,
                        currency: (req.currency || 'CAD').toLowerCase(),
                        payment_method: _uid('pm_', 24),
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
                                    read_method: method === 'swipe' ? 'magnetic_stripe_fallback'
                                        : method === 'insert'       ? 'contact_emv'
                                        : 'contactless_emv',
                                }
                            },
                            partial_authorization: isPartial ? {
                                status: 'partially_authorized',
                                amount_requested: totalCents,
                                amount_authorized: authorizedCents,
                            } : null,
                        },
                        // Keep legacy charges.data shape for back-compat
                        charges: {
                            data: [{
                                id: chId,
                                paid: true,
                                amount: authorizedCents,
                                payment_method_details: {
                                    type: 'card_present',
                                    card_present: {
                                        brand: 'visa', last4, exp_month: 12, exp_year: 2027,
                                        read_method: method === 'swipe' ? 'magnetic_stripe_fallback'
                                            : method === 'insert' ? 'contact_emv' : 'contactless_emv',
                                    }
                                }
                            }]
                        },
                        created: Math.floor(Date.now() / 1000),
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
                            cvc:              'Your card\'s security code is incorrect.',
                            processing_error: 'An error occurred while processing your card.',
                            timeout:          'The operation timed out.',
                        }[method] ?? 'Your card was declined.',
                    },
                };
            }

            // ── Moneris ──────────────────────────────────────────────────────
            case 'moneris': {
                const transId = _numStr(13);
                const transDate = new Date().toISOString().slice(0, 10);         // YYYY-MM-DD
                const transTime = new Date().toTimeString().slice(0, 8);         // HH:MM:SS

                // Moneris response codes (§4 of implementation plan):
                //   027 = Approved
                //   101 = System Timeout (host unreachable — mpgHttpsPostStatus retry scenario)
                //   400 = Expired card
                //   402 = Stolen card
                //   475 = Processing error
                //   478 = CVD mismatch
                //   481 = Standard decline (NSF)
                //   914 = Terminal timeout (customer did not interact)
                const monerisCode = (isApproved || isPartial) ? '027'
                    : isTimeout ? '101'          // System Timeout — triggers status-check flow
                    : { nsf: '481', stolen: '402', expired: '400', cvc: '478', processing_error: '475' }[method] ?? '481';

                const monerisMsg = (isApproved || isPartial) ? 'APPROVED *'
                    : isTimeout ? 'SYSTEM TIMEOUT'
                    : { nsf: 'DECLINED', stolen: 'PICK UP CARD', expired: 'EXPIRED CARD', cvc: 'CVD FAILURE', processing_error: 'SYSTEM ERROR' }[method] ?? 'DECLINED';

                // AVS result codes: Y=full match, N=no match, null=not checked
                const avsResultCode = (isApproved || isPartial) ? 'Y' : 'N';
                // CVD result codes: 1=match, 2=mismatch, 3=not verified
                const cvdResultCode = (method === 'cvc') ? '2'
                    : (isApproved || isPartial)           ? '1'
                    : '3';

                return {
                    // Fields mapped by MonerisForm.vue
                    ResponseCode:     monerisCode,
                    Message:          monerisMsg,
                    TransID:          transId,
                    ReceiptId:        'REC-' + _numStr(6) + '-' + _numStr(4),
                    ReferenceNum:     '660' + _numStr(17),  // 20-char numeric reference
                    CardType:         'V',                  // V=Visa, M=MC, AX=Amex
                    txn_num:          transId,
                    ApprovalCode:     (isApproved || isPartial) ? _numStr(6) : null,
                    Ticket:           _uid('T', 8).toUpperCase(),
                    iso_code:         (isApproved || isPartial) ? '00' : (isTimeout ? '68' : '05'),
                    AvsResultCode:    avsResultCode,
                    CvdResultCode:    cvdResultCode,
                    // Receipt fields — mapped by TerminalBridge → printing.js
                    TransDate:        transDate,
                    TransTime:        transTime,
                    TransAmount:      parseFloat(req.amount).toFixed(2),
                    Complete:         (isApproved || isPartial) ? 'true' : 'false',
                    TimedOut:         isTimeout ? 'true' : 'false',
                    // Partial auth fields
                    requested_amount:  parseFloat(req.amount).toFixed(2),
                    authorized_amount: isPartial ? (partialCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
                };
            }

            // ── Square ───────────────────────────────────────────────────────
            case 'square': {
                const payId = _uid('', 32).toUpperCase();

                const squareStatus = isApproved          ? 'COMPLETED'
                    : isNotCaptured                      ? 'APPROVED'
                    : isPartial                          ? 'APPROVED'
                    : isTimeout                          ? 'CANCELED'
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

                return {
                    payment: {
                        id: payId,
                        status: squareStatus,
                        autocomplete: !isNotCaptured,
                        amount_money: { amount: totalCents, currency: req.currency || 'CAD' },
                        approved_money: {
                            amount: isPartial ? partialCents : totalCents,
                            currency: req.currency || 'CAD',
                        },
                        card_details: {
                            status:       squareCardStatus,
                            entry_method: method === 'swipe' ? 'SWIPED' : method === 'insert' ? 'CHIP' : 'CONTACTLESS',
                            card: {
                                card_brand:   'VISA',
                                last_4:       last4,
                                exp_month:    12,
                                exp_year:     2027,
                                fingerprint:  _uid('sq_fp_', 16),
                            },
                            avs_status: (isApproved || isPartial || isNotCaptured) ? 'AVS_MATCHED' : null,
                            cvv_status: method === 'cvc' ? 'CVV_FAILURE' : (isApproved || isPartial || isNotCaptured) ? 'CVV_MATCHED' : null,
                        },
                        location_id:  _uid('L', 13).toUpperCase(),
                        order_id:     _uid('', 32).toUpperCase(),
                        created_at:   now,
                        updated_at:   now,
                        receipt_url:  (isApproved || isPartial || isNotCaptured) ? `https://squareup.com/receipt/preview/${payId}` : null,
                        errors: (isApproved || isPartial || isNotCaptured) ? [] : [{
                            category: 'PAYMENT_METHOD_ERROR',
                            code:     squareErrorCode,
                            detail:   squareErrorDetail,
                        }],
                    }
                };
            }

            // ── Helcim ───────────────────────────────────────────────────────
            case 'helcim': {
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

                const approvedAmount = isPartial ? (partialCents / 100) : parseFloat(req.amount);

                return {
                    response:        (isApproved || isPartial) ? 1 : 0,
                    responseMessage: helcimMsg,
                    data: {
                        transactionId:  parseInt(_numStr(8)),
                        dateCreated:    now,
                        approvalCode:   (isApproved || isPartial) ? _numStr(6) : null,
                        cardType:       'visa',
                        cardNumber:     maskedPan,
                        cardExpiry:     '12/27',
                        cardToken:      (isApproved || isPartial) ? _uid('helcim_tok_', 16) : null,
                        currency:       req.currency || 'CAD',
                        amount:         approvedAmount,
                        requestedAmount: parseFloat(req.amount),
                        avsResponse:    (isApproved || isPartial) ? 'X' : null, // X = full match (street + ZIP)
                        cvvResponse:    method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null), // M=match, N=no match
                        invoice:        req.id,
                        terminalId:     _uid('HT', 6).toUpperCase(),
                        errors:         (isApproved || isPartial) ? null : [{ field: 'card', message: helcimMsg }],
                    }
                };
            }

            // ── Elavon / Converge ────────────────────────────────────────────
            case 'elavon': {
                const elavonResult  = (isApproved || isPartial) ? '0' : '1';
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

                // Elavon error codes
                const elavonErrorCode = {
                    nsf:              'E00012',
                    stolen:           'E00052',
                    expired:          'E00014',
                    cvc:              'E00044',
                    processing_error: 'E00013',
                    timeout:          'E00013',
                }[method] ?? 'E00012';

                return {
                    ssl_result:            elavonResult,
                    ssl_result_message:    elavonMsg,
                    ssl_txn_id:            _numStr(6) + 'C' + _numStr(2) + '-' + _uid('', 8).toUpperCase(),
                    ssl_approval_code:     (isApproved || isPartial) ? _numStr(6) : null,
                    ssl_card_type:         'VISA',
                    ssl_card_number:       maskedPan,
                    ssl_exp_date:          '1227',
                    ssl_amount:            parseFloat(req.amount).toFixed(2),
                    ssl_requested_amount:  parseFloat(req.amount).toFixed(2),
                    ssl_authorized_amount: isPartial ? (partialCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
                    ssl_salestax:          '0.00',
                    ssl_invoice_number:    req.id,
                    ssl_avs_response:      (isApproved || isPartial) ? 'X' : null,
                    ssl_cvv2_response:     method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                    ssl_entry_mode:        method === 'swipe' ? 'SWIPE' : method === 'insert' ? 'CHIP' : 'CONTACTLESS',
                    ssl_txn_time:          now,
                    errorCode:    (isApproved || isPartial) ? null : elavonErrorCode,
                    errorName:    (isApproved || isPartial) ? null : elavonMsg,
                    errorMessage: (isApproved || isPartial) ? null : elavonMsg,
                };
            }

            // ── Global Payments ──────────────────────────────────────────────
            case 'globalpayments': {
                // ISO 8583 response codes used by Global Payments
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

                return {
                    id:              _uid('txn_', 20),
                    result:          gpResult,
                    status:          (isApproved || isNotCaptured) ? 'CAPTURED' : isPartial ? 'PARTIALLY_CAPTURED' : 'FAILED',
                    amount:          parseFloat(req.amount).toFixed(2),
                    amount_authorized: isPartial ? (partialCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
                    currency:        req.currency || 'CAD',
                    batchNumber:     _numStr(6),
                    idempotencyKey:  _uid('idem_', 16),
                    duplicateRequest: false,
                    card: {
                        maskedNumber:    maskedPan,
                        expiry:          '1227',
                        cardholderName:  'TEST CARDHOLDER',
                        brand:           'VISA',
                        last4,
                        authCode:        (isApproved || isPartial || isNotCaptured) ? _numStr(6) : null,
                        entryMode:       method === 'swipe' ? 'SWIPE' : method === 'insert' ? 'CHIP' : 'CONTACTLESS',
                        avsResult:       (isApproved || isPartial || isNotCaptured) ? 'MATCHED' : null,
                        cvnResult:       method === 'cvc' ? 'NOT_MATCHED' : ((isApproved || isPartial || isNotCaptured) ? 'MATCHED' : null),
                    },
                    responseCode:    gpCode,
                    responseMessage: gpMsg,
                    timestamp:       now,
                };
            }

            // ── Chase / CyberSource OmniPay ──────────────────────────────────
            case 'chase': {
                // CyberSource reason codes per documentation
                const csReasonCode = (isApproved) ? '100'
                    : (isPartial)  ? '110'
                    : (isTimeout)  ? '151'
                    : {
                        nsf:              '204',
                        stolen:           '205',
                        expired:          '202',
                        cvc:              '230',
                        processing_error: '150',
                    }[method] ?? '200';

                const csDecision = csReasonCode === '100' || csReasonCode === '110'
                    ? 'ACCEPT'
                    : csReasonCode === '150' || csReasonCode === '151'
                    ? 'ERROR'
                    : 'DECLINE';

                return {
                    decision:      csDecision,
                    requestID:     _numStr(20),
                    requestToken:  _uid('Axj', 40),
                    reasonCode:    csReasonCode,
                    purchaseTotals: {
                        currency:         req.currency || 'CAD',
                        grandTotalAmount: parseFloat(req.amount).toFixed(2),
                    },
                    ccAuthReply: {
                        reasonCode:          csReasonCode,
                        amount:              (isPartial ? partialCents / 100 : parseFloat(req.amount)).toFixed(2),
                        authorizationCode:   (isApproved || isPartial) ? _numStr(6) : null,
                        avsCode:             (isApproved || isPartial) ? 'Y' : null,
                        avsCodeRaw:          (isApproved || isPartial) ? 'Y' : null,
                        cvCode:              method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                        cvCodeRaw:           method === 'cvc' ? 'N' : ((isApproved || isPartial) ? 'M' : null),
                        authorizedDateTime:  now,
                        processorResponse:   (isApproved || isPartial) ? '00' : '05',
                        cardCategory:        'VISA',
                    },
                    // Signature field (would be HMAC-SHA256 in production)
                    signature:             _uid('sig_', 40),
                    signed_field_names:    'decision,reasonCode,requestID,requestToken,purchaseTotals',
                };
            }

            // ── PayPal / Zettle ──────────────────────────────────────────────
            case 'paypal': {
                const zettleState = (isApproved || isPartial) ? 'PAID' : 'FAILED';

                const zettleErrorMsg = isTimeout ? 'Payment terminal timed out.'
                    : {
                        nsf:              'Payment declined: Insufficient funds.',
                        stolen:           'Payment declined: Card not accepted.',
                        expired:          'Payment declined: Expired card.',
                        cvc:              'Payment declined: CVV check failed.',
                        processing_error: 'Payment declined: Processing error.',
                    }[method] ?? 'Payment declined.';

                return {
                    uuid:      _uid('', 32),
                    state:     zettleState,
                    type:      'PAYMENT',
                    amount: {
                        value:      isPartial ? (partialCents / 100).toFixed(2) : parseFloat(req.amount).toFixed(2),
                        currencyId: req.currency || 'CAD',
                    },
                    requestedAmount: {
                        value:      parseFloat(req.amount).toFixed(2),
                        currencyId: req.currency || 'CAD',
                    },
                    cardPayment: {
                        maskedPan,
                        cardType:          'VISA',
                        entryMode:         method === 'swipe' ? 'MAGNETIC_STRIPE' : method === 'insert' ? 'CHIP' : 'CONTACTLESS',
                        statusMessage:     (isApproved || isPartial) ? 'APPROVED' : 'DECLINED',
                        authorizationCode: (isApproved || isPartial) ? _numStr(6) : null,
                        gratuityAmount:    0,   // Tip amount in minor units (cents)
                    },
                    references: {
                        paymentReference: req.id,
                        receiptReference: (isApproved || isPartial) ? _uid('R', 12).toUpperCase() : null,
                    },
                    refundFailureReason: null,
                    errorMessage: (isApproved || isPartial) ? null : zettleErrorMsg,
                    timestamp: now,
                };
            }

            // ── Fallback ─────────────────────────────────────────────────────
            default:
                return { outcome, method, timestamp: now };
        }
    }

    function _sendResponse(outcome, method) {
        if (state.pendingRequests.length === 0) {
            console.warn('[TerminalSim] No pending requests to respond to.');
            return;
        }

        const req = state.pendingRequests[0]; // peek — shift after dispatch

        // ── Stripe sandbox Push-to-Reader ─────────────────────────────────────
        if (state.environment === 'sandbox' && req.gateway === 'stripe' && req.payment_intent_id && req.reader_id) {
            const cardNumber = _stripeCardForOutcome(outcome, method);
            _callStripeSimulate(req, cardNumber, outcome, method);
            return;
        }

        // ── Moneris sandbox — real QA API call via moneris_simulate.php ───────
        if (state.environment === 'sandbox' && req.gateway === 'moneris') {
            _callMonerisSimulate(req, outcome, method);
            return;
        }

        _dispatchResponse(outcome, method, req);
    }

    /**
     * Return the Stripe test card number to use for stripe_simulate.php.
     * If the Engineer's Toolbar card selector has a value, that takes precedence
     * (operator explicitly chose a card).  Otherwise derive from outcome/method.
     */
    function _stripeCardForOutcome(outcome, method) {
        if (elStripeCardSelect && elStripeCardSelect.value) {
            return elStripeCardSelect.value;
        }
        if (outcome === 'approved' || outcome === 'approved_not_captured' || outcome === 'partial_auth') {
            return '4242424242424242';
        }
        return {
            nsf:              '4000000000009995',
            stolen:           '4000000000009987',
            expired:          '4000000000000069',
            cvc:              '4000000000000127',
            processing_error: '4000000000009995',
            timeout:          '4242424242424242',
        }[method] ?? '4242424242424242';
    }

    /**
     * POST to stripe_simulate.php, then dispatch the real PI result as the response.
     */
    function _callStripeSimulate(req, cardNumber, outcome, method) {
        // Determine the POS origin from state (set during init or from message)
        const posOrigin = state.posOrigin || 'http://localhost:8000';

        fetch(`${posOrigin}/api/stripe_simulate.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reader_id:          req.reader_id,
                payment_intent_id:  req.payment_intent_id,
                card_number:        cardNumber,
            }),
        })
        .then(r => r.json())
        .then(simResult => {
            state.pendingRequests.shift();
            const brand = state.activeBrand;

            // Build real vendor payload from the PHP stripe_simulate result
            // simResult.data is the standardized gateway response data
            const vendorPayload = simResult.data ?? _buildVendorPayload(brand, outcome, method, req);

            // Override outcome with actual result from PHP backend
            const realOutcome = simResult.outcome ?? outcome;

            const payload = {
                type:          'TERMINAL_SIMULATE_RESPONSE',
                requestId:     req.id,
                outcome:       realOutcome,
                method,
                reference:     simResult.transaction_id ?? req.payment_intent_id,
                gateway:       req.gateway,
                brand,
                timestamp:     new Date().toISOString(),
                vendorPayload,
                decline_code:  simResult.decline_code ?? null,
            };

            if (realOutcome !== 'approved' && realOutcome !== 'approved_not_captured') {
                payload.reason = simResult.message
                    ?? REASON_MESSAGES[simResult.decline_code]
                    ?? REASON_MESSAGES[method]
                    ?? 'Card declined.';
            }
            if (realOutcome === 'partial_auth') {
                const partialAmt = (_partialCents(req) / 100).toFixed(2);
                payload.reason          = REASON_MESSAGES.partial_auth;
                payload.partialAmount   = partialAmt;
                payload.remainingAmount = (parseFloat(req.amount) - parseFloat(partialAmt)).toFixed(2);
            }

            if (state.swPort) {
                state.swPort.postMessage(payload);
                console.log('[TerminalSim] Stripe sandbox response sent:', payload);
            }

            _markLogEntryResolved(req.id, realOutcome, method);
            _refreshButtonState();
            _updateBadge();
        })
        .catch(err => {
            console.error('[TerminalSim] stripe_simulate.php call failed:', err);
            // Fall back to mock response so the operator isn't stuck
            state.pendingRequests.shift();
            _dispatchResponseDirect(outcome, method, req);
        });
    }

    /**
     * Call moneris_simulate.php with the selected test card, get a real Moneris QA
     * API response, and dispatch it as the vendorPayload.
     *
     * Moneris QA test cards (store1 / yesguy / esqa.moneris.com):
     *   4005550000000019  Visa — always approved
     *   5454545454545454  MC   — always approved
     *   4111111111111111  Visa — approved (standard test card)
     * Decline outcomes are driven by expdate: 1100 triggers decline on QA.
     */
    function _callMonerisSimulate(req, outcome, method) {
        const posOrigin = state.posOrigin || 'http://localhost:8000';

        // Pick test card from the Engineer's Toolbar selector, or derive from outcome
        let pan     = (elMonerisCardSelect && elMonerisCardSelect.value) ? elMonerisCardSelect.value : '4005550000000019';
        let expdate = '2512'; // YYMM — valid future date → approved on QA

        // Force a decline on QA by using expdate=1100 (past date) for decline outcomes
        if (outcome === 'declined' || outcome === 'timeout') {
            expdate = '1100';
        }

        fetch(`${posOrigin}/api/moneris_simulate.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount:   req.amount,
                pan,
                expdate,
                order_id: req.orderId ?? ('SIM-' + Date.now()),
            }),
        })
        .then(r => r.json())
        .then(simResult => {
            state.pendingRequests.shift();

            const vendorPayload = simResult.data ?? _buildVendorPayload('moneris', outcome, method, req);
            const realOutcome   = simResult.outcome ?? outcome;

            const payload = {
                type:          'TERMINAL_SIMULATE_RESPONSE',
                requestId:     req.id,
                outcome:       realOutcome,
                method,
                reference:     simResult.transaction_id ?? ('moneris_' + Date.now()),
                gateway:       req.gateway,
                brand:         'moneris',
                timestamp:     new Date().toISOString(),
                vendorPayload,
            };

            if (realOutcome !== 'approved') {
                payload.reason = simResult.message ?? REASON_MESSAGES[method] ?? 'Card declined.';
            }

            if (state.swPort) state.swPort.postMessage(payload);

            _updateMonerisScreenForOutcome(realOutcome);
            _markLogEntryResolved(req.id, realOutcome, method);
            _refreshButtonState();
            _updateBadge();
        })
        .catch(err => {
            console.error('[TerminalSim] moneris_simulate.php failed, falling back to mock:', err);
            state.pendingRequests.shift();
            _dispatchResponseDirect(outcome, method, req);
        });
    }

    /** Update the Moneris screen after a response is resolved */
    function _updateMonerisScreenForOutcome(outcome) {
        if (outcome === 'approved') {
            _updateMonerisScreen('APPROVED', 'Remove Card');
            setTimeout(() => _updateMonerisScreen('Moneris', 'Welcome'), 3000);
        } else if (outcome === 'timeout') {
            _updateMonerisScreen('SYSTEM TIMEOUT', 'Please Retry');
            setTimeout(() => _updateMonerisScreen('Moneris', 'Welcome'), 4000);
        } else {
            _updateMonerisScreen('DECLINED', 'See Attendant');
            setTimeout(() => _updateMonerisScreen('Moneris', 'Welcome'), 3000);
        }
    }

    function _dispatchResponse(outcome, method, req) {
        state.pendingRequests.shift();
        _dispatchResponseDirect(outcome, method, req);
    }

    function _dispatchResponseDirect(outcome, method, req) {
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
            vendorPayload,
        };

        // Set a human-readable reason for the POS form to display
        if (outcome !== 'approved' && outcome !== 'approved_not_captured') {
            payload.reason = REASON_MESSAGES[method] ?? REASON_MESSAGES[outcome] ?? 'Card declined.';
        }
        if (outcome === 'partial_auth') {
            const partialAmt = (_partialCents(req) / 100).toFixed(2);
            payload.reason        = REASON_MESSAGES.partial_auth;
            payload.partialAmount = partialAmt;
            payload.remainingAmount = (parseFloat(req.amount) - parseFloat(partialAmt)).toFixed(2);
        }

        if (state.swPort) {
            state.swPort.postMessage(payload);
            console.log('[TerminalSim] Sent response:', payload);
        } else {
            console.error('[TerminalSim] SW port not available — cannot send response.');
        }

        if (state.activeBrand === 'moneris') _updateMonerisScreenForOutcome(outcome);
        _markLogEntryResolved(req.id, outcome, method);
        _refreshButtonState();
        _updateBadge();
    }

    function _addLogEntry(req) {
        if (!elLogList) return;
        if (elNoPending) elNoPending.style.display = 'none';

        const li = document.createElement('li');
        li.className = 'terminal-log-entry terminal-log-entry--pending';
        li.id        = 'terminal-entry-' + req.id;
        li.innerHTML = `
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
            const icon = outcome === 'approved' ? '✅'
                : outcome === 'partial_auth'         ? '🔶'
                : outcome === 'approved_not_captured' ? '🔒'
                : outcome === 'declined'              ? '❌'
                : '⏰';
            statusEl.textContent = `${icon} ${outcome.replace(/_/g, ' ')} (${method})`;
            statusEl.className   = `log-status log-status--${outcome}`;
        }
    }

    function _refreshButtonState() {
        const hasPending = state.pendingRequests.length > 0;
        const brand = state.activeBrand;

        const allBtns = [
            elBtnTapApproved, elBtnInsertApproved, elBtnSwipeApproved,
            elBtnDeclineNSF, elBtnDeclineStolen, elBtnDeclineExpired,
            elBtnDeclineCVC, elBtnDeclineProcessing,
            elBtnTimeout,
        ];
        allBtns.forEach(btn => { if (btn) btn.disabled = !hasPending; });

        // Conditional buttons
        const supportsPartial = ['stripe', 'square', 'helcim', 'chase'].includes(brand);
        if (elBtnPartialAuth)       { elBtnPartialAuth.disabled       = !hasPending || !supportsPartial; }
        if (elBtnSquareNotCaptured) { elBtnSquareNotCaptured.disabled = !hasPending || brand !== 'square'; }

        if (elNoPending && state.pendingRequests.length === 0 && (!elLogList || elLogList.children.length === 0)) {
            elNoPending.style.display = '';
        }

        // Initial brand visibility
        _updateBrandVisibility();
    }

    function _updateBadge() {
        if (!elBadge) return;
        const count = state.pendingRequests.length;
        elBadge.textContent   = count > 0 ? String(count) : '';
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

    function _updateSandboxBadge(environment) {
        if (!elSandboxStatusBadge) return;
        if (environment === 'sandbox') {
            elSandboxStatusBadge.textContent = '● Sandbox';
            elSandboxStatusBadge.className   = 'sandbox-badge sandbox';
            if (elSandboxConnectionRow)  elSandboxConnectionRow.style.display  = '';
            if (elSandboxConnectionText) elSandboxConnectionText.textContent =
                'Connected to sandbox — responses will call real sandbox APIs via PHP backend.';
        } else {
            elSandboxStatusBadge.textContent = '● Mock Mode';
            elSandboxStatusBadge.className   = 'sandbox-badge mock';
            if (elSandboxConnectionRow)  elSandboxConnectionRow.style.display  = 'none';
        }
    }

})();
