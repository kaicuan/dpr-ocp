import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { DPRConfig } from "../config";
import { updateConfigFile } from "../config";
import { DPRClient } from "../client/dpr";

export function createDprTools(
  getConfig: () => DPRConfig,
  updateConfig: (cfg: DPRConfig) => void
): Record<string, ToolDefinition> {
  const dpr_status = tool({
    description:
      "Check DataProxy-Rotate (DPR) connection health, public IP, and routing toggle state.",
    args: {},
    async execute() {
      const config = getConfig();
      const client = new DPRClient(config);

      const reachable = await client.isReachable(3000);
      if (!reachable) {
        return `[DPR Status]
- Enabled: ${config.enabled ? "ON" : "OFF"}
- Address: ${config.address}
- Health: OFFLINE / UNREACHABLE (Ensure phone is on Wi-Fi and DataProxy is running)`;
      }

      try {
        const status = await client.getStatus();
        return `[DPR Status]
- Enabled: ${config.enabled ? "ON" : "OFF"}
- Address: ${config.address}
- Health: ONLINE
- Rotation State: ${status.state}
${status.ipBefore ? `- IP Before: ${status.ipBefore}\n` : ""}${
          status.ipAfter ? `- Active Mobile IP: ${status.ipAfter}\n` : ""
        }- Max Retries: ${config.maxAttempts}`;
      } catch (err: any) {
        return `[DPR Status]
- Enabled: ${config.enabled ? "ON" : "OFF"}
- Address: ${config.address}
- Error checking status: ${err.message}`;
      }
    },
  });

  const dpr_toggle = tool({
    description:
      "Toggle DataProxy-Rotate proxy routing ON or OFF for OpenCode free models.",
    args: {
      enable: tool.schema
        .boolean()
        .describe("Set to true to route free models through DPR, false for direct connection"),
    },
    async execute(args) {
      const current = getConfig();
      const isEnabled = Boolean(args.enable);
      const newConfig: DPRConfig = {
        ...current,
        enabled: isEnabled,
      };

      updateConfig(newConfig);
      updateConfigFile({ enabled: isEnabled });

      return `DataProxy-Rotate routing is now ${
        isEnabled ? "ENABLED (ON)" : "DISABLED (OFF - direct connection)"
      }.`;
    },
  });

  const dpr_rotate = tool({
    description:
      "Trigger an immediate manual mobile IP rotation on the DPR phone.",
    args: {},
    async execute() {
      const config = getConfig();
      const client = new DPRClient(config);

      const reachable = await client.isReachable(3000);
      if (!reachable) {
        return `[DPR Error] Cannot rotate: DataProxy phone is unreachable at ${config.address}.`;
      }

      const result = await client.rotateAndWait();
      if (result.success) {
        return `[DPR Rotation Success]
- New Mobile IP: ${result.ipAfter || "Updated"}
- Previous IP: ${result.ipBefore || "Unknown"}
- Status: ${result.state}`;
      } else {
        return `[DPR Rotation Failed]
- Reason: ${result.reason || "Unknown error"}
- Status: ${result.state}`;
      }
    },
  });

  return {
    dpr_status,
    dpr_toggle,
    dpr_rotate,
  };
}
