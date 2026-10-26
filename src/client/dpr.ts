import type { DPRConfig } from "../config";

export interface DPRStatusResponse {
  state: "idle" | "running" | "succeeded" | "failed" | "unverified";
  attempt?: number;
  attempts?: number;
  ipBefore?: string;
  ipAfter?: string;
  reason?: string;
  error?: string;
}

export interface DPRRotationResult {
  success: boolean;
  state: "succeeded" | "failed" | "unverified" | "timeout";
  ipBefore?: string;
  ipAfter?: string;
  reason?: string;
  attempts?: number;
}

export class DPRClient {
  private address: string;
  private authHeader?: string;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;

  constructor(config: DPRConfig) {
    this.address = config.address.replace(/^https?:\/\//, "").replace(/^socks5h?:\/\//, "");
    this.pollIntervalMs = config.pollIntervalMs;
    this.pollTimeoutMs = config.pollTimeoutMs;

    if (config.auth?.username && config.auth?.password) {
      const token = Buffer.from(
        `${config.auth.username}:${config.auth.password}`
      ).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  private getBaseUrl(): string {
    return `http://${this.address}`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.authHeader) {
      headers.Authorization = this.authHeader;
    }
    return headers;
  }

  /**
   * Checks if the DPR HTTP endpoint is reachable.
   */
  async isReachable(timeoutMs = 3000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.getBaseUrl()}/status`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.status === 200 || res.status === 401;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the current rotation status.
   */
  async getStatus(signal?: AbortSignal): Promise<DPRStatusResponse> {
    const res = await fetch(`${this.getBaseUrl()}/status`, {
      method: "GET",
      headers: this.getHeaders(),
      signal,
    });

    if (res.status === 401) {
      throw new Error("DPR authentication required or invalid credentials");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DPR GET /status failed (${res.status}): ${text}`);
    }

    return (await res.json()) as DPRStatusResponse;
  }

  /**
   * Sends POST /rotate to trigger rotation.
   */
  async triggerRotation(signal?: AbortSignal): Promise<{ accepted: boolean; error?: string }> {
    const res = await fetch(`${this.getBaseUrl()}/rotate`, {
      method: "POST",
      headers: this.getHeaders(),
      signal,
    });

    if (res.status === 202) {
      return { accepted: true };
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    const errorMsg = data.error || `HTTP ${res.status}`;

    if (res.status === 409 && errorMsg.includes("already running")) {
      return { accepted: true }; // Rotation in progress, treat as accepted for polling
    }

    return { accepted: false, error: errorMsg };
  }

  /**
   * Triggers rotation and polls until completion ("succeeded" / "unverified" / "failed").
   */
  async rotateAndWait(signal?: AbortSignal): Promise<DPRRotationResult> {
    const trigger = await this.triggerRotation(signal);
    if (!trigger.accepted) {
      return {
        success: false,
        state: "failed",
        reason: trigger.error || "Failed to trigger rotation",
      };
    }

    const startTime = Date.now();

    while (Date.now() - startTime < this.pollTimeoutMs) {
      if (signal?.aborted) {
        throw new Error("Rotation polling aborted");
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      try {
        const status = await this.getStatus(signal);

        if (status.state === "succeeded") {
          return {
            success: true,
            state: "succeeded",
            ipBefore: status.ipBefore,
            ipAfter: status.ipAfter,
            attempts: status.attempts,
          };
        }

        if (status.state === "unverified") {
          // Unverified means airplane mode cycled but STUN verification timed out or was blocked.
          // The IP did change / cellular reconnected, so traffic can continue.
          return {
            success: true,
            state: "unverified",
            ipBefore: status.ipBefore,
            ipAfter: status.ipAfter,
            reason: status.reason,
            attempts: status.attempts,
          };
        }

        if (status.state === "failed") {
          return {
            success: false,
            state: "failed",
            reason: status.reason || "DPR reports rotation failed",
            attempts: status.attempts,
          };
        }

        // status.state === "running" or "idle" -> continue polling
      } catch (err: any) {
        // Transient network drops can occur while phone is in airplane mode
        // Continue polling until timeout
      }
    }

    return {
      success: false,
      state: "timeout",
      reason: `Rotation timed out after ${this.pollTimeoutMs}ms`,
    };
  }
}
