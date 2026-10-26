import { describe, expect, test } from "bun:test";
import {
  classifyRateLimit,
  parseHeaderCooldown,
  parseBodyCooldown,
} from "../src/interceptor/classifier";
import { RotationCoordinator } from "../src/interceptor/coordinator";
import { DPRClient } from "../src/client/dpr";

describe("429 Rate Limit Classifier & Coordinator", () => {
  test("parseHeaderCooldown handles numeric Retry-After seconds", () => {
    const headers = new Headers({ "retry-after": "5" });
    expect(parseHeaderCooldown(headers)).toBe(5);
  });

  test("parseHeaderCooldown handles x-ratelimit-reset timestamp", () => {
    const futureSecs = Math.floor(Date.now() / 1000) + 12;
    const headers = new Headers({ "x-ratelimit-reset": String(futureSecs) });
    const cooldown = parseHeaderCooldown(headers);
    expect(cooldown).toBeGreaterThanOrEqual(10);
    expect(cooldown).toBeLessThanOrEqual(13);
  });

  test("parseBodyCooldown extracts duration strings", () => {
    expect(parseBodyCooldown("Rate limit resets in 2 hours 15 minutes")).toBe(
      2 * 3600 + 15 * 60
    );
    expect(parseBodyCooldown("Please try again in 45 seconds")).toBe(45);
    expect(parseBodyCooldown("No time pattern")).toBeNull();
  });

  test("classifyRateLimit classifies short-term burst as short_term_throttle", () => {
    const headers = new Headers({ "retry-after": "3" });
    const result = classifyRateLimit(headers, "Too many requests");
    expect(result.type).toBe("short_term_throttle");
    expect(result.cooldownSeconds).toBe(3);
  });

  test("classifyRateLimit classifies daily quota body as daily_quota_limit", () => {
    const headers = new Headers();
    const result = classifyRateLimit(
      headers,
      "You have reached your daily quota for free tier models."
    );
    expect(result.type).toBe("daily_quota_limit");
  });

  test("classifyRateLimit classifies long cooldown as daily_quota_limit", () => {
    const headers = new Headers({ "retry-after": "3600" });
    const result = classifyRateLimit(headers, "Limit reached");
    expect(result.type).toBe("daily_quota_limit");
    expect(result.cooldownSeconds).toBe(3600);
  });

  test("RotationCoordinator respects maxAttempts limit", async () => {
    // Mock DPR client that always fails
    const mockClient = {
      rotateAndWait: async () => ({
        success: false,
        state: "failed" as const,
        reason: "SIMULATED_FAIL",
      }),
    } as unknown as DPRClient;

    const coordinator = new RotationCoordinator(
      {
        address: "127.0.0.1:1080",
        enabled: true,
        maxAttempts: 2,
        pollIntervalMs: 10,
        pollTimeoutMs: 100,
      },
      mockClient
    );

    expect(coordinator.isExhausted()).toBe(false);

    const res1 = await coordinator.rotate();
    expect(res1.success).toBe(false);
    expect(coordinator.getAttempts()).toBe(1);

    const res2 = await coordinator.rotate();
    expect(res2.success).toBe(false);
    expect(coordinator.getAttempts()).toBe(2);
    expect(coordinator.isExhausted()).toBe(true);

    const res3 = await coordinator.rotate();
    expect(res3.success).toBe(false);
    expect(res3.reason).toContain("Exhausted");
  });
});
