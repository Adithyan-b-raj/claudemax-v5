/**
 * Request Queue — Option 4
 *
 * Ensures outbound requests to AWS Bedrock are sent at a controlled rate,
 * preventing burst spikes that trigger ThrottlingException.
 *
 * Config (via env):
 *   BEDROCK_QUEUE_INTERVAL_MS  — ms to wait between requests (default: 500)
 *   BEDROCK_QUEUE_CONCURRENCY  — max simultaneous requests (default: 2)
 */

const INTERVAL_MS = parseInt(process.env.BEDROCK_QUEUE_INTERVAL_MS || "500");
const CONCURRENCY = parseInt(process.env.BEDROCK_QUEUE_CONCURRENCY || "2");

const queue = [];
let active = 0;
let lastSent = 0;

function processQueue() {
    if (active >= CONCURRENCY || queue.length === 0) return;

    const now = Date.now();
    const delay = Math.max(0, INTERVAL_MS - (now - lastSent));

    setTimeout(async () => {
        if (active >= CONCURRENCY || queue.length === 0) return;

        const { fn, resolve, reject } = queue.shift();
        active++;
        lastSent = Date.now();

        try {
            resolve(await fn());
        } catch (e) {
            reject(e);
        } finally {
            active--;
            processQueue(); // pick up next item
        }
    }, delay);
}

/**
 * Enqueue a function to run when a slot is available.
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function enqueue(fn) {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
    });
}

/** Current queue depth — exposed for admin monitoring */
function queueDepth() {
    return queue.length;
}

module.exports = { enqueue, queueDepth };
