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
        debug: false,           // mirrors POS terminal_debug_enabled flag
        posOrigin: 'http://localhost:8000',  // POS server origin for stripe_simulate.php calls
        gearClickCount: 0,      // triple-click counter to reveal toolbar
        gearClickTimer: null,
        virtualIp: null,        // assigned on init from chrome.storage.local
        posHandshakeValid: false, // true when POS IP matches virtualIp and enabled=true
        // Moneris Cloud API token cache
        monerisToken: null,         // cached Bearer token string
        monerisTokenExpiry: 0,      // ms timestamp after which the token must be refreshed
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
        elMonerisPairingToken, elMonerisDisplaySection,
        // Moneris Cloud API credential inputs (always-visible section)
        elExtEnvironmentSelect,
        elMonerisClientId, elMonerisClientSecret, elMonerisMerchantId,
        elMonerisSaveCredentials, elMonerisCredStatus, elMonerisCredSection,
        // Virtual IP display and terminal status light
        elVirtualIpSpan, elTerminalStatus;

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

        // Load or generate a persistent virtual IP for this simulator instance.
        // chrome.storage.local is used so the same IP survives panel reloads.
        chrome.storage.local.get(
            ['terminalVirtualIp', 'terminalEnvironment', 'monerisClientId', 'monerisClientSecret', 'monerisMerchantId'],
            function (result) {
                if (result.terminalVirtualIp) {
                    state.virtualIp = result.terminalVirtualIp;
                } else {
                    // Generate a random address in 192.168.100.2–254
                    const octet = Math.floor(Math.random() * 253) + 2;
                    state.virtualIp = '192.168.100.' + octet;
                    chrome.storage.local.set({ terminalVirtualIp: state.virtualIp });
                }
                _cacheDOM();
                _bindEvents();
                _refreshButtonState();
                _renderVirtualIp();

                // Restore persisted environment and credentials
                if (result.terminalEnvironment) {
                    state.environment = result.terminalEnvironment;
                    if (elExtEnvironmentSelect) elExtEnvironmentSelect.value = result.terminalEnvironment;
                    _updateSandboxBadge(result.terminalEnvironment);
                }
                if (elMonerisClientId     && result.monerisClientId)     elMonerisClientId.value     = result.monerisClientId;
                if (elMonerisClientSecret && result.monerisClientSecret) elMonerisClientSecret.value = result.monerisClientSecret;
                if (elMonerisMerchantId   && result.monerisMerchantId)   elMonerisMerchantId.value   = result.monerisMerchantId;

                console.log('[TerminalSim] Initialized. Virtual IP:', state.virtualIp, '| Environment:', state.environment);
            }
        );
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
        if (typeof data.debug === 'boolean') {
            state.debug = data.debug;
            window.TerminalSimulatorDebug = data.debug;
            if (data.debug) {
                console.log('[TerminalSim] Debug Mode Active — verbose logging enabled.');
            }
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
            if (state.debug) {
                console.log('[TerminalSim][Moneris] iPP320 screen transition → Processing...', {
                    reqId: req.id, amount: req.amount,
                });
            }
        }

        // Auto-pulse the Terminal tab to get the operator's attention
        const terminalTabBtn = document.querySelector('[data-tab="terminal"]');
        if (terminalTabBtn) {
            terminalTabBtn.classList.add('tab-btn--pulse');
            setTimeout(() => terminalTabBtn.classList.remove('tab-btn--pulse'), 3000);
        }
    };

    /**
     * Called by panel.js when a SQUARE_POS_MOCK_REQUEST message arrives from the SW.
     * Adds the Square POS API app-switch request to the approval queue using the
     * same shared operator UI as normal terminal charge requests.
     *
     * The nonce (instead of payment_intent_id/reader_id) is stored on the req object
     * so _dispatchResponseDirect() can route the response correctly.
     *
     * @param {object} data - { nonce, amount, currency, callbackUrl, timestamp }
     */
    window.handleSquarePOSMockRequest = function (data) {
        const req = {
            id:        'sqpos_' + Date.now(),
            gateway:   'square_pos',
            amount:    typeof data.amount === 'number' ? data.amount.toFixed(2) : (data.amount ?? '0.00'),
            currency:  data.currency ?? 'CAD',
            nonce:     data.nonce,
            orderId:   null,
            timestamp: new Date().toLocaleTimeString(),
            // Not used for routing but kept for display consistency
            payment_intent_id: null,
            reader_id:         null,
        };

        state.pendingRequests.push(req);
        _addLogEntry(req);
        _refreshButtonState();
        _updateBadge();

        if (state.debug) {
            console.log('[TerminalSim] Square POS mock request queued', req);
        }
    };

    /**
     * Called by panel.js when a TERMINAL_READY_SIGNAL message arrives from the SW.
     * Updates the connection status light based on whether the POS's configured IP
     * matches this simulator's assigned virtual IP and the terminal is enabled.
     *
     * @param {object} data - { enabled, brand, debug, terminalIp }
     */
    window.handleTerminalReadySignal = function (data) {
        const ipMatch     = !!(data.terminalIp && data.terminalIp === state.virtualIp);
        const shouldConnect = !!(data.enabled && ipMatch);

        state.posHandshakeValid = shouldConnect;

        // Update the terminal status light in the panel header.
        // Use a direct getElementById query instead of the cached reference to avoid
        // a null reference if this signal arrives before chrome.storage.local.get completes.
        const terminalStatus = document.getElementById('terminal-status');
        if (terminalStatus) {
            if (shouldConnect) {
                terminalStatus.classList.add('connected');
            } else {
                terminalStatus.classList.remove('connected');
            }
        }

        // Sync brand from POS settings so the simulator stays in step
        if (data.brand && data.brand !== state.activeBrand) {
            state.activeBrand = data.brand;
            if (elBrandSelect) elBrandSelect.value = data.brand;
            _updateBrandVisibility();
        }

        // Sync debug flag from POS settings
        if (typeof data.debug === 'boolean') {
            state.debug = data.debug;
            window.TerminalSimulatorDebug = data.debug;
        }

        if (state.debug) {
            console.log('[TerminalSim] handleTerminalReadySignal:', {
                receivedIp:    data.terminalIp,
                virtualIp:     state.virtualIp,
                ipMatch,
                enabled:       data.enabled,
                shouldConnect,
            });
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Writes the assigned virtual IP to the display span in the terminal panel. */
    function _renderVirtualIp() {
        if (elVirtualIpSpan && state.virtualIp) {
            elVirtualIpSpan.textContent = state.virtualIp;
        }
    }

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
        // Moneris Cloud API credentials section
        elExtEnvironmentSelect  = document.getElementById('ext-environment-select');
        elMonerisClientId       = document.getElementById('moneris-client-id');
        elMonerisClientSecret   = document.getElementById('moneris-client-secret');
        elMonerisMerchantId     = document.getElementById('moneris-merchant-id');
        elMonerisSaveCredentials= document.getElementById('moneris-save-credentials');
        elMonerisCredStatus     = document.getElementById('moneris-cred-status');
        elMonerisCredSection    = document.getElementById('moneris-credentials-section');
        // Virtual IP display and terminal status light
        elVirtualIpSpan         = document.getElementById('terminal-virtual-ip');
        elTerminalStatus        = document.getElementById('terminal-status');
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

        // ── Environment selector ─────────────────────────────────────────────
        if (elExtEnvironmentSelect) {
            elExtEnvironmentSelect.addEventListener('change', () => {
                state.environment = elExtEnvironmentSelect.value;
                chrome.storage.local.set({ terminalEnvironment: state.environment });
                _updateSandboxBadge(state.environment);
                if (state.debug) {
                    console.log('[TerminalSim] Environment set to:', state.environment);
                }
            });
        }

        // ── Moneris credentials save button ─────────────────────────────────
        if (elMonerisSaveCredentials) {
            elMonerisSaveCredentials.addEventListener('click', () => {
                const clientId     = elMonerisClientId     ? elMonerisClientId.value.trim()     : '';
                const clientSecret = elMonerisClientSecret ? elMonerisClientSecret.value         : '';
                const merchantId   = elMonerisMerchantId   ? elMonerisMerchantId.value.trim()   : '';

                chrome.storage.local.set({
                    monerisClientId:     clientId,
                    monerisClientSecret: clientSecret,
                    monerisMerchantId:   merchantId,
                }, () => {
                    // Invalidate token cache so next request gets a fresh token
                    state.monerisToken       = null;
                    state.monerisTokenExpiry = 0;

                    if (elMonerisCredStatus) {
                        elMonerisCredStatus.textContent = 'Saved ✓';
                        elMonerisCredStatus.style.color = '#16a34a';
                        setTimeout(() => { elMonerisCredStatus.textContent = ''; }, 4000);
                    }
                    if (state.debug) {
                        console.log('[TerminalSim][Moneris] Credentials saved to chrome.storage.local');
                    }
                });
            });
        }

        // Stripe test card selector — value is read by _stripeCardForOutcome() at response time

        // ── Transaction Log toolbar ──────────────────────────────────────────
        document.getElementById('terminal-log-export')?.addEventListener('click', _exportLog);
        document.getElementById('terminal-log-clear')?.addEventListener('click',  _clearLog);
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
        if (state.debug) {
            console.log('[TerminalSim] _buildVendorPayload', { brand, outcome, method, req });
        }
        const sim = window.TerminalSimulators?.[brand];
        if (!sim) {
            console.warn('[TerminalSim] No simulator registered for brand:', brand);
            return { outcome, method, timestamp: new Date().toISOString() };
        }
        return sim.buildPayload(outcome, method, req, state.partialAuthPercent);
    }

    function _sendResponse(outcome, method) {
        if (state.debug) {
            console.log('[TerminalSim] _sendResponse called', { outcome, method, pendingCount: state.pendingRequests.length });
        }
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
     * Call the Moneris Cloud API directly from the extension (no PHP proxy).
     *
     * Sandbox penny-value rules (amount controls outcome, not card number):
     *   $11.00 (1100 cents) → guaranteed approve
     *   $51.00 (5100 cents) → guaranteed decline
     *
     * OAuth token is cached in state for up to 24 h (with a 5-min buffer).
     */
    async function _callMonerisSimulate(req, outcome, method) {
        try {
            const token = await _getMonerisToken();

            // Resolve the correct amount and card number based on outcome and operator selection
            const { amountCents, cardNumber } = _resolveAmountAndCard(req, outcome, method);

            // Sanitise orderId — only alphanumeric, dashes, underscores; max 50 chars
            const rawOrderId = req.orderId ?? ('SIM-' + Date.now());
            const orderId    = rawOrderId.replace(/[^a-zA-Z0-9\-_]/g, '').substring(0, 50);

            const body = {
                idempotencyKey: _generateUUID(),
                orderId,
                amount: { amount: amountCents, currency: req.currency ?? 'CAD' },
                automaticCapture: true,
                paymentMethod: {
                    paymentMethodSource: 'CARD',
                    card: {
                        cardNumber,
                        expiryMonth: 12,
                        expiryYear:  2026,
                        cardSecurityCode: '123',
                    },
                    storePaymentMethod: 'DO_NOT_STORE',
                },
            };

            if (state.debug) {
                console.log('[TerminalSim][Moneris] Cloud API request', { orderId, amountCents, cardNumber });
            }

            const merchantId = (elMonerisMerchantId?.value.trim()) || '0030200110408';

            const res    = await fetch('https://api.sb.moneris.io/payments', {
                method: 'POST',
                headers: {
                    'Authorization':  'Bearer ' + token,
                    'Api-Version':    '2025-08-14',
                    'X-Merchant-Id':  merchantId,
                    'Content-Type':   'application/json',
                    'Accept':         'application/json',
                },
                body: JSON.stringify(body),
            });

            const parsed = await res.json();

            if (state.debug) {
                console.log('[TerminalSim][Moneris] Cloud API response', { status: res.status, parsed });
            }

            // Map Cloud API outcome to simulator outcome
            let realOutcome;
            if (parsed.paymentStatus === 'SUCCEEDED') {
                realOutcome = 'approved';
            } else if (parsed.paymentStatus === 'DECLINED' || res.status === 422) {
                realOutcome = 'declined';
            } else {
                realOutcome = outcome; // fallback to operator's intent
            }

            const isApproved = realOutcome === 'approved';
            const now = new Date();

            // Normalise Cloud API response into the legacy vendorPayload shape
            // that MonerisForm.vue reads (ResponseCode, TransID, ApprovalCode, etc.)
            const vendorPayload = {
                ResponseCode:      isApproved ? '027' : '481',
                Message:           parsed.transactionDetails?.message ?? (isApproved ? 'APPROVED' : 'DECLINED'),
                TransID:           parsed.paymentId ?? ('SIM-' + Date.now()),
                ApprovalCode:      parsed.transactionDetails?.authorizationCode ?? null,
                ReferenceNum:      parsed.paymentId ?? ('moneris_' + Date.now()),
                ReceiptId:         'REC-' + Date.now(),
                CardType:          'V',
                AvsResultCode:     isApproved ? 'Y' : 'N',
                CvdResultCode:     isApproved ? '1' : '3',
                TransDate:         now.toISOString().split('T')[0],
                TransTime:         now.toTimeString().split(' ')[0],
                Complete:          isApproved ? 'true' : 'false',
                TimedOut:          'false',
                requested_amount:  req.amount,
                authorized_amount: isApproved ? req.amount : '0.00',
                iso_code:          isApproved ? '00' : '05',
                txn_num:           parsed.paymentId ?? null,
            };

            state.pendingRequests.shift();

            const payload = {
                type:          'TERMINAL_SIMULATE_RESPONSE',
                requestId:     req.id,
                outcome:       realOutcome,
                method,
                reference:     parsed.paymentId ?? ('moneris_' + Date.now()),
                gateway:       req.gateway,
                brand:         'moneris',
                timestamp:     new Date().toISOString(),
                vendorPayload,
                rawResponse:   parsed,
            };

            if (!isApproved) {
                payload.reason = REASON_MESSAGES[method] ?? REASON_MESSAGES[realOutcome] ?? 'Card declined.';
            }

            if (state.swPort) state.swPort.postMessage(payload);

            _updateMonerisScreenForOutcome(realOutcome);
            _markLogEntryResolved(req.id, realOutcome, method, {
                transId:      vendorPayload.TransID,
                authCode:     vendorPayload.ApprovalCode,
                cardLast4:    cardNumber.slice(-4),
                isoCode:      parsed.transactionDetails?.isoResponseCode,
                responseCode: parsed.transactionDetails?.responseCode,
                rawResponse:  parsed,
            });
            _refreshButtonState();
            _updateBadge();

        } catch (err) {
            console.error('[TerminalSim] Moneris Cloud API call failed, falling back to mock:', err);
            state.pendingRequests.shift();
            _dispatchResponseDirect(outcome, method, req);
        }
    }

    /**
     * Fetch an OAuth2 client-credentials token from the Moneris Cloud API.
     * Caches it in state until 5 minutes before expiry.
     */
    async function _getMonerisToken() {
        const now = Date.now();
        if (state.monerisToken && now < state.monerisTokenExpiry) {
            return state.monerisToken;
        }

        // Read credentials from the extension UI (fallback to sandbox demo credentials)
        const clientId     = (elMonerisClientId?.value.trim())     || '40d7f86d-81fa-432e-ab9c-fd32570553f5';
        const clientSecret = (elMonerisClientSecret?.value.trim()) || '6Cb8Q~ZIGLGYuOo1DD-yftWpFb_llqpyFYsp-aBH';

        const formBody = new URLSearchParams({
            grant_type:    'client_credentials',
            client_id:     clientId,
            client_secret: clientSecret,
            scope:         'payment.write',
        }).toString();

        const res    = await fetch('https://api.sb.moneris.io/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody,
        });
        const parsed = await res.json();

        if (!parsed.access_token) {
            throw new Error('[TerminalSim] Moneris OAuth failed: ' + JSON.stringify(parsed));
        }

        state.monerisToken       = parsed.access_token;
        // expires_in is seconds; subtract 5-min buffer, convert to ms
        state.monerisTokenExpiry = now + (parseInt(parsed.expires_in, 10) - 300) * 1000;

        if (state.debug) {
            console.log('[TerminalSim][Moneris] OAuth token refreshed. Expires in:', parsed.expires_in, 's');
        }

        return state.monerisToken;
    }

    /** Generate a UUID v4 for idempotencyKey. */
    function _generateUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    /** Update the Moneris screen after a response is resolved */
    function _updateMonerisScreenForOutcome(outcome) {
        if (state.debug) {
            console.log('[TerminalSim][Moneris] iPP320 screen transition → outcome:', outcome);
        }
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
        // ── Square POS API (App-Switch) mock path ─────────────────────────────
        // These requests use a separate response message type (SQUARE_POS_MOCK_RESPONSE)
        // so they never collide with the terminal charge flow.
        if (req.gateway === 'square_pos') {
            const payload = window.TerminalSimulators.square_pos.buildPayload(outcome, method, req);
            const response = {
                type:                  'SQUARE_POS_MOCK_RESPONSE',
                nonce:                 req.nonce,
                outcome:               (outcome === 'approved') ? 'approved' : 'declined',
                transaction_id:        payload.transaction_id,
                client_transaction_id: payload.client_transaction_id,
                error_code:            payload.error_code,
                error_description:     payload.error_description,
            };
            if (state.swPort) {
                state.swPort.postMessage(response);
                if (state.debug) {
                    console.log('[TerminalSim] Sent Square POS mock response:', response);
                }
            } else {
                console.error('[TerminalSim] SW port not available — cannot send Square POS response.');
            }
            _markLogEntryResolved(req.id, outcome, method);
            _refreshButtonState();
            _updateBadge();
            return;
        }
        // ─────────────────────────────────────────────────────────────────────

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

        // Build DOM manually to avoid innerHTML (no XSS risk from req fields)
        const makeSpan = (cls, text) => {
            const s = document.createElement('span');
            s.className   = cls;
            s.textContent = text;
            return s;
        };

        li.appendChild(makeSpan('log-time',    req.timestamp));
        li.appendChild(makeSpan('log-gateway', _gatewayLabel(req.gateway)));
        li.appendChild(makeSpan('log-amount',  req.currency + ' $' + req.amount));
        li.appendChild(makeSpan('log-status log-status--pending', '⏳ Waiting'));
        li.appendChild(makeSpan('log-txn-id',  ''));
        li.appendChild(makeSpan('log-auth-code', ''));

        const expandBtn = document.createElement('button');
        expandBtn.className   = 'log-expand-btn';
        expandBtn.textContent = '▶ Details';
        expandBtn.style.display = 'none';
        li.appendChild(expandBtn);

        const rawPre = document.createElement('pre');
        rawPre.className    = 'log-raw-json';
        rawPre.style.display = 'none';
        li.appendChild(rawPre);

        expandBtn.addEventListener('click', () => {
            const expanded = rawPre.style.display !== 'none';
            rawPre.style.display  = expanded ? 'none' : 'block';
            expandBtn.textContent = expanded ? '▶ Details' : '▼ Hide';
        });

        elLogList.insertBefore(li, elLogList.firstChild);
    }

    /**
     * Resolve the amountCents and cardNumber to send to the Moneris Cloud API.
     * Static Visa override cards always approve/decline regardless of amount — so the
     * actual transaction amount is passed through unchanged. Penny-amount cards
     * (Visa 4242, Mastercard 5454) use the configured amounts to force outcomes.
     */
    function _resolveAmountAndCard(req, outcome, method) {
        const actualCents  = Math.round(parseFloat(req.amount) * 100);
        const selectedCard = elMonerisCardSelect?.value?.trim() || '';

        const VISA_ALWAYS_APPROVE = new Set([
            '4502285070000007', '4924190000003750',
            '4551210032790206', '4924190000000145', '4524000000015080',
        ]);
        const VISA_ALWAYS_DECLINE = new Set([
            '4485621544903528', '4355310002576375',
            '4716091243227333', '4556462273286718', '4217048416210847',
        ]);

        // Operator explicitly picked a static-override card — use actual amount
        if (selectedCard && (VISA_ALWAYS_APPROVE.has(selectedCard) || VISA_ALWAYS_DECLINE.has(selectedCard))) {
            return { amountCents: actualCents, cardNumber: selectedCard };
        }

        switch (outcome) {
            case 'approved':
            case 'partial_auth':
                // 4502285070000007 = always approve regardless of amount
                return { amountCents: actualCents, cardNumber: '4502285070000007' };

            case 'declined': {
                const methodCardMap = {
                    nsf:              '4485621544903528',
                    expired:          '4355310002576375',
                    stolen:           '4716091243227333',
                    cvc:              '4716091243227333',
                    processing_error: '4485621544903528',
                };
                // Mastercard 5454 has no static override — use penny amounts
                if (selectedCard === '5454545454545454') {
                    const mcPenny = { nsf: 5, expired: 5, stolen: 43, default: 5 };
                    return { amountCents: mcPenny[method] ?? mcPenny.default, cardNumber: selectedCard };
                }
                return { amountCents: actualCents, cardNumber: methodCardMap[method] ?? '4485621544903528' };
            }

            case 'timeout':
                // 68 cents triggers System Timeout in Moneris sandbox
                return { amountCents: 68, cardNumber: '4242424242424242' };

            default:
                return { amountCents: actualCents, cardNumber: selectedCard || '4242424242424242' };
        }
    }

    function _exportLog() {
        const entries = Array.from(elLogList?.querySelectorAll('.terminal-log-entry') ?? []);
        const rows = entries.map(el => ({
            time:        el.querySelector('.log-time')?.textContent ?? null,
            gateway:     el.querySelector('.log-gateway')?.textContent ?? null,
            amount:      el.querySelector('.log-amount')?.textContent ?? null,
            status:      el.querySelector('.log-status')?.textContent ?? null,
            txnId:       el.querySelector('.log-txn-id')?.textContent ?? null,
            authCode:    el.querySelector('.log-auth-code')?.textContent ?? null,
            rawResponse: (() => {
                const raw = el.querySelector('.log-raw-json')?.textContent?.trim();
                if (!raw) return null;
                try { return JSON.parse(raw.replace(/^.*?\n\n/s, '')); } catch { return raw; }
            })(),
        }));
        const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: 'moneris-session-log-' + Date.now() + '.json',
        });
        a.click();
        URL.revokeObjectURL(url);
    }

    function _clearLog() {
        if (elLogList) elLogList.innerHTML = '';
        if (elNoPending) elNoPending.style.display = '';
    }

    function _markLogEntryResolved(reqId, outcome, method, extras = {}) {
        const li = document.getElementById('terminal-entry-' + reqId);
        if (!li) return;

        li.classList.remove('terminal-log-entry--pending');
        li.classList.add('terminal-log-entry--' + outcome);

        const statusEl = li.querySelector('.log-status');
        if (statusEl) {
            const icon = outcome === 'approved' ? '✅'
                : outcome === 'partial_auth'          ? '🔶'
                : outcome === 'approved_not_captured' ? '🔒'
                : outcome === 'declined'              ? '❌'
                : '⏰';
            statusEl.textContent = `${icon} ${outcome.replace(/_/g, ' ')} (${method})`;
            statusEl.className   = `log-status log-status--${outcome}`;
        }

        // Populate inline transaction ID and auth code (if provided)
        const txnEl  = li.querySelector('.log-txn-id');
        const authEl = li.querySelector('.log-auth-code');
        if (txnEl  && extras.transId)   txnEl.textContent  = 'ID: '   + extras.transId;
        if (authEl && extras.authCode)  authEl.textContent = 'Auth: ' + extras.authCode;

        // Populate expandable raw JSON (if provided)
        if (extras.rawResponse) {
            const rawPre = li.querySelector('.log-raw-json');
            const rawBtn = li.querySelector('.log-expand-btn');
            if (rawPre && rawBtn) {
                const meta = [];
                if (extras.cardLast4)    meta.push('Card: •••• ' + extras.cardLast4);
                if (extras.isoCode)      meta.push('ISO: ' + extras.isoCode);
                if (extras.responseCode) meta.push('RC: ' + extras.responseCode);
                rawPre.textContent  = (meta.length ? meta.join('  |  ') + '\n\n' : '')
                                    + JSON.stringify(extras.rawResponse, null, 2);
                rawBtn.style.display = '';
            }
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
