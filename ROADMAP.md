# Virtual POS Peripheral Simulator — Engineering Roadmap

This document tracks the planned engineering roadmap across subscriptions & donations, hardware protocol simulation, Chrome Manifest V3 reliability, localization, security, infrastructure, and CI/CD test automation (**~64 hours of planned work**).

---

## Phase 1: Pro Subscriptions & Supporter Donations (~10 hours)

The extension will be sustained through optional Pro subscriptions (unlocking cloud sandbox relays, multi-terminal fleets, and automated batch macro suites) alongside one-time and recurring supporter donations:

- [ ] **Subscription & Supporter Donation Portal (`sidepanel/panel.html`, `sidepanel/billing-manager.js`):**
  - Add a dedicated **Subscription & Support** panel in `sidepanel/panel.html` supporting Stripe Checkout for Pro Tier subscriptions (Monthly / Annual) and one-time or recurring supporter donations ("Buy the Developer a Coffee / Sponsor Development").
  - Implement license token activation, offline grace-period caching in `chrome.storage.local`, and tier entitlement checks.

---

## Phase 2: Complete Mocked / Inert Hardware & Receipt Paths (~14 hours)

Several UI features currently fall back to inert placeholders or mock stubs:

- [ ] **Real Email Receipt Delivery (`service-worker.js:447-484` & `sidepanel/receipt-manager.js:342-416`):**
  - Currently `handleSendEmail` in `service-worker.js` is a stub that returns `{ success: true, messageId: 'msg_' + Date.now() }` without sending any email, and `receiptRecord.blob` is passed directly inside `chrome.runtime.sendMessage` (which serializes `Blob` as `{}`).
  - Convert PDF/text receipt `Blob` payloads to Base64 data URIs before messaging the service worker, and implement real HTTPS email relay / webhook delivery (Postmark / Resend / custom webhook endpoint) plus `mailto:` / Web Share API fallback.
- [ ] **Real Barcode SVG / Canvas Rendering in ESC/POS Parser (`sidepanel/escpos-parser.js:206`):**
  - Replace the hardcoded `<div class="barcode-placeholder">║█║▌║█║▌│║▌█║▌║</div>` stub in `escpos-parser.js` with accurate SVG/Canvas barcode generation for `GS k` commands (UPC-A, EAN-13, Code 39, Code 128, ITF) and `GS ( k` QR codes.
- [ ] **Verifone, Ingenico, Square, Clover, PAX & Adyen Sandbox Simulators (`sidepanel/payment-terminal-simulator.js:570-725`):**
  - Currently only Stripe and Moneris execute real sandbox calls while the other 6 brands fall through to mock UUIDs. Add dedicated protocol simulators under `sidepanel/simulators/` supporting split-tender partial approvals, EMV chip fallback, and contactless tap limits.

---

## Phase 3: Programmable Batch Macro Runner & OPOS/JavaPOS Bridge (~10 hours)

- [ ] **Batch Macro Recorder & Runner:** Record and replay timed sequences of barcode scans, scale weight changes, and MSR/EMV card interactions for repeatable POS checkout testing.
- [ ] **OPOS / JavaPOS Local WebSocket Bridge:** Optional WebSocket relay mode to test legacy POS web apps that talk to local OPOS/JavaPOS hardware daemons.

---

## Phase 4: Multilingual Support (`_locales/` Chrome i18n) (~8 hours)

- [ ] **Chrome Extension `chrome.i18n` Internationalization:**
  - Add `"default_locale": "en"` to `manifest.json` and extract all UI strings in `sidepanel/panel.html` (`data-i18n` attributes) and `sidepanel/panel.js` (`chrome.i18n.getMessage`) into `_locales/{en,es,fr,de,pt_BR,ja}/messages.json`.
  - Support localized thermal receipt character codepages (`PC437`, `PC850`, `PC858`, `UTF-8`) in `sidepanel/escpos-parser.js`.

---

## Phase 5: Security Review (~8 hours)

- [ ] **Manifest V3 CSP & Local Bundling (`sidepanel/receipt-manager.js:444-457`):**
  - Remove dynamic CDN `<script src="https://cdnjs.cloudflare.com/...">` injection in `loadJsPDF()` and bundle `jspdf.umd.min.js` locally inside `sidepanel/vendor/` to comply with strict Manifest V3 Content Security Policy (`script-src 'self'`).
- [ ] **Credential Storage Encryption & URL Pattern RegExp Escaping (`service-worker.js:354`):**
  - Fix unescaped wildcard regex construction in `service-worker.js:354` (`new RegExp(this.posUrlPattern.replace('*', '.*'))`) using proper regex metacharacter escaping.
  - Remove plaintext password storage in `chrome.storage.local` (`receipt-manager.js:402-441`) in favour of WebCrypto `AES-GCM` session encryption or `chrome.storage.session`.

---

## Phase 6: Infrastructure & MV3 Lifecycle Review (~6 hours)

- [ ] **MV3 Service Worker State Persistence (`service-worker.js:10-19`):**
  - Currently `this.printerStates` and `this.posUrlPattern` live in volatile service worker memory and reset whenever Chrome suspends the background worker after 30 seconds of idle time. Persist and hydrate all peripheral states via `chrome.storage.session` / `chrome.storage.local`.

---

## Phase 7: GitHub Actions & Automated Testing Review (~8 hours)

- [ ] **GitHub Actions CI Pipeline (`.github/workflows/ci.yml`):**
  - Configure `concurrency` with `cancel-in-progress: true`, ESLint static analysis, Manifest V3 schema validation, and automated Chrome Web Store `.zip` artifact building.
- [ ] **Expanded Unit & Playwright Extension E2E Tests (`tests/`):**
  - Expand `tests/terminal-simulators.test.js` to cover all 8 payment terminal brands, ESC/POS barcode/QR byte parsing, `ReceiptManager` PDF/Base64 serialization, and MV3 service-worker suspend/wake state recovery.
