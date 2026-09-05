function nextISTResetTime(now = new Date()) {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istAsUtc = new Date(now.getTime() + IST_OFFSET_MS);
    const currentMinuteOfDay = istAsUtc.getUTCHours() * 60 + istAsUtc.getUTCMinutes();
    const slots = [0, 300, 600, 900, 1200]; // 00:00, 05:00, 10:00, 15:00, 20:00 IST
    const nextSlot = slots.find(s => s > currentMinuteOfDay);
    const next = new Date(istAsUtc);
    if (nextSlot !== undefined) {
        next.setUTCHours(nextSlot / 60, 0, 0, 0);
    } else {
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(0, 0, 0, 0);
    }
    return new Date(next.getTime() - IST_OFFSET_MS);
}

function nextISTMidnight(now = new Date()) {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istAsUtc = new Date(now.getTime() + IST_OFFSET_MS);
    istAsUtc.setUTCDate(istAsUtc.getUTCDate() + 1);
    istAsUtc.setUTCHours(0, 0, 0, 0);
    return new Date(istAsUtc.getTime() - IST_OFFSET_MS);
}

function nextRefillTime(interval) {
    const now = new Date();
    return interval === "daily" ? nextISTMidnight(now).toISOString() : nextISTResetTime(now).toISOString();
}

module.exports = { nextISTResetTime, nextISTMidnight, nextRefillTime };
