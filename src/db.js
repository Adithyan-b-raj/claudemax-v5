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
      api_key             TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      expires_at          TEXT NOT NULL,
      token_limit         INTEGER NOT NULL DEFAULT 0,
      tokens_used         INTEGER NOT NULL DEFAULT 0,
      input_tokens        INTEGER NOT NULL DEFAULT 0,
      output_tokens       INTEGER NOT NULL DEFAULT 0,
      cache_tokens        INTEGER NOT NULL DEFAULT 0,
      has_refill          INTEGER NOT NULL DEFAULT 0,
      tokens_refill_at    TEXT,
      refill_interval     TEXT DEFAULT '5h',
      bound_ip            TEXT DEFAULT NULL
    )
  `);

    try {
        db.exec(`ALTER TABLE api_keys ADD COLUMN bound_ip TEXT DEFAULT NULL`);
    } catch (err) {
        // Column already exists or table freshly created
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
        `INSERT OR REPLACE INTO api_keys (api_key, name, created_at, expires_at, token_limit, tokens_used, input_tokens, output_tokens, cache_tokens, has_refill, tokens_refill_at, refill_interval, bound_ip)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, NULL)`
    ).run(apiKey, record.name, record.createdAt, record.expiresAt, record.tokenLimit ?? 0, hasRefill, refillAt, interval);
}

function deleteKey(apiKey) {
    db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(apiKey);
}

function getAllKeys() {
    return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all();
}

function incrementTokens(apiKey, { input = 0, output = 0, cache = 0 } = {}) {
    const total = input + output + cache;
    if (total <= 0) return;
    db.prepare(
        "UPDATE api_keys SET tokens_used = tokens_used + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_tokens = cache_tokens + ? WHERE api_key = ?"
    ).run(total, input, output, cache, apiKey);
}

function updateRefill(apiKey, enable, refillAt, interval) {
    db.prepare(
        "UPDATE api_keys SET has_refill = ?, tokens_refill_at = ?, refill_interval = ? WHERE api_key = ?"
    ).run(enable ? 1 : 0, refillAt, interval, apiKey);
}

function resetTokens(apiKey) {
    db.prepare(
        "UPDATE api_keys SET tokens_used = 0, input_tokens = 0, output_tokens = 0, cache_tokens = 0 WHERE api_key = ?"
    ).run(apiKey);
}

function updateTokenLimit(apiKey, tokenLimit) {
    db.prepare("UPDATE api_keys SET token_limit = ? WHERE api_key = ?").run(tokenLimit, apiKey);
}

function performRefillReset(apiKey, nextRefill) {
    db.prepare(
        "UPDATE api_keys SET tokens_used = 0, input_tokens = 0, output_tokens = 0, cache_tokens = 0, tokens_refill_at = ? WHERE api_key = ?"
    ).run(nextRefill, apiKey);
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
    bindKeyIp,
    resetKeyIp,
};
