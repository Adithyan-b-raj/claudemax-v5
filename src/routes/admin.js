const express = require('express');
const router = express.Router();
const {
    getAllKeys,
    putKey,
    deleteKey,
    resetTokens,
    updateTokenLimit,
    updateRefill,
    resetKeyIp,
} = require('../db');
const { generateKey } = require('../utils/keygen');
const { nextRefillTime } = require('../utils/time');

function checkAdminAuth(req, res, next) {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
        return res.status(503).json({ error: "Set ADMIN_SECRET env var" });
    }
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ") || auth.slice(7) !== adminSecret) {
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}

router.get(['/', ''], (req, res) => {
    res.redirect('/dashboard.html');
});

router.get('/keys', checkAdminAuth, (req, res) => {
    const rows = getAllKeys();
    const keys = rows.map(r => ({
        id: r.api_key,
        apiKey: r.api_key,
        name: r.name,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        tokenLimit: r.token_limit,
        tokensUsed: r.tokens_used,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheTokens: r.cache_tokens ?? 0,
        hasRefill: !!r.has_refill,
        tokensRefillAt: r.tokens_refill_at ?? null,
        refillInterval: r.refill_interval ?? "5h",
        boundIp: r.bound_ip ?? null,
        totalTokensUsed: r.total_tokens_used ?? 0,
        totalInputTokens: r.total_input_tokens ?? 0,
        totalOutputTokens: r.total_output_tokens ?? 0,
        totalCacheTokens: r.total_cache_tokens ?? 0,
    }));
    res.json({ keys });
});

router.post('/create', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    const days = Math.min(365, Math.max(1, parseInt(body.days) || 7));
    const name = (body.name || "api-key").slice(0, 50);
    const tokenLimit = Math.max(0, parseInt(body.tokenLimit) || 0);
    const hasRefill = body.enableRefill === true;
    const refillInterval = ["5h", "daily"].includes(body.refillInterval) ? body.refillInterval : "5h";
    const apiKey = generateKey(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400000);
    const record = {
        name,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        tokenLimit,
        hasRefill,
        refillInterval,
    };
    putKey(apiKey, record);
    res.status(201).json({
        apiKey,
        name,
        expiresAt: record.expiresAt,
        tokenLimit,
        tokensUsed: 0,
        usage: `curl -X POST ${req.protocol}://${req.get('host')}/v1/messages -H "x-api-key: ${apiKey}" -H "Content-Type: application/json" -d '{...}'`,
    });
});

router.post('/revoke', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    if (!body.apiKey) return res.status(400).json({ error: "apiKey required" });
    deleteKey(body.apiKey);
    res.json({ ok: true });
});

router.post('/reset-tokens', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    if (!body.apiKey) return res.status(400).json({ error: "apiKey required" });
    resetTokens(body.apiKey);
    res.json({ ok: true });
});

router.post('/reset-ip', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    if (!body.apiKey) return res.status(400).json({ error: "apiKey required" });
    resetKeyIp(body.apiKey);
    res.json({ ok: true });
});

router.post('/update-token-limit', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    if (!body.apiKey) return res.status(400).json({ error: "apiKey required" });
    const tokenLimit = Math.max(0, parseInt(body.tokenLimit) || 0);
    updateTokenLimit(body.apiKey, tokenLimit);
    res.json({ ok: true });
});

router.post('/update-refill', checkAdminAuth, (req, res) => {
    const body = req.body || {};
    if (!body.apiKey) return res.status(400).json({ error: "apiKey required" });
    const enable = body.enable === true;
    const interval = ["5h", "daily"].includes(body.refillInterval) ? body.refillInterval : "5h";
    const refillAt = enable ? nextRefillTime(interval) : null;
    updateRefill(body.apiKey, enable, refillAt, interval);
    res.json({ ok: true, tokensRefillAt: refillAt, refillInterval: interval });
});

module.exports = router;
