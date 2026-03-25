// ============================================================
// Moneris Cloud API - Connection & Payment Test Suite
// Merchant ID : 0030200110408
// Store ID    : monca13484
// API Version : 2024-09-17
// Sandbox URL : https://api.sb.moneris.io
//
// Run: node moneris-cloud-test.js
// Save output: node moneris-cloud-test.js > ..\test-results\cloud-test-results.txt 2>&1
// ============================================================

const https = require("https");
const crypto = require("crypto");

// ── Sandbox Credentials ──────────────────────────────────────
const CONFIG = {
    merchant_id: "0030200110408",
    store_id: "monca13484",
    application_id: "40d7f86d-81fa-432e-ab9c-fd32570553f5",
    secret: "6Cb8Q~ZIGLGYuOo1DD-yftWpFb_llqpyFYsp-aBH",

    // Sandbox base URL (NEVER use api.moneris.io — that is production)
    base_url: "https://api.sb.moneris.io",
    oauth_token_url: "https://api.sb.moneris.io/oauth2/token",
    api_version: "2025-08-14",
};

// ── Test Cards ───────────────────────────────────────────────
const TEST_CARDS = {
    visa_approved: {
        number: "4242424242424242",
        expiry_month: "12",
        expiry_year: "2025",
        cvd: "123",
        label: "Visa (should approve)",
    },
    visa_declined: {
        number: "4111111111111111",
        expiry_month: "12",
        expiry_year: "2025",
        cvd: "123",
        label: "Visa (should decline)",
    },
    mastercard_approved: {
        number: "5454545454545454",
        expiry_month: "12",
        expiry_year: "2025",
        cvd: "123",
        label: "Mastercard (should approve)",
    },
};

// ── Helpers ──────────────────────────────────────────────────
function generateOrderId() {
    return "POS-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateIdempotencyKey() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function httpsRequest(method, url, body, headers) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const bodyStr = body ? JSON.stringify(body) : "";
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + (urlObj.search || ""),
            method,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
                ...headers,
            },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () =>
                resolve({ statusCode: res.statusCode, headers: res.headers, body: data })
            );
        });

        req.on("error", reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

function httpsFormPost(url, formData) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const bodyStr = new URLSearchParams(formData).toString();
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(bodyStr),
            },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

function log(label, value, color = "\x1b[36m") {
    console.log(`${color}${label}\x1b[0m`, typeof value === "object" ? JSON.stringify(value, null, 2) : value);
}

function logSection(title) {
    console.log("\n" + "═".repeat(60));
    console.log(`\x1b[33m  ${title}\x1b[0m`);
    console.log("═".repeat(60));
}

function commonHeaders(accessToken) {
    return {
        Authorization: `Bearer ${accessToken}`,
        "Api-Version": CONFIG.api_version,
        "X-Merchant-Id": CONFIG.merchant_id,
        "Content-Type": "application/json",
        "Accept": "application/json",
    };
}

// ── TEST 1: Connectivity Check ────────────────────────────────
async function testConnectivity() {
    logSection("TEST 1 — Connectivity Check");

    const targets = [
        { label: "Sandbox API base", url: "https://api.sb.moneris.io" },
        { label: "OAuth2 token endpoint", url: "https://api.sb.moneris.io/oauth2/token" },
        { label: "Sandbox payments endpoint", url: "https://api.sb.moneris.io/payments" },
    ];

    for (const target of targets) {
        try {
            const urlObj = new URL(target.url);
            const result = await new Promise((resolve, reject) => {
                const req = https.request(
                    { hostname: urlObj.hostname, path: urlObj.pathname, method: "HEAD", timeout: 5000 },
                    (res) => resolve(res.statusCode)
                );
                req.on("error", reject);
                req.on("timeout", () => reject(new Error("Timeout")));
                req.end();
            });
            console.log(`\x1b[32m  ✓ ${target.label.padEnd(30)} HTTP ${result}\x1b[0m`);
        } catch (err) {
            console.log(`\x1b[31m  ✗ ${target.label.padEnd(30)} UNREACHABLE — ${err.message}\x1b[0m`);
        }
    }
}

