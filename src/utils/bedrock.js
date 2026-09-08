function parseEventHeaders(buf) {
    const headers = {};
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let i = 0;
    while (i < buf.length) {
        const nameLen = buf[i++];
        const name = new TextDecoder().decode(buf.slice(i, i + nameLen));
        i += nameLen;
        i++;
        const valLen = dv.getUint16(i, false);
        i += 2;
        const value = new TextDecoder().decode(buf.slice(i, i + valLen));
        i += valLen;
        headers[name] = value;
    }
    return headers;
}

function readEventFrame(accumulated) {
    if (accumulated.length < 12) return null;
    const dv = new DataView(accumulated.buffer, accumulated.byteOffset, accumulated.byteLength);
    const totalLen = dv.getUint32(0, false);
    if (accumulated.length < totalLen) return null;
    const headersLen = dv.getUint32(4, false);
    const headersEnd = 12 + headersLen;
    const payloadEnd = totalLen - 4;
    const headers = parseEventHeaders(accumulated.slice(12, headersEnd));
    const payload = new TextDecoder().decode(accumulated.slice(headersEnd, payloadEnd));
    return { headers, payload, consumed: totalLen };
}

function normalizeBedRockError(body) {
    try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        if (parsed.__type) {
            const typeMap = {
                "ValidationException": "invalid_request_error",
                "ThrottlingException": "rate_limit_error",
                "ModelNotReadyException": "api_error",
                "ModelStreamErrorException": "api_error",
                "AccessDeniedException": "authentication_error",
                "ResourceNotFoundException": "not_found_error",
            };
            return JSON.stringify({
                type: "error",
                error: { type: typeMap[parsed.__type] || "api_error", message: parsed.message || parsed.__type },
            });
        }
    } catch { }
    return typeof body === 'string' ? body : JSON.stringify(body);
}

/**
 * Transparent Retry — Option 1
 *
 * Retries a function that returns a fetch Response on 429.
 * Uses exponential backoff — client never sees a 429 unless
 * all retries are exhausted.
 *
 * @param {() => Promise<Response>} fn
 * @param {number} maxRetries   — default 3
 * @param {number} baseDelayMs  — default 10000 (10s → 20s → 40s)
 * @returns {Promise<Response>}
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 10_000) {
    let lastRes;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            lastRes = await fn();
            if (lastRes.status !== 429) return lastRes;
        } catch (err) {
            if (attempt === maxRetries) throw err;
        }

        if (attempt < maxRetries) {
            const delay = baseDelayMs * Math.pow(2, attempt); // 10s, 20s, 40s
            console.warn(`[retry] Attempt ${attempt + 1} got 429. Retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    return lastRes; // return final 429 after all retries exhausted
}

module.exports = { parseEventHeaders, readEventFrame, normalizeBedRockError, withRetry };
