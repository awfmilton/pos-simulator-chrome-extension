# CLAUDE.md — tbay.tk Virtual Peripheral Simulator

This file provides guidance to Claude Code (and other AI agents) when working with this Chrome Extension repository.

**This repo is a Git submodule of `tbay.tk-POS-w-DB`.** Changes here must be committed inside this directory first, then the parent repo's submodule pointer must be updated.

---

## Commands

### Loading the Extension in Chrome
There is **no build step**. The extension is pure vanilla JavaScript.

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load Unpacked** → select this directory
4. After any file change, click the **reload icon** on the extension card

### Running Tests
```bash
npm install   # install Jest (dev dependency only)
npm test      # runs Jest unit tests
```
Tests live in `sidepanel/credit-card-generator.test.js`. There are no other automated test files — the terminal simulator logic is covered by Playwright tests in the parent repo.

---

## Architecture

### Four JS Contexts (Manifest V3)

Every file runs in one of four distinct JS execution contexts. **You cannot share variables between contexts** — all communication must go through message passing.

| Context | File(s) | Can access |
|---------|---------|-----------|
| **Service Worker** | `service-worker.js` | `chrome.*` APIs; no DOM |
| **Isolated World** (content script) | `content-script.js` | DOM of POS page; `chrome.*` APIs; cannot see page JS globals |
| **Main World** (injected) | `interceptor.js` | Full POS page globals (`window`, `navigator`); no `chrome.*` APIs |
| **Extension Page** (side panel) | `sidepanel/panel.js`, `sidepanel/payment-terminal-simulator.js`, `sidepanel/simulators/*.js` | `chrome.*` APIs; own DOM; no POS page access |

### Message Flow — Terminal Charge

```
POS page (Main World)
  └─ window.postMessage('POS_TERMINAL_CHARGE_REQUEST')
      └─ content-script.js  [Isolated World]
          Forwards via chrome.runtime.connect port → service-worker
              └─ service-worker.js  [SW]
                  Forwards via sidePanelPort → panel.js
                      └─ panel.js calls window.handleTerminalChargeRequest(data)
                          └─ payment-terminal-simulator.js shows pending request
                              Operator clicks Approve / Decline / Timeout
                          └─ _sendResponse(outcome, method)
                              └─ _buildVendorPayload() → window.TerminalSimulators[brand].buildPayload()
                      └─ panel.js sends TERMINAL_SIMULATE_RESPONSE → service-worker
                  └─ service-worker broadcasts to all contentScriptPorts
              └─ content-script.js posts POS_TERMINAL_CHARGE_RESPONSE to page
          └─ TerminalBridge.js (in parent repo) resolves/rejects the Promise
```

### Persistent Port Architecture

The service worker keeps **long-lived `MessagePort` connections** — one `sidePanelPort` and a `Map<tabId, port>` for content scripts. This eliminates race conditions from one-shot `chrome.tabs.sendMessage()` calls and ensures ordered delivery. The content script reconnects automatically (5-second retry) if the SW wakes from inactivity.

### Brand Simulator Pattern

Brand simulator files live in `sidepanel/simulators/`. They are loaded as plain `<script>` tags in `panel.html` **before** `payment-terminal-simulator.js`. Each file registers itself immediately into `window.TerminalSimulators`:

```js
// Pattern every brand file MUST follow
window.TerminalSimulators.brandName = (function () {
    function updateUI(show) { /* show/hide brand-specific DOM rows */ }
    function buildPayload(outcome, method, req, partialPercent) { /* return vendor JSON */ }
    return { updateUI, buildPayload };
})();
```

`payment-terminal-simulator.js` routes to the active brand at runtime:
```js
window.TerminalSimulators[state.activeBrand].buildPayload(outcome, method, req, state.partialAuthPercent)
```

**To add a new brand simulator**, create `sidepanel/simulators/<brand>.js`, implement `updateUI` and `buildPayload`, add a `<script>` tag for it in `panel.html` before `payment-terminal-simulator.js`, and add a `<option>` for it in the brand `<select>` element.

### Shared Utilities — `helpers.js`

`sidepanel/simulators/helpers.js` must be the **first** simulator script loaded. It exports `window.TerminalSimulatorHelpers`:

| Function | Purpose |
|----------|---------|
| `uid(prefix, len)` | Random alphanumeric UID (e.g. `uid('pi_', 24)` → `'pi_abc123...'`) |
| `numStr(len)` | Numeric-only string of N digits |
| `amountCents(req)` | Convert `req.amount` (dollar string/number) to integer cents |
| `partialCents(req, pct)` | Compute partial-auth amount in cents at `pct`% |

All brand simulators should use these helpers — never roll your own amount or ID generation.

### Hardware Interception — `interceptor.js`

Injected into the **main world** so it can override `navigator.usb`, `navigator.serial`, and `navigator.hid`. Simulates:
- **Weight scales** — Mettler Toledo, Detecto (WebUSB + WebSerial)
- **Cash drawers** — APG USB, FTDI Serial
- Scale readings are published to the page via `window.posScaleWeight`, `window.posScaleUnit`, `window.posScaleStable`, `window.posScaleZero`

