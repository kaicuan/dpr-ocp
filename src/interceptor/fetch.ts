import type { DPRConfig } from "../config";
import { classifyRateLimit } from "./classifier";
import { RotationCoordinator } from "./coordinator";
import { socksHttpRequest } from "./transport";

export interface InterceptorOptions {
  config: DPRConfig;
  coordinator?: RotationCoordinator;
}

/**
 * Checks if a URL targets OpenCode free model inference endpoints.
 */
export function isOpenCodeTarget(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === "opencode.ai" || host.endsWith(".opencode.ai")) {
      return (
        path.startsWith("/inference") ||
        path.startsWith("/zen") ||
        path.includes("/v1/chat/completions")
      );
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Creates an intercepted fetch handler that manages routing, rate-limit auto-rotation,
 * and strict fail-closed security.
 */
export function createInterceptedFetch(options: InterceptorOptions) {
  const originalFetch = globalThis.fetch;
  let activeConfig = { ...options.config };
  let coordinator =
    options.coordinator || new RotationCoordinator(activeConfig);

  const updateConfig = (newConfig: DPRConfig) => {
    activeConfig = { ...newConfig };
    coordinator = new RotationCoordinator(activeConfig);
  };

  const interceptedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    // Check if targeting OpenCode free inference
    const isTarget = isOpenCodeTarget(urlStr);

    // If DPR is OFF or request is not OpenCode free tier, bypass DPR completely
    if (!activeConfig.enabled || !isTarget) {
      return originalFetch(input, init);
    }

    // Prepare request parameters for replay
    const targetUrl = new URL(urlStr);
    const method = (init?.method || "GET").toUpperCase();

    // Prepare headers
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          headers[k.toLowerCase()] = v;
        }
      } else {
        for (const [k, v] of Object.entries(init.headers)) {
          if (v !== undefined) {
            headers[k.toLowerCase()] = String(v);
          }
        }
      }
    }

    // Buffer body for replayability
    let bodyBuffer: Buffer | null = null;
    if (init?.body) {
      if (typeof init.body === "string") {
        bodyBuffer = Buffer.from(init.body);
      } else if (init.body instanceof ArrayBuffer) {
        bodyBuffer = Buffer.from(init.body);
      } else if (Buffer.isBuffer(init.body)) {
        bodyBuffer = init.body;
      } else if (init.body instanceof Uint8Array) {
        bodyBuffer = Buffer.from(init.body);
      }
    }

    // Replay loop
    let currentAttempt = 0;
    const maxAttempts = activeConfig.maxAttempts;

    while (currentAttempt <= maxAttempts) {
      currentAttempt++;

      let response: Response;
      try {
        response = await socksHttpRequest({
          targetUrl,
          method,
          headers,
          bodyBuffer,
          config: activeConfig,
          signal: init?.signal || undefined,
        });
      } catch (err: any) {
        // Strict Fail-Closed: If DPR SOCKS is unreachable, never leak direct IP
        const errMsg =
          err.message ||
          `[DPR Error] DataProxy phone proxy is unreachable at ${activeConfig.address}. Please ensure the phone is connected to Wi-Fi and DataProxy is running.`;
        console.error(errMsg);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }

      // If status is not 429, return immediately (success or provider 4xx/5xx error)
      if (response.status !== 429) {
        coordinator.resetAttempts();
        return response;
      }

      // Read response body to classify 429
      const bodyText = await response.text();
      const classification = classifyRateLimit(response.headers, bodyText);

      if (classification.type === "short_term_throttle") {
        // Wait and retry over the same IP without rotating
        const waitMs = Math.min(classification.cooldownSeconds * 1000, 10000);
        console.log(
          `[DPR] Short-term throttle detected (${classification.cooldownSeconds}s). Waiting ${classification.cooldownSeconds}s before direct retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      // Daily quota limit -> Trigger DPR rotation
      if (coordinator.isExhausted()) {
        const errMsg = `[DPR Error] Mobile IP rotation failed after ${maxAttempts} attempts. Stopping request to protect IP.`;
        console.error(errMsg);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }

      const rotateResult = await coordinator.rotate(init?.signal || undefined);

      if (!rotateResult.success) {
        const errMsg = `[DPR Error] Rotation failed: ${rotateResult.reason || "Unknown error"}. Request aborted.`;
        console.error(errMsg);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Exhausted retries
    const finalErr = `[DPR Error] Mobile IP rotation retry limit exceeded (${maxAttempts} attempts).`;
    return new Response(JSON.stringify({ error: finalErr }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    interceptedFetch,
    updateConfig,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    install: () => {
      globalThis.fetch = interceptedFetch as any;
    },
  };
}
