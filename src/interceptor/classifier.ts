export type RateLimitType = "short_term_throttle" | "daily_quota_limit";

export interface RateLimitClassification {
  type: RateLimitType;
  cooldownSeconds: number;
  reason: string;
}

const HOUR_MIN_SEC_REGEX =
  /(?:resets? in|try again in|wait|retry after)\s*(?:(\d+)\s*(?:hours?|hrs?|h))?\s*(?:(\d+)\s*(?:minutes?|mins?|m))?\s*(?:(\d+)\s*(?:seconds?|secs?|s))?/i;

const QUOTA_KEYWORDS = [
  "daily limit",
  "daily quota",
  "quota exceeded",
  "free tier limit",
  "insufficient quota",
  "usage limit",
  "plan limit",
  "day limit",
];

/**
 * Parses cooldown seconds from Retry-After or rate limit reset headers.
 */
export function parseHeaderCooldown(headers: Headers): number | null {
  // 1. Retry-After header (seconds or HTTP date)
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const secs = parseInt(retryAfter.trim(), 10);
    if (!isNaN(secs) && secs >= 0) {
      return secs;
    }
    const targetDate = Date.parse(retryAfter);
    if (!isNaN(targetDate)) {
      const diffSecs = Math.ceil((targetDate - Date.now()) / 1000);
      return diffSecs > 0 ? diffSecs : 0;
    }
  }

  // 2. x-ratelimit-reset headers (timestamp or relative seconds)
  const resetKeys = [
    "x-ratelimit-reset",
    "ratelimit-reset",
    "x-ratelimit-reset-requests",
  ];
  for (const key of resetKeys) {
    const val = headers.get(key);
    if (val) {
      const num = parseInt(val.trim(), 10);
      if (!isNaN(num) && num > 0) {
        const nowSecs = Math.floor(Date.now() / 1000);
        if (num > nowSecs * 100) {
          // Milliseconds timestamp
          const diff = Math.ceil((num - Date.now()) / 1000);
          return diff > 0 ? diff : 0;
        } else if (num > nowSecs) {
          // Seconds timestamp
          return num - nowSecs;
        } else if (num < 86400 * 30) {
          // Relative seconds
          return num;
        }
      }
    }
  }

  return null;
}

/**
 * Parses duration from response body text using regex.
 */
export function parseBodyCooldown(body: string): number | null {
  const match = HOUR_MIN_SEC_REGEX.exec(body);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  const secs = match[3] ? parseInt(match[3], 10) : 0;

  const total = hours * 3600 + mins * 60 + secs;
  return total > 0 ? total : null;
}

/**
 * Classifies an HTTP 429 response into Short-term RPM throttling or Daily Quota limit.
 */
export function classifyRateLimit(
  headers: Headers,
  bodyText: string,
  shortTermThresholdSecs = 10
): RateLimitClassification {
  const lowerBody = bodyText.toLowerCase();

  // Check explicit daily quota keywords
  const isQuota = QUOTA_KEYWORDS.some((kw) => lowerBody.includes(kw));
  if (isQuota) {
    return {
      type: "daily_quota_limit",
      cooldownSeconds: 3600,
      reason: "Response body explicitly indicated daily quota or usage limit reached.",
    };
  }

  // Parse header cooldown
  const headerCooldown = parseHeaderCooldown(headers);
  if (headerCooldown !== null) {
    if (headerCooldown <= shortTermThresholdSecs) {
      return {
        type: "short_term_throttle",
        cooldownSeconds: headerCooldown,
        reason: `Header indicates short cooldown (${headerCooldown}s <= ${shortTermThresholdSecs}s).`,
      };
    } else {
      return {
        type: "daily_quota_limit",
        cooldownSeconds: headerCooldown,
        reason: `Header indicates extended rate limit cooldown (${headerCooldown}s > ${shortTermThresholdSecs}s).`,
      };
    }
  }

  // Parse body text duration
  const bodyCooldown = parseBodyCooldown(bodyText);
  if (bodyCooldown !== null) {
    if (bodyCooldown <= shortTermThresholdSecs) {
      return {
        type: "short_term_throttle",
        cooldownSeconds: bodyCooldown,
        reason: `Body text indicates short cooldown (${bodyCooldown}s <= ${shortTermThresholdSecs}s).`,
      };
    } else {
      return {
        type: "daily_quota_limit",
        cooldownSeconds: bodyCooldown,
        reason: `Body text indicates extended cooldown (${bodyCooldown}s > ${shortTermThresholdSecs}s).`,
      };
    }
  }

  // Default: In OpenCode free tier, an unadorned 429 on free models is a quota block
  return {
    type: "daily_quota_limit",
    cooldownSeconds: 3600,
    reason: "HTTP 429 without short-term throttle duration; treated as quota limit.",
  };
}
