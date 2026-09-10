const express = require('express');
const router = express.Router();
const { getKey } = require('../db');

router.post('/api/key-info', (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

    const r = getKey(apiKey);
    if (!r) return res.status(404).json({ error: 'Key not found' });

    const expired = new Date(r.expires_at) < new Date();

    res.json({
        name: r.name,
        expiresAt: r.expires_at,
        expired,
        tokenLimit: r.token_limit,
        tokensUsed: r.tokens_used,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheTokens: r.cache_tokens ?? 0,
        hasRefill: !!r.has_refill,
        tokensRefillAt: r.tokens_refill_at ?? null,
        refillInterval: r.refill_interval ?? '5h',
        totalTokensUsed: r.total_tokens_used ?? 0,
        totalInputTokens: r.total_input_tokens ?? 0,
        totalOutputTokens: r.total_output_tokens ?? 0,
        totalCacheTokens: r.total_cache_tokens ?? 0,
        creditLimitUsd: r.credit_limit_usd ?? 0,
    });
});

module.exports = router;