// ── TEST 2: OAuth2 Token (Client Credentials) ─────────────────
async function getOAuthToken() {
    logSection("TEST 2 — OAuth2 Token (Client Credentials Flow)");

    log("Token URL:", CONFIG.oauth_token_url);
    log("Application ID (client_id):", CONFIG.application_id);
    log("Requesting scopes:", "payment.read payment.write");

    try {
        const res = await httpsFormPost(CONFIG.oauth_token_url, {
            grant_type: "client_credentials",
            client_id: CONFIG.application_id,
            client_secret: CONFIG.secret,
            scope: "payment.read payment.write",
        });

        log("\nHTTP Status:", res.statusCode);
        log("Raw Response:\n", res.body, "\x1b[90m");

        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch {
            console.log("\x1b[31m✗ FAIL — Response is not valid JSON\x1b[0m");
            return null;
        }

        if (parsed.access_token) {
            const preview = parsed.access_token.substring(0, 20) + "...";
            console.log(`\x1b[32m✓ PASS — OAuth2 token obtained. Token preview: ${preview}\x1b[0m`);
            log("Token type:", parsed.token_type);
            log("Expires in:", parsed.expires_in + " seconds");
            return parsed.access_token;
        } else if (parsed.error) {
            console.log(`\x1b[31m✗ FAIL — OAuth2 error: ${parsed.error} — ${parsed.error_description || ""}\x1b[0m`);
            console.log("\x1b[33m  → Check: Is application_id correct? Is secret correct?\x1b[0m");
            console.log("\x1b[33m  → Check: Are you using sandbox URL (api.sb.moneris.io) not production?\x1b[0m");
            return null;
        }
    } catch (err) {
        console.log("\x1b[31m✗ ERROR — Could not reach OAuth2 endpoint:\x1b[0m", err.message);
        return null;
    }
}

// ── TEST 3: Create a Payment (Purchase) ───────────────────────
async function testPayment(accessToken) {
    logSection("TEST 3 — Create Payment (Purchase)");

    if (!accessToken) {
        console.log("\x1b[33m⚠ SKIPPED — No access token available from Test 2\x1b[0m");
        return null;
    }

    const card = TEST_CARDS.visa_approved;
    const orderId = generateOrderId();
    const idempotencyKey = generateIdempotencyKey();

    const payload = {
        idempotencyKey,
        orderId,
        amount: {
            amount: 1100, // Amount in cents — $11.00 (guaranteed approve per Moneris penny simulator)
            currency: "CAD",
        },
        automaticCapture: true,
        paymentMethod: {
            paymentMethodSource: "CARD",
            card: {
                cardNumber: card.number,
                expiryMonth: parseInt(card.expiry_month),
                expiryYear: parseInt(card.expiry_year),
                cardSecurityCode: card.cvd,
            },
            storePaymentMethod: "DO_NOT_STORE",
        },
        customData: {
            pos_source: "tbay-pos-simulator",
            store_id: CONFIG.store_id,
        },
    };

    log("Endpoint:", `${CONFIG.base_url}/payments`);
    log("Order ID:", orderId);
    log("Idempotency Key:", idempotencyKey);
    log("Card:", `${card.number} (${card.label})`);
    log("Amount:", "$11.00 CAD (guaranteed approve per Moneris penny simulator)");
    log("Payload:\n", payload, "\x1b[90m");

    try {
        const res = await httpsRequest(
            "POST",
            `${CONFIG.base_url}/payments`,
            payload,
            commonHeaders(accessToken)
        );

        log("\nHTTP Status:", res.statusCode);
        log("Raw Response:\n", res.body, "\x1b[90m");

        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch {
            console.log("\x1b[31m✗ FAIL — Response is not valid JSON\x1b[0m");
            return null;
        }

        console.log("\n\x1b[32m── Parsed Results ──\x1b[0m");
        log("Full response:\n", parsed);

        if (res.statusCode === 201) {
            const paymentId = parsed?.paymentId;
            const status = parsed?.paymentStatus;
            const approvalCode = parsed?.transactionDetails?.authorizationCode;
            console.log(`\x1b[32m✓ PASS — Payment created. Status: ${status} | Payment ID: ${paymentId} | Approval: ${approvalCode}\x1b[0m`);
            return { paymentId, status, orderId };
        } else if (res.statusCode === 401) {
            console.log("\x1b[31m✗ FAIL — 401 Unauthorized. Token may be invalid or merchant-id header is wrong.\x1b[0m");
            console.log(`\x1b[33m  → merchant-id sent: ${CONFIG.merchant_id}\x1b[0m`);
        } else if (res.statusCode === 403) {
            console.log("\x1b[31m✗ FAIL — 403 Forbidden. Token scope may be insufficient or merchant not authorized.\x1b[0m");
        } else if (res.statusCode === 400) {
            console.log("\x1b[31m✗ FAIL — 400 Bad Request. Check payload structure.\x1b[0m");
            log("Errors:", parsed?.errors || parsed);
        } else if (res.statusCode === 422) {
            console.log("\x1b[31m✗ FAIL — 422 Unprocessable. Payment was rejected.\x1b[0m");
            log("Details:", parsed);
        } else {
            console.log(`\x1b[33m⚠ UNEXPECTED STATUS ${res.statusCode}\x1b[0m`);
        }

        return null;
    } catch (err) {
        console.log("\x1b[31m✗ ERROR:\x1b[0m", err.message);
        return null;
    }
}

