const express = require('express');
const router = express.Router();
const { validateKey } = require('../auth');
const { incrementTokens } = require('../db');
const { readEventFrame, normalizeBedRockError, withRetry } = require('../utils/bedrock');
const { sanitizePayload } = require('../utils/sanitizer');
const { getUpstreamHeaders } = require('../utils/cli-identity');
const { enqueue } = require('../utils/queue');

router.post('/v1/messages', async (req, res) => {
    const auth = validateKey(req);
    if (auth.error) {
        return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { apiKey } = auth;

    const body = req.body;
    let parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const isStream = parsed.stream === true;

    if (parsed.model && !/sonnet-4-6/i.test(parsed.model)) {
        return res.status(400).json({
            type: "error",
            error: { type: "invalid_request_error", message: "Model not allowed. Only claude-sonnet-4-6 is available through this API." }
        });
    }

    parsed = sanitizePayload(parsed);

    delete parsed.model;
    delete parsed.stream;
    parsed.anthropic_version = "bedrock-2023-05-31";
    const bedrockBody = JSON.stringify(parsed);

    const region = process.env.AWS_REGION || "us-east-1";
    const model = process.env.ANTHROPIC_MODEL || "us.anthropic.claude-sonnet-4-6";
    const bedrockBase = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}`;

    try {
        // Option 4: queue  — controls outbound rate, prevents burst spikes
        // Option 1: retry  — retries on 429 with exponential backoff (up to 3x)
        const upstream = await enqueue(() =>
            withRetry(async () => {
                const invokeUrl = isStream
                    ? `${bedrockBase}/invoke-with-response-stream`
                    : `${bedrockBase}/invoke`;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 60_000);
                try {
                    return await fetch(invokeUrl, {
                        method: "POST",
                        headers: getUpstreamHeaders(process.env.AWS_BEARER_TOKEN_BEDROCK),
                        body: bedrockBody,
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeout);
                }
            })
        );

        if (isStream && !upstream.ok) {
            const errBody = await upstream.text();
            return res.status(upstream.status).type("application/json").send(normalizeBedRockError(errBody));
        }

        if (isStream && upstream.body) {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            });

            let accumulated = new Uint8Array(0);
            let inputTokens = 0;
            let outputTokens = 0;
            let cacheTokens = 0;

            try {
                for await (const value of upstream.body) {
                    const chunk = new Uint8Array(value);
                    const next = new Uint8Array(accumulated.length + chunk.length);
                    next.set(accumulated);
                    next.set(chunk, accumulated.length);
                    accumulated = next;

                    while (true) {
                        const frame = readEventFrame(accumulated);
                        if (!frame) break;
                        accumulated = accumulated.slice(frame.consumed);

                        const eventType = frame.headers[":event-type"];

                        if (eventType === "modelStreamErrorException") {
                            try {
                                const err = JSON.parse(frame.payload);
                                res.write(`data: ${JSON.stringify({ type: "error", error: { type: "api_error", message: err.message || "Bedrock stream error" } })}\n\n`);
                            } catch { }
                            break;
                        }

                        if (eventType === "chunk") {
                            const wrapper = JSON.parse(frame.payload);
                            const anthropicJson = Buffer.from(wrapper.bytes, 'base64').toString('utf-8');

                            try {
                                const evt = JSON.parse(anthropicJson);
                                if (evt.type === "message_start") {
                                    inputTokens = evt.message?.usage?.input_tokens ?? 0;
                                    cacheTokens = (evt.message?.usage?.cache_creation_input_tokens ?? 0) + (evt.message?.usage?.cache_read_input_tokens ?? 0);
                                }
                                if (evt.type === "message_delta" && evt.usage) outputTokens = evt.usage.output_tokens ?? 0;
                            } catch { }

                            let eventName = "";
                            try { eventName = JSON.parse(anthropicJson).type || ""; } catch { }
                            const sseData = eventName
                                ? `event: ${eventName}\ndata: ${anthropicJson}\n\n`
                                : `data: ${anthropicJson}\n\n`;
                            res.write(sseData);
                        }
                    }
                }
            } catch (err) {
                console.error("Stream reading error:", err);
            } finally {
                incrementTokens(apiKey, { input: inputTokens, output: outputTokens, cache: cacheTokens });
                res.end();
            }
            return;
        }

        const respBody = await upstream.text();

        if (upstream.ok) {
            try {
                const respParsed = JSON.parse(respBody);
                const input = respParsed.usage?.input_tokens ?? 0;
                const output = respParsed.usage?.output_tokens ?? 0;
                const cache = (respParsed.usage?.cache_creation_input_tokens ?? 0) + (respParsed.usage?.cache_read_input_tokens ?? 0);
                incrementTokens(apiKey, { input, output, cache });
            } catch { }
        }

        const outBody = upstream.ok ? respBody : normalizeBedRockError(respBody);
        res.status(upstream.status).type("application/json").send(outBody);
    } catch (err) {
        if (err.name === 'AbortError') {
            console.error("Bedrock request timed out after 60s");
            return res.status(504).json({
                type: "error",
                error: { type: "api_error", message: "Upstream Bedrock request timed out. Please retry." }
            });
        }
        console.error("Bedrock fetch error:", err);
        res.status(500).json({ error: "Internal server error forwarding to Bedrock" });
    }
});

module.exports = router;
