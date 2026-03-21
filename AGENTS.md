# AGENTS.md

This is a Chrome Extension (Manifest V3) that acts as a virtual peripheral simulator for the tbay.tk POS system. It has no build step and no runtime dependencies — all code is vanilla JavaScript.

**CRITICAL:** Before performing any code changes, all AI agents (including Jules and others) MUST read and follow the conventions defined in **CLAUDE.md**.

`CLAUDE.md` is the primary source of truth for:
- How to load and reload the extension in Chrome
- How to run tests
- The four JS execution contexts and why they are isolated from each other
- The terminal charge message flow (POS page → content script → service worker → side panel → back)
- The brand simulator registration pattern (`window.TerminalSimulators`)
- Script load order requirements in `panel.html`
- Debugging conventions (the `state.debug` / `window.TerminalSimulatorDebug` flag)

## Quick-Start Warnings

- **There is no build step.** Do not add Webpack, Vite, Rollup, or any bundler. Load unpacked directly.
- **This repo is a Git submodule.** It lives inside `tbay.tk-POS-w-DB/pos-simulator-chrome-extension/`. Commit changes here first, then update the submodule pointer in the parent repo.
- **Script load order in `panel.html` matters.** `helpers.js` must load before all brand simulators, and all brand simulators must load before `payment-terminal-simulator.js`. Do not reorder.
- **Do not add unconditional `console.log` calls** in the charge request/response path. Gate all verbose logging behind `state.debug` — see the Debugging Conventions section in `CLAUDE.md`.
- **`content-script.js` runs in the isolated world** — it cannot access POS page globals. Use `window.postMessage` to cross that boundary.
- **`interceptor.js` runs in the main world** — it is the only file that can override `navigator.usb`, `navigator.serial`, and `navigator.hid`. Do not move hardware interception logic elsewhere.
- **`buildPayload` must be pure** — no async, no DOM, no side effects. It receives `(outcome, method, req, partialPercent)` and returns a plain object.
