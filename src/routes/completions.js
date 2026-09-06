const express = require('express');
const router = express.Router();
const { validateKey } = require('../auth');
const { incrementTokens } = require('../db');
const { sanitizePayload } = require('../utils/sanitizer');
const { getUpstreamHeaders } = require('../utils/cli-identity');

router.post('/v1/chat/completions', async (req, res) => {
    const auth = validateKey(req);
    if (auth.error) {
        return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { apiKey } = auth;

    const region = process.env.AWS_REGION || "us-east-1";
    const model = process.env.ANTHROPIC_MODEL || "us.anthropic.claude-sonnet-4-6";

    let parsedBody = req.body;
    if (typeof parsedBody === 'string') {
        try { parsedBody = JSON.parse(parsedBody); } catch { return res.status(400).json({ error: "Invalid JSON body" }); }
    }
    let isStream = false;
    if (parsedBody.model && !/sonnet-4-6/i.test(parsedBody.model)) {
        return res.status(400).json({ error: { type: "invalid_request_error", message: "Model not allowed. Only claude-sonnet-4-6 is available through this API." } });
    }
    parsedBody = sanitizePayload(parsedBody);
    parsedBody.model = model;
    isStream = parsedBody.stream === true;

    try {
        const upstream = await fetch(
            `https://bedrock-runtime.${region}.amazonaws.com/openai/v1/chat/completions`,
            {
                method: "POST",
                headers: getUpstreamHeaders(process.env.AWS_BEARER_TOKEN_BEDROCK),
                body: JSON.stringify(parsedBody),
            }
        );

        if (isStream) {
            res.writeHead(upstream.status, {
                "Content-Type": upstream.headers.get("Content-Type") || "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });

            if (upstream.body) {
                for await (const chunk of upstream.body) {
                    res.write(chunk);
                }
            }
            return res.end();
        }

        const respBody = await upstream.text();
        if (upstream.ok) {
            try {
                const respParsed = JSON.parse(respBody);
                const input = respParsed.usage?.prompt_tokens ?? 0;
                const output = respParsed.usage?.completion_tokens ?? 0;
                incrementTokens(apiKey, { input, output });
            } catch { }
        }

        res.status(upstream.status).type("application/json").send(respBody);
    } catch (err) {
        console.error("Chat completions error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