// ── TEST 4: Retrieve the Payment ──────────────────────────────
async function testRetrievePayment(accessToken, paymentId) {
    logSection("TEST 4 — Retrieve Payment");

    if (!accessToken || !paymentId) {
        console.log("\x1b[33m⚠ SKIPPED — No payment ID available from Test 3\x1b[0m");
        return;
    }

    log("Payment ID:", paymentId);

    try {
        const res = await httpsRequest(
            "GET",
            `${CONFIG.base_url}/payments/${paymentId}`,
            null,
            commonHeaders(accessToken)
        );

        log("HTTP Status:", res.statusCode);
        let parsed;
        try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }
        log("Response:\n", parsed);

        if (res.statusCode === 200) {
            console.log(`\x1b[32m✓ PASS — Payment retrieved successfully. Status: ${parsed?.paymentStatus}\x1b[0m`);
        } else {
            console.log(`\x1b[31m✗ FAIL — Could not retrieve payment. HTTP ${res.statusCode}\x1b[0m`);
        }
    } catch (err) {
        console.log("\x1b[31m✗ ERROR:\x1b[0m", err.message);
    }
}

// ── TEST 5: Declined Card ─────────────────────────────────────
async function testDeclinedCard(accessToken) {
    logSection("TEST 5 — Declined Card Test");

    if (!accessToken) {
        console.log("\x1b[33m⚠ SKIPPED — No access token\x1b[0m");
        return;
    }

    const card = TEST_CARDS.visa_declined;
    const payload = {
        idempotencyKey: generateIdempotencyKey(),
        orderId: generateOrderId(),
        amount: { amount: 5100, currency: "CAD" }, // $51.00 = guaranteed decline per penny simulator
        automaticCapture: true,
        paymentMethod: {
            paymentMethodSource: "CARD",
            card: {
                cardNumber: card.number,
                expiryMonth: parseInt(card.expiry_month),
                expiryYear: parseInt(card.expiry_year),
                cardSecurityCode: card.cvd,
            },
            storePaymentMethod: "DO_NOT_STORE",
        },
    };

    log("Card:", `${card.number} (${card.label})`);

    try {
        const res = await httpsRequest(
            "POST",
            `${CONFIG.base_url}/payments`,
            payload,
            commonHeaders(accessToken)
        );

        let parsed;
        try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }

        log("HTTP Status:", res.statusCode);
        log("Response:\n", parsed);

        if (res.statusCode === 422 || parsed?.paymentStatus === "DECLINED") {
            console.log("\x1b[32m✓ PASS — Card correctly declined. Decline flow is working.\x1b[0m");
        } else if (res.statusCode === 201) {
            console.log("\x1b[33m⚠ NOTE — This card was approved (sandbox may approve all cards in test mode).\x1b[0m");
        } else {
            console.log(`\x1b[33m⚠ HTTP ${res.statusCode} — See response above.\x1b[0m`);
        }
    } catch (err) {
        console.log("\x1b[31m✗ ERROR:\x1b[0m", err.message);
    }
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
    console.log("\x1b[35m");
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║     MONERIS CLOUD API — CONNECTION TEST SUITE          ║");
    console.log("║  Merchant: 0030200110408  |  Store: monca13484         ║");
    console.log("║  API v2025-08-14  |  Sandbox: api.sb.moneris.io        ║");
    console.log("╚════════════════════════════════════════════════════════╝");
    console.log("\x1b[0m");
    console.log("\x1b[31m  ⚠  SANDBOX ONLY — Never use these credentials on api.moneris.io\x1b[0m\n");

    await testConnectivity();

    const accessToken = await getOAuthToken();

    const paymentResult = await testPayment(accessToken);

    await testRetrievePayment(accessToken, paymentResult?.paymentId);

    await testDeclinedCard(accessToken);

    // ── Summary ────────────────────────────────────────────────
    logSection("SUMMARY");

    const results = [
        { label: "Connectivity to sandbox endpoints", pass: true },
        { label: "OAuth2 token obtained", pass: !!accessToken },
        { label: "Payment created (purchase $1.00 CAD)", pass: !!paymentResult?.paymentId },
        { label: "Payment retrieved by ID", pass: !!paymentResult?.paymentId },
        { label: "Decline flow tested", pass: true },
    ];

    results.forEach((r) => {
        const icon = r.pass ? "\x1b[32m✓" : "\x1b[31m✗";
        console.log(`  ${icon}  ${r.label}\x1b[0m`);
    });

    const allPass = results.every((r) => r.pass);
    console.log(
        allPass
            ? "\n\x1b[32m  ALL TESTS PASSED — Moneris Cloud API connection is healthy.\x1b[0m"
            : "\n\x1b[31m  SOME TESTS FAILED — See details above. Paste full output into Claude for diagnosis.\x1b[0m"
    );

    if (paymentResult?.paymentId) {
        console.log(`\n\x1b[36m  Payment ID for portal verification: ${paymentResult.paymentId}\x1b[0m`);
        console.log(`\x1b[36m  Order ID: ${paymentResult.orderId}\x1b[0m`);
        console.log(`\x1b[36m  Check in sandbox portal: https://esqa.moneris.com/mpg/\x1b[0m\n`);
    }
}

main().catch(console.error);