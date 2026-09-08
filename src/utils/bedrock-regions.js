/**
 * Multi-Region Fallback — Option 2
 *
 * Rotates through AWS regions on 429 ThrottlingException.
 * Each region has an independent quota — this effectively multiplies
 * your available throughput by the number of configured regions.
 *
 * Config (via env):
 *   BEDROCK_REGIONS    — comma-separated list (default: us-east-1,us-west-2,eu-west-1)
 *   REGION_COOLDOWN_MS — how long (ms) to avoid a throttled region (default: 60000)
 *
 * Note: The us.anthropic.claude-sonnet-4-6 cross-region model ID works from
 * ANY region — AWS routes it internally. No changes to ANTHROPIC_MODEL needed.
 */

const REGIONS = (process.env.BEDROCK_REGIONS || "us-east-1,us-west-2,eu-west-1")
    .split(",")
    .map(r => r.trim())
    .filter(Boolean);

const COOLDOWN_MS = parseInt(process.env.REGION_COOLDOWN_MS || "60000");

/** Map of region → timestamp when cooldown expires */
const cooldowns = new Map();

/** Returns regions that are not currently in cooldown */
function getAvailableRegions() {
    const now = Date.now();
    return REGIONS.filter(r => !cooldowns.has(r) || cooldowns.get(r) < now);
}

/** Mark a region as throttled — skip it for COOLDOWN_MS */
function cooldownRegion(region) {
    console.warn(`[regions] ${region} throttled — cooling down for ${COOLDOWN_MS / 1000}s`);
    cooldowns.set(region, Date.now() + COOLDOWN_MS);
}

/**
 * Try fn(region) for each available region until one succeeds (non-429).
 * Cooled-down regions are automatically skipped.
 *
 * @param {(region: string) => Promise<Response>} fn
 * @returns {Promise<Response>} first non-429 response
 * @throws {Error} if all regions are exhausted or cooled down
 */
async function withRegionFallback(fn) {
    const available = getAvailableRegions();

    if (available.length === 0) {
        throw new Error("All Bedrock regions are currently throttled. Try again later.");
    }

    for (const region of available) {
        const res = await fn(region);
        if (res.status !== 429) return res;
        cooldownRegion(region);
    }

    throw new Error("All available Bedrock regions returned 429. Try again later.");
}

module.exports = { withRegionFallback, getAvailableRegions, REGIONS };
