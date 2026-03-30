// =============================================================================
// Stealth Service — Rate limiting, jitter, ghost-text, and human-like patterns
// Ported from line-harness-oss and adapted for X API (pay-per-use)
// =============================================================================

// ─── Zero-Width Ghost Characters ───────────────────────────────
// Unicode zero-width characters that are invisible to users but make
// each message unique at the byte level, helping avoid duplicate-detection
// filters and automated spam classifiers.

const GHOST_CHARS = [
  '\u200B', // Zero Width Space
  '\u200C', // Zero Width Non-Joiner
  '\u200D', // Zero Width Joiner
  '\u2060', // Word Joiner
  '\uFEFF', // Zero Width No-Break Space
];

/**
 * Append a random sequence of ghost characters to the end of a message.
 * Each message gets a unique invisible fingerprint (2–4 chars).
 */
export function appendGhostText(text: string): string {
  const count = 2 + Math.floor(Math.random() * 3); // 2-4 ghost chars
  let ghost = '';
  for (let i = 0; i < count; i++) {
    ghost += GHOST_CHARS[Math.floor(Math.random() * GHOST_CHARS.length)];
  }
  return text + ghost;
}

// ─── Message Tail Variation ────────────────────────────────────
// Randomizes the ending of messages to prevent pattern-based detection.
// Similar to line-harness-oss stealth patterns.

const TAIL_VARIATIONS = [
  '',        // no change
  ' ',       // trailing half-width space
  '　',      // trailing full-width space
  '\n',      // trailing newline
  ' \n',     // space + newline
];

/**
 * Apply a random tail variation to a message.
 * Combined with ghost text, this makes every message uniquely different
 * at the byte level even when the visible content is identical.
 */
export function varyMessageTail(text: string): string {
  const tail = TAIL_VARIATIONS[Math.floor(Math.random() * TAIL_VARIATIONS.length)];
  return text + tail;
}

/**
 * Full stealth transformation for outgoing DMs / bulk messages.
 * Applies tail variation + ghost text to make each message unique.
 */
export function stealthTransform(text: string): string {
  return appendGhostText(varyMessageTail(text));
}

// ─── Timing Controls ──────────────────────────────────────────

/**
 * Add random jitter to a delay in milliseconds.
 */
export function addJitter(baseMs: number, jitterRangeMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterRangeMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate staggered delay for bulk operations.
 * Spreads API calls over time to mimic human-like usage patterns.
 * Tuned for X API pay-per-use — conservative to avoid 429s and account flags.
 */
export function calculateStaggerDelay(
  totalOperations: number,
  batchIndex: number,
): number {
  if (totalOperations <= 5) {
    // Small batch: 200-1000ms jitter
    return addJitter(200, 800);
  }

  if (totalOperations <= 20) {
    // Medium batch: spread over ~1 minute
    const baseDelay = (60_000 / totalOperations) * batchIndex;
    return addJitter(baseDelay, 2000);
  }

  // Large batch: spread over ~3 minutes with higher jitter
  const baseDelay = (180_000 / totalOperations) * batchIndex;
  return addJitter(baseDelay, 5000);
}

/**
 * Calculate randomized delay specifically for DM bulk sends.
 * DMs are more scrutinized than tweets — use wider, more unpredictable delays.
 * Range: 3-15 seconds between messages (human-like DM pacing).
 */
export function calculateDmDelay(batchIndex: number): number {
  const baseDelay = 3000 + (batchIndex * 500); // progressive slowdown
  return addJitter(baseDelay, 12_000);           // +0~12s random jitter
}

// ─── Rate Limiter ─────────────────────────────────────────────

/**
 * Rate limiter for X API calls.
 * X API pay-per-use: billed per request. We rate-limit to avoid
 * 429 errors and suspicious activity flags, not to save cost.
 */
export class StealthRateLimiter {
  private callCount = 0;
  private windowStart = Date.now();
  private readonly maxCallsPerWindow: number;
  private readonly windowMs: number;

  constructor(maxCallsPerWindow = 15, windowMs = 900_000) {
    // Default: 15 calls per 15 minutes (X API rate limit window)
    this.maxCallsPerWindow = maxCallsPerWindow;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.callCount >= this.maxCallsPerWindow) {
      const waitTime = this.windowMs - (now - this.windowStart) + addJitter(100, 500);
      await sleep(waitTime);
      this.callCount = 0;
      this.windowStart = Date.now();
    }

    this.callCount++;
  }
}
