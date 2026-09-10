const { getKey, deleteKey, performRefillReset, bindKeyIp } = require('./db');
const { nextRefillTime } = require('./utils/time');

function getClientIp(req) {
    let ip = req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "";
    if (typeof ip === "string" && ip.includes(",")) {
        ip = ip.split(",")[0].trim();
    }
    if (typeof ip === "string") {
        ip = ip.replace(/^::ffff:/, "");
    }
    return ip;
}

function validateKey(req) {
    const apiKey =
        req.headers["x-api-key"] ||
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "").trim() ||
        req.query.apiKey;

    if (!apiKey) return { error: { message: "Missing X-Api-Key header or apiKey param", status: 401 } };

    const record = getKey(apiKey);
    if (!record) return { error: { message: "Invalid API key", status: 403 } };

    if (new Date(record.expires_at) < new Date()) {
        deleteKey(apiKey);
        return { error: { message: "API key expired", status: 403 } };
    }

    if (record.has_refill && record.tokens_refill_at && new Date(record.tokens_refill_at) <= new Date()) {
        const nextRefill = nextRefillTime(record.refill_interval || "5h");
        performRefillReset(apiKey, nextRefill);
        record.tokens_used = 0;
        record.input_tokens = 0;
        record.output_tokens = 0;
        record.cache_tokens = 0;
        record.tokens_refill_at = nextRefill;
    }

    if (record.token_limit > 0 && record.tokens_used >= record.token_limit) {
        return { error: { message: "Token limit exceeded", status: 429 } };
    }

    if (record.credit_limit_usd > 0) {
        const lifetimeCostUsd = (
            (record.total_input_tokens ?? 0) * 3.00 +
            (record.total_output_tokens ?? 0) * 15.00 +
            (record.total_cache_tokens ?? 0) * 0.30
        ) / 1_000_000;
        if (lifetimeCostUsd >= record.credit_limit_usd) {
            return { error: { message: `Credit limit of $${record.credit_limit_usd.toFixed(2)} exceeded`, status: 429 } };
        }
    }

    const clientIp = getClientIp(req);
    if (clientIp) {
        if (!record.bound_ip) {
            bindKeyIp(apiKey, clientIp);
            record.bound_ip = clientIp;
        } else if (record.bound_ip !== clientIp) {
            return {
                error: {
                    message: `Access denied: Key is locked to IP ${record.bound_ip}. Request came from ${clientIp}`,
                    status: 403
                }
            };
        }
    }

    return { apiKey, record };
}

module.exports = { validateKey, getClientIp };
