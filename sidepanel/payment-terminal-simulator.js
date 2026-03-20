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
        const reqId = data.requestId ?? ('req_' + Date.now());

        // Deduplicate: ignore retries for a requestId already in the queue
        if (state.pendingRequests.some(r => r.id === reqId)) {
            console.log('[TerminalSim] Duplicate requestId ignored:', reqId);
            return;
        }

        const req = {
            id:               reqId,
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

        // Shared buttons: partial auth supported by Stripe, Square, Helcim, Chase
        const supportsPartial = ['stripe', 'square', 'helcim', 'chase'].includes(brand);
        if (elBtnPartialAuth) elBtnPartialAuth.style.display = supportsPartial ? '' : 'none';

        // Square "Approved Not Captured" (delayed capture) — Square only
        if (elBtnSquareNotCaptured) {
            elBtnSquareNotCaptured.style.display = brand === 'square' ? '' : 'none';
        }

        // Swipe: all brands support it
        if (elBtnSwipeApproved) elBtnSwipeApproved.style.display = '';

        // Delegate brand-specific UI (card selectors, virtual displays, etc.)
        // to each simulator's updateUI(show) method
        const sims = window.TerminalSimulators ?? {};
        Object.entries(sims).forEach(([b, sim]) => {
            if (typeof sim.updateUI === 'function') sim.updateUI(b === brand);
        });
    }

    /** Update the Moneris iPP320 virtual screen */
    function _updateMonerisScreen(line1, line2 = '') {
        if (elMonerisScreenLine1) elMonerisScreenLine1.textContent = line1;
        if (elMonerisScreenLine2) elMonerisScreenLine2.textContent = line2;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vendor-accurate response payload builder (router)
    // Payload construction is delegated to per-brand files in simulators/*.js
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Route to the brand simulator registered in window.TerminalSimulators.
     * @param {string} brand           - gateway brand key
     * @param {string} outcome         - 'approved' | 'declined' | 'timeout' | 'partial_auth' | 'approved_not_captured'
     * @param {string} method          - 'tap' | 'insert' | 'swipe' | 'nsf' | 'stolen' | 'expired' | 'cvc' | 'processing_error' | 'timeout'
     * @param {object} req             - the full pending request object (amount, currency, orderId, posOrigin, payment_intent_id, reader_id, …)
     */
    function _buildVendorPayload(brand, outcome, method, req) {
        const sim = window.TerminalSimulators?.[brand];
        if (!sim) {
            console.warn('[TerminalSim] No simulator registered for brand:', brand);
            return { outcome, method, timestamp: new Date().toISOString() };
        }
        return sim.buildPayload(outcome, method, req, state.partialAuthPercent);
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
                const partialAmt = (window.TerminalSimulatorHelpers.partialCents(req, state.partialAuthPercent) / 100).toFixed(2);
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
            const partialAmt = (window.TerminalSimulatorHelpers.partialCents(req, state.partialAuthPercent) / 100).toFixed(2);
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
