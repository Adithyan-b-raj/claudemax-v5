/**
 * Central CLI Identity Configuration
 * 
 * All fingerprint data for impersonating Claude Code CLI.
 * Update versions here when new releases come out — everything else
 * reads from this single file.
 */

const CLI_VERSION = "2.1.263";
const SDK_VERSION = "0.124.0";
const NODE_VERSION = "v22.16.0";
const ANTHROPIC_VERSION = "2023-06-01";

const IDENTITY = {
    cliVersion: CLI_VERSION,
    sdkVersion: SDK_VERSION,
    nodeVersion: NODE_VERSION,
    anthropicVersion: ANTHROPIC_VERSION,
    platform: "linux",
    arch: "x64",
};

/**
 * Returns the full set of headers that a real Claude Code CLI
 * request would send to Bedrock / Anthropic API.
 *
 * @param {string} bearerToken  — AWS bearer token
 * @param {object} [opts]       — optional overrides
 * @returns {object} headers object
 */
function getUpstreamHeaders(bearerToken, opts = {}) {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearerToken}`,
        "anthropic-version": ANTHROPIC_VERSION,

        // Primary client identifiers
        "User-Agent": `claude-code/${CLI_VERSION} node/${NODE_VERSION} ${IDENTITY.platform}-${IDENTITY.arch}`,
        "X-App-Name": "claude-code",
        "X-Client-Name": "claude-code",
        "X-Client-Version": CLI_VERSION,

        // Stainless SDK telemetry (Anthropic acqui-hire — all official SDKs send these)
        "x-stainless-lang": "js",
        "x-stainless-package-version": SDK_VERSION,
        "x-stainless-os": "Linux",
        "x-stainless-arch": "x64",
        "x-stainless-runtime": "node",
        "x-stainless-runtime-version": NODE_VERSION.replace(/^v/, ""),
        "x-stainless-retry-count": "0",

        ...opts,
    };
}

/**
 * Headers that should be stripped from incoming client requests
 * before processing, so the client's real identity never leaks
 * into logs or downstream forwarding.
 */
const STRIP_INCOMING_HEADERS = [
    "x-stainless-lang",
    "x-stainless-package-version",
    "x-stainless-os",
    "x-stainless-arch",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-retry-count",
    "x-app-name",
    "x-client-name",
    "x-client-version",
    "x-request-id",
    "anthropic-version",
    "x-api-key",
];

module.exports = {
    IDENTITY,
    getUpstreamHeaders,
    STRIP_INCOMING_HEADERS,
};
