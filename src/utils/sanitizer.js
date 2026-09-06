/**
 * Payload Sanitizer & Normalizer for Claude Code CLI impersonation.
 * Strips VS Code extension, Cursor, Cline, Desktop App, and SDK
 * signatures from incoming requests so the upstream only ever sees
 * traffic that looks like the official CLI.
 */

const { IDENTITY } = require('./cli-identity');

// ── Text-level scrubbing ────────────────────────────────────────

const TEXT_REPLACEMENTS = [
    // Identity phrases
    [/you are (cursor|cline|roo[\s-]?code|continue|windsurf|an ai agent in vscode|an ai assistant embedded in|a coding assistant in)/gi,
        "You are Claude Code"],
    [/\[(cursor|cline|roo[\s-]?code|continue|windsurf|vscode|visual studio code)\]/gi,
        "[Claude Code]"],

    // Extension / app references
    [/vscode[\s-]?extension/gi, "claude-code-cli"],
    [/cursor[\s-]?editor/gi, "claude-code-cli"],
    [/windsurf[\s-]?editor/gi, "claude-code-cli"],
    [/desktop[\s-]?app(lication)?/gi, "CLI"],

    // IDE commands that may appear in tool schemas or content
    [/vscode\.execute[A-Za-z]+/g, "claude_code.execute"],
    [/editor\.action\.[A-Za-z]+/g, "claude_code.action"],
];

// File path fragments that reveal the client environment
const PATH_PATTERNS = [
    /\.vscode[/\\]/gi,
    /\.cursor[/\\]/gi,
    /\.cline[/\\]/gi,
    /\.continue[/\\]/gi,
    /\.windsurf[/\\]/gi,
];

function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    let clean = str;
    for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
        clean = clean.replace(pattern, replacement);
    }
    return clean;
}

// ── System prompt scrubbing ─────────────────────────────────────

function sanitizeSystem(system) {
    if (!system) return system;
    if (typeof system === 'string') return sanitizeString(system);
    if (Array.isArray(system)) {
        return system.map(item => {
            if (typeof item === 'string') return sanitizeString(item);
            if (item && item.type === 'text' && typeof item.text === 'string') {
                return { ...item, text: sanitizeString(item.text) };
            }
            return item;
        });
    }
    return system;
}

// ── Message content scrubbing ───────────────────────────────────

function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(msg => {
        if (!msg) return msg;
        if (typeof msg.content === 'string') {
            return { ...msg, content: sanitizeString(msg.content) };
        }
        if (Array.isArray(msg.content)) {
            const cleanContent = msg.content.map(block => {
                if (block && block.type === 'text' && typeof block.text === 'string') {
                    return { ...block, text: sanitizeString(block.text) };
                }
                // Scrub tool_use names that reveal IDE origin
                if (block && block.type === 'tool_use' && typeof block.name === 'string') {
                    let name = block.name;
                    name = name.replace(/^(vscode|cursor|cline|windsurf)[_.-]/i, 'cli_');
                    return { ...block, name };
                }
                return block;
            });
            return { ...msg, content: cleanContent };
        }
        return msg;
    });
}

// ── Top-level payload scrubbing ─────────────────────────────────

/**
 * Fields that non-CLI clients sometimes attach and that would
 * reveal this isn't real CLI traffic.
 */
const FIELDS_TO_STRIP = [
    'context_management',      // VS Code extension field
    'client_info',             // some SDKs attach this
    'ide',                     // Cursor sends this
    'editor',                  // some wrappers attach this
    'source',                  // sometimes set to "vscode" / "cursor"
];

function sanitizePayload(parsedPayload) {
    if (!parsedPayload || typeof parsedPayload !== 'object') return parsedPayload;

    const payload = { ...parsedPayload };

    // Strip non-CLI fields
    for (const field of FIELDS_TO_STRIP) {
        delete payload[field];
    }

    // Clean system prompt
    if (payload.system) {
        payload.system = sanitizeSystem(payload.system);
    }

    // Clean messages
    if (payload.messages) {
        payload.messages = sanitizeMessages(payload.messages);
    }

    // Ensure metadata looks like CLI (not desktop/extension)
    if (payload.metadata) {
        // Strip any IDE-specific metadata keys
        delete payload.metadata.ide;
        delete payload.metadata.editor;
        delete payload.metadata.extension_version;
        delete payload.metadata.vscode_version;
        delete payload.metadata.cursor_version;
    }

    return payload;
}

module.exports = { sanitizePayload, sanitizeString };
