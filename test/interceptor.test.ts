import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  isOpenCodeTarget,
  createInterceptedFetch,
} from "../src/interceptor/fetch";
import type { DPRConfig } from "../src/config";
import type { RotationCoordinator } from "../src/interceptor/coordinator";

describe("Fetch Interceptor & Selective Routing", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("isOpenCodeTarget identifies free model endpoints accurately", () => {
    expect(
      isOpenCodeTarget("https://opencode.ai/inference/openai/v1/chat/completions")
    ).toBe(true);
    expect(isOpenCodeTarget("https://opencode.ai/zen/v1/models")).toBe(true);
    expect(isOpenCodeTarget("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(isOpenCodeTarget("https://api.openai.com/v1/chat/completions")).toBe(
      false
    );
    expect(isOpenCodeTarget("https://github.com")).toBe(false);
  });

  test("interceptedFetch bypasses DPR when config.enabled is false", async () => {
    let originalCalled = false;
    globalThis.fetch = async (input, init) => {
      originalCalled = true;
      return new Response("ok from original", { status: 200 });
    };

    const config: DPRConfig = {
      address: "127.0.0.1:1080",
      enabled: false,
      maxAttempts: 3,
      pollIntervalMs: 50,
      pollTimeoutMs: 1000,
    };

    const interceptor = createInterceptedFetch({ config });
    interceptor.install();

    const res = await fetch("https://opencode.ai/inference/openai/v1/chat/completions");
    expect(originalCalled).toBe(true);
    expect(await res.text()).toBe("ok from original");
  });

  test("interceptedFetch bypasses DPR for non-OpenCode targets even when enabled", async () => {
    let originalCalled = false;
    globalThis.fetch = async (input, init) => {
      originalCalled = true;
      return new Response("ok from anthropic", { status: 200 });
    };

    const config: DPRConfig = {
      address: "127.0.0.1:1080",
      enabled: true,
      maxAttempts: 3,
      pollIntervalMs: 50,
      pollTimeoutMs: 1000,
    };

    const interceptor = createInterceptedFetch({ config });
    interceptor.install();

    const res = await fetch("https://api.anthropic.com/v1/messages");
    expect(originalCalled).toBe(true);
    expect(await res.text()).toBe("ok from anthropic");
  });

  test("interceptedFetch enforces strict fail-closed when DPR proxy is down", async () => {
    // Point to non-existent port
    const config: DPRConfig = {
      address: "127.0.0.1:54321",
      enabled: true,
      maxAttempts: 3,
      pollIntervalMs: 50,
      pollTimeoutMs: 1000,
    };

    const interceptor = createInterceptedFetch({ config });
    interceptor.install();

    const res = await fetch("https://opencode.ai/inference/openai/v1/chat/completions");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("[DPR Error] DataProxy phone proxy is unreachable");
  });
});
