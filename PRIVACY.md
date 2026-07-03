# Privacy Policy — tbay.tk Virtual Peripheral Simulator

**Last updated:** 3 July 2026
**Publisher:** tbay.tk LLC — Alexander Milton — https://tbay.tk
**Contact:** awfmilton@gmail.com

## What this extension is

The tbay.tk Virtual Peripheral Simulator is a **developer/QA testing tool**. It
simulates point-of-sale peripherals — card payment terminals, receipt printers,
barcode scanners, weight scales, cash drawers and customer line displays — so
the tbay.tk POS web application can be tested end-to-end without physical
hardware. It is not intended for processing real customer transactions.

## The short version

- The extension does **not** collect, sell, or share your personal data.
- It has **no analytics, no tracking, and no advertising**.
- Everything it stores stays **on your own device** in Chrome local storage.
- It only runs on tbay.tk POS pages and `localhost` (see *Scope* below).
- The only data it ever sends off your device goes to **payment sandbox test
  APIs** that you explicitly trigger, and only when you are testing the payment
  terminal. No real cardholder data is involved — the card numbers used are
  well-known public **test cards**.

## Scope — where the extension runs

The extension only activates on the POS application it is built for. Its content
script and hardware interceptor are restricted (in `manifest.json`) to:

- `https://*.tbay.tk/*` and `https://tbay.tk/*`
- `http://localhost/*`, `http://localhost:*/*`, `http://127.0.0.1/*`, `http://127.0.0.1:*/*`

It does **not** run on, read, or modify any other website you visit.

## Data stored on your device

The extension uses Chrome's local storage (`chrome.storage.local` and page
`localStorage`) to remember your settings between sessions. This data **never
leaves your device** and is not transmitted to us or any third party:

| Stored item | Purpose |
|---|---|
| `posSimulatorSettings` | Your target-URL pattern, active brand, environment (mock/sandbox), and debug toggle |
| `posSimulatorTheme` | Your chosen side-panel theme |
| `emailConfig` | An optional email address you enter to preview a receipt (used only to fill the "Email Receipt" form; the email feature is a mock and does not actually send mail) |
| Moneris sandbox credentials (`monerisMerchantId`, etc.) | Optional sandbox/test API credentials you enter, used only for sandbox test calls |

You can clear all of it at any time by removing the extension, or via
Chrome → Extensions → Details → Site data.

## Data transmitted off your device

The extension makes network requests **only** in the payment-terminal
"sandbox" test mode, and **only** in response to an action you take (approving a
simulated charge). It sends:

1. **Stripe simulate endpoint** — a request to `…/api/stripe_simulate.php` on
   *your own POS server* (the origin you are testing), to drive a simulated card
   on the reader. This stays within your POS deployment.
2. **Moneris sandbox API** — requests to `https://api.sb.moneris.io` (Moneris'
   **sandbox/QA** environment) to obtain a test OAuth token and run a simulated
   payment. Only **public test card numbers** and sandbox credentials are used.
   No real cardholder data is transmitted.

In the default **"mock" mode**, the extension generates all responses locally
and makes **no** network requests at all.

We (tbay.tk LLC) do not operate a server that receives your data, and the
extension sends nothing to us.

## Data we do NOT collect

- No browsing history, page content, or activity on non-POS sites.
- No personal identifiers, analytics, telemetry, or advertising identifiers.
- No real payment-card data. The tool uses public test/sandbox card numbers only.

## Chrome Web Store data-use disclosures

For the store listing's "Privacy practices" tab, the applicable disclosures are:

- **Personally identifiable information:** Not collected. (An optional email
  address for the receipt-preview form is stored locally only and never sent to us.)
- **Financial and payment information:** Not collected in the real sense — only
  **public test/sandbox card numbers** are used, transmitted solely to payment
  **sandbox** endpoints during testing.
- **Authentication information:** Optional sandbox API credentials you enter are
  stored locally and used only for sandbox test calls.
- **Personal communications, location, web history, user activity:** Not collected.
- **Website content:** The extension reads/writes the DOM **only** on the
  tbay.tk POS and `localhost` pages it is scoped to, to simulate peripheral
  input/output. This never leaves your device.

**We certify that:**
- We do not sell or transfer user data to third parties outside the approved
  use cases.
- We do not use or transfer user data for purposes unrelated to the item's
  single purpose (simulating POS peripherals for testing).
- We do not use or transfer user data to determine creditworthiness or for
  lending purposes.

## Permissions and why they are needed

- **`activeTab`, `sidePanel`** — open and drive the simulator side panel for the
  active POS tab.
- **`storage`** — remember your settings locally (see above).
- **Host access to tbay.tk / localhost** — inject the peripheral simulator into
  the POS page so it can send simulated scans/weights/prints and receive terminal
  charge requests. Restricted to those origins only.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the new
version will ship with the extension.

## Contact

Questions about this policy: **awfmilton@gmail.com** — https://tbay.tk
