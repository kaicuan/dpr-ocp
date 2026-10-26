import type { Config } from "@opencode-ai/plugin";

export function registerDprCommands(config: Config): void {
  config.command = config.command || {};

  config.command["dpr-status"] = {
    description: "Check DataProxy-Rotate (DPR) phone proxy status and current mobile IP",
    template: "Check DPR phone proxy status using tool dpr_status",
  };

  config.command["dpr-on"] = {
    description: "Enable DPR proxy routing for OpenCode free models",
    template: "Enable DPR proxy routing using tool dpr_toggle with enable=true",
  };

  config.command["dpr-off"] = {
    description: "Disable DPR proxy routing and connect directly",
    template: "Disable DPR proxy routing using tool dpr_toggle with enable=false",
  };

  config.command["dpr-rotate"] = {
    description: "Trigger an immediate manual mobile IP rotation via DPR",
    template: "Trigger manual mobile IP rotation using tool dpr_rotate",
  };
}