Do not move this file to the isolated world — it requires direct access to `navigator.*`.

---

## Key Files

| File | Role |
|------|------|
| `manifest.json` | Manifest V3 declaration — permissions, content script config, side panel |
| `service-worker.js` | Central message router; owns all port connections |
| `content-script.js` | POS page bridge; injects `interceptor.js`; forwards postMessages to SW |
| `interceptor.js` | Main-world WebUSB/WebSerial/WebHID override for hardware simulation |
| `port-simulator.js` | ESC/POS receipt data generator (root-level, used for test prints) |
| `sidepanel/panel.html` | Side panel UI; loads all simulator scripts via `<script>` tags |
| `sidepanel/panel.js` | Main panel controller; tab management; connects to SW |
| `sidepanel/payment-terminal-simulator.js` | Terminal tab logic; request queue; operator approval UI |
| `sidepanel/simulators/helpers.js` | Shared UID / amount helpers — **must load first** |
| `sidepanel/simulators/stripe.js` | Stripe Terminal payload builder |
| `sidepanel/simulators/square.js` | Square Terminal payload builder |
| `sidepanel/simulators/moneris.js` | Moneris Cloud Terminal (iPP320) payload builder |
| `sidepanel/simulators/paypal.js` | PayPal / Zettle Terminal payload builder |
| `sidepanel/simulators/chase.js` | Chase / CyberSource OmniPay payload builder |
| `sidepanel/simulators/elavon.js` | Elavon Converge payload builder |
| `sidepanel/simulators/globalpayments.js` | Global Payments payload builder |
| `sidepanel/simulators/helcim.js` | Helcim payload builder |
| `sidepanel/escpos-parser.js` | ESC/POS command parser and visual receipt renderer |
| `sidepanel/aamva-generator.js` | AAMVA PDF417 driver's licence barcode generator |
| `sidepanel/credit-card-generator.js` | Test card number + MSR track data generator |
| `sidepanel/virtual-keyboard.js` | Virtual QWERTY / numeric keypad UI |
| `sidepanel/receipt-manager.js` | In-memory print job history |

---

## Key Conventions

- **No build step, ever.** This is vanilla JS. Do not introduce bundlers, transpilers, or npm runtime dependencies.
- **No `innerHTML`.** Use `textContent` or explicit DOM construction to avoid XSS.
- **Script load order in `panel.html` matters.** `helpers.js` → individual brand simulators → `payment-terminal-simulator.js` → `panel.js`. Never reorder.
- **`window.TerminalSimulators` must be initialised before brand files register.** The object literal `window.TerminalSimulators = window.TerminalSimulators || {};` belongs at the top of `panel.html` or `payment-terminal-simulator.js` — confirm it exists before touching brand files.
- **Content script is isolated world** — it cannot read or write POS page globals. Use `postMessage` to cross that boundary.
- **Service worker can wake and sleep.** Never store critical state only in SW memory without a recovery path. Use `chrome.storage.local` for anything that must survive SW restarts.
- **Reconnect logic is in `content-script.js`.** If the SW port disconnects, the content script retries after 5 seconds. Do not add duplicate retry logic elsewhere.
- **`buildPayload` must be a pure function** — no side effects, no async, no DOM access. It receives `(outcome, method, req, partialPercent)` and returns a plain JS object.

---

## Debugging Conventions

### Cross-Stack Verbose Logging

The debug flag originates in the POS Settings UI (`terminal_debug_enabled` in localStorage) and is injected into every `POS_TERMINAL_CHARGE_REQUEST` message as `debug: true/false`. **Gate all expensive or verbose extension-side logs behind this flag.**

| Location | How to check the flag |
|----------|-----------------------|
| `payment-terminal-simulator.js` | `state.debug` (module-private) |
| Any extension page script | `window.TerminalSimulatorDebug` (global set by simulator) |

**Pattern to follow:**
```js
if (state.debug) {
    console.log('[TerminalSim] your message here', relevantData);
}
```

Do **not** add unconditional `console.log` calls in the charge request / response path. They will flood the side panel console on every production transaction.

### Engineer's Toolbar

The terminal simulator has a hidden **Engineer's Toolbar** revealed by triple-clicking the gear icon. It provides:
- **Force Result** dropdown — auto-approves/declines the next request without operator interaction (`forceResult` in `state`)
- **Stripe card selector** — override the test card used for sandbox `stripe_simulate.php` calls
- **Moneris card selector** — override the Moneris QA card

Use `forceResult` in automated tests to skip manual approval.

### Sandbox vs Mock

| `state.environment` | Behaviour |
|--------------------|-----------|
| `'mock'` | Extension generates the response payload entirely; no backend API call |
| `'sandbox'` | For Stripe: calls `stripe_simulate.php` on the POS server to present a card on the real simulated reader. For Moneris: calls `moneris_simulate.php` via the QA API. Other brands fall through to mock. |

The environment is set from the incoming `POS_TERMINAL_CHARGE_REQUEST` message — it mirrors the `terminal_environment` localStorage key in the POS app.
