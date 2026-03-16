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

    function _sendResponse(outcome, method) {
        if (state.pendingRequests.length === 0) {
            console.warn('[TerminalSim] No pending requests to respond to.');
            return;
        }

        const req = state.pendingRequests.shift(); // Serve oldest request first
        const reference = `${state.activeBrand}_${method}_${Date.now()}`;

        const payload = {
            type:      'TERMINAL_SIMULATE_RESPONSE',
            requestId: req.id,
            outcome,
            method,
            reference,
            gateway:   req.gateway,
            brand:     state.activeBrand,
            timestamp: new Date().toISOString(),
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
