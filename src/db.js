const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { nextRefillTime } = require('./utils/time');

const dbPath = path.join(__dirname, '../data/bedrock.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function initDB() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      api_key               TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      expires_at            TEXT NOT NULL,
      token_limit           INTEGER NOT NULL DEFAULT 0,
      tokens_used           INTEGER NOT NULL DEFAULT 0,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      cache_tokens          INTEGER NOT NULL DEFAULT 0,
      has_refill            INTEGER NOT NULL DEFAULT 0,
      tokens_refill_at      TEXT,
      refill_interval       TEXT DEFAULT '5h',
      bound_ip              TEXT DEFAULT NULL,
      total_tokens_used     INTEGER NOT NULL DEFAULT 0,
      total_input_tokens    INTEGER NOT NULL DEFAULT 0,
      total_output_tokens   INTEGER NOT NULL DEFAULT 0,
      total_cache_tokens    INTEGER NOT NULL DEFAULT 0
    )
  `);

    // Stores one row per completed refill window
    db.exec(`
    CREATE TABLE IF NOT EXISTS usage_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key         TEXT NOT NULL,
      window_type     TEXT NOT NULL,
      window_start    TEXT NOT NULL,
      window_end      TEXT NOT NULL,
      tokens_used     INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_tokens    INTEGER NOT NULL DEFAULT 0
    )
  `);

    // Migrations for existing databases — silently skip if column already exists
    const migrations = [
        `ALTER TABLE api_keys ADD COLUMN bound_ip TEXT DEFAULT NULL`,
        `ALTER TABLE api_keys ADD COLUMN total_tokens_used INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE api_keys ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE api_keys ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE api_keys ADD COLUMN total_cache_tokens INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of migrations) {
        try { db.exec(sql); } catch (_) { /* column already exists */ }
    }
}

function getKey(apiKey) {
    return db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey);
}

function putKey(apiKey, record) {
    const hasRefill = record.hasRefill ? 1 : 0;
    const interval = record.refillInterval || "5h";
    const refillAt = record.hasRefill ? nextRefillTime(interval) : null;
    db.prepare(
        `INSERT OR REPLACE INTO api_keys
         (api_key, name, created_at, expires_at, token_limit,
          tokens_used, input_tokens, output_tokens, cache_tokens,
          has_refill, tokens_refill_at, refill_interval, bound_ip,
          total_tokens_used, total_input_tokens, total_output_tokens, total_cache_tokens)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, NULL, 0, 0, 0, 0)`
    ).run(apiKey, record.name, record.createdAt, record.expiresAt, record.tokenLimit ?? 0, hasRefill, refillAt, interval);
}

function deleteKey(apiKey) {
    db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(apiKey);
    db.prepare("DELETE FROM usage_history WHERE api_key = ?").run(apiKey);
}

function getAllKeys() {
    return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all();
}

function incrementTokens(apiKey, { input = 0, output = 0, cache = 0 } = {}) {
    const total = input + output + cache;
    if (total <= 0) return;
    db.prepare(
        `UPDATE api_keys SET
           tokens_used         = tokens_used         + ?,
           input_tokens        = input_tokens        + ?,
           output_tokens       = output_tokens       + ?,
           cache_tokens        = cache_tokens        + ?,
           total_tokens_used   = total_tokens_used   + ?,
           total_input_tokens  = total_input_tokens  + ?,
           total_output_tokens = total_output_tokens + ?,
           total_cache_tokens  = total_cache_tokens  + ?
         WHERE api_key = ?`
    ).run(total, input, output, cache, total, input, output, cache, apiKey);
}

function updateRefill(apiKey, enable, refillAt, interval) {
    db.prepare(
        "UPDATE api_keys SET has_refill = ?, tokens_refill_at = ?, refill_interval = ? WHERE api_key = ?"
    ).run(enable ? 1 : 0, refillAt, interval, apiKey);
}

function resetTokens(apiKey) {
    // Resets only the current-period counters; lifetime totals are preserved.
    db.prepare(
        "UPDATE api_keys SET tokens_used = 0, input_tokens = 0, output_tokens = 0, cache_tokens = 0 WHERE api_key = ?"
    ).run(apiKey);
}

function updateTokenLimit(apiKey, tokenLimit) {
    db.prepare("UPDATE api_keys SET token_limit = ? WHERE api_key = ?").run(tokenLimit, apiKey);
}

/**
 * Saves the completed window to usage_history, then resets current-period counters.
 * Lifetime totals (total_*) are never touched.
 */
function performRefillReset(apiKey, nextRefill) {
    const record = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey);

    // Only archive if there was any actual usage in this window
    if (record && record.tokens_used > 0) {
        const windowEnd = new Date().toISOString();
        // Estimate window start: current refill_at minus the interval duration
        const interval = record.refill_interval || '5h';
        const durationMs = interval === 'daily' ? 24 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
        const windowStart = new Date(new Date(record.tokens_refill_at).getTime() - durationMs).toISOString();

        db.prepare(
            `INSERT INTO usage_history
               (api_key, window_type, window_start, window_end,
                tokens_used, input_tokens, output_tokens, cache_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            apiKey, interval, windowStart, windowEnd,
            record.tokens_used, record.input_tokens, record.output_tokens, record.cache_tokens
        );
    }

    // Zero the current-period counters and advance the refill timestamp
    db.prepare(
        `UPDATE api_keys SET
           tokens_used = 0, input_tokens = 0, output_tokens = 0, cache_tokens = 0,
           tokens_refill_at = ?
         WHERE api_key = ?`
    ).run(nextRefill, apiKey);
}

function getKeyHistory(apiKey, limit = 20) {
    return db.prepare(
        "SELECT * FROM usage_history WHERE api_key = ? ORDER BY window_end DESC LIMIT ?"
    ).all(apiKey, limit);
}

function bindKeyIp(apiKey, ip) {
    db.prepare("UPDATE api_keys SET bound_ip = ? WHERE api_key = ? AND bound_ip IS NULL").run(ip, apiKey);
}

function resetKeyIp(apiKey) {
    db.prepare("UPDATE api_keys SET bound_ip = NULL WHERE api_key = ?").run(apiKey);
}

module.exports = {
    db,
    initDB,
    getKey,
    putKey,
    deleteKey,
    getAllKeys,
    incrementTokens,
    updateRefill,
    resetTokens,
    updateTokenLimit,
    performRefillReset,
    getKeyHistory,
    bindKeyIp,
    resetKeyIp,
};
