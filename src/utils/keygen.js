const crypto = require('crypto');

function generateKey(length = 32) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = crypto.randomBytes(length * 2);
    const result = [];
    for (let i = 0; i < bytes.length && result.length < length; i++) {
        if (bytes[i] < 250) {
            result.push(chars[bytes[i] % chars.length]);
        }
    }
    return result.join("");
}

module.exports = { generateKey };
