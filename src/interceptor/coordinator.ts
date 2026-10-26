import { DPRClient, type DPRRotationResult } from "../client/dpr";
import type { DPRConfig } from "../config";

export class RotationCoordinator {
  private client: DPRClient;
  private maxAttempts: number;
  private currentAttempt = 0;

  constructor(config: DPRConfig, client?: DPRClient) {
    this.client = client || new DPRClient(config);
    this.maxAttempts = config.maxAttempts;
  }

  /**
   * Performs mobile IP rotation and returns true if succeeded.
   */
  async rotate(signal?: AbortSignal): Promise<DPRRotationResult> {
    if (this.currentAttempt >= this.maxAttempts) {
      return {
        success: false,
        state: "failed",
        reason: `Exhausted all ${this.maxAttempts} rotation retry attempts`,
        attempts: this.currentAttempt,
      };
    }

    this.currentAttempt++;
    console.log(
      `[DPR] Daily rate limit reached. Rotating mobile IP via phone (attempt ${this.currentAttempt}/${this.maxAttempts})...`
    );

    const result = await this.client.rotateAndWait(signal);

    if (result.success) {
      const ipNotice = result.ipAfter ? ` (new IP: ${result.ipAfter})` : "";
      console.log(
        `[DPR] IP rotated successfully${ipNotice}. Replaying request...`
      );
    } else {
      console.warn(
        `[DPR] Rotation attempt ${this.currentAttempt} failed: ${result.reason || "Unknown error"}`
      );
    }

    return result;
  }

  resetAttempts(): void {
    this.currentAttempt = 0;
  }

  getAttempts(): number {
    return this.currentAttempt;
  }

  isExhausted(): boolean {
    return this.currentAttempt >= this.maxAttempts;
  }
}
