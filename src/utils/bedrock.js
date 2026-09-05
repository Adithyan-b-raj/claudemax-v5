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

module.exports = { parseEventHeaders, readEventFrame, normalizeBedRockError };
