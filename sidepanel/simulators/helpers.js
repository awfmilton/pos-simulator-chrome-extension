/*
 * simulators/helpers.js
 * ─────────────────────
 * Shared utility functions used by all brand simulator files.
 * Must be included in panel.html BEFORE any brand simulator script.
 *
 * Exports via: window.TerminalSimulatorHelpers
 */

'use strict';

window.TerminalSimulatorHelpers = (function () {

    /** Generate a random UID string with the given prefix and random suffix of `len` chars. */
    function uid(prefix, len) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = prefix;
        for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    /** Generate a numeric string of exactly `len` digits. */
    function numStr(len) {
        let s = '';
        for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
        return s;
    }

    /** Convert req.amount (dollar string/number) to integer cents. */
    function amountCents(req) {
        return Math.round(parseFloat(req.amount) * 100);
    }

    /**
     * Compute the partial-auth amount in cents.
     * @param {object} req            - pending request (has req.amount)
     * @param {number} partialPercent - e.g. 70 for 70%
     */
    function partialCents(req, partialPercent) {
        return Math.round(amountCents(req) * partialPercent / 100);
    }

    return { uid, numStr, amountCents, partialCents };

})();
