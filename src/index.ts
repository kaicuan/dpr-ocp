import type { Plugin, PluginInput, PluginOptions, Hooks } from "@opencode-ai/plugin";
import { loadConfig, type DPRConfig } from "./config";
import { createInterceptedFetch } from "./interceptor/fetch";
import { createDprTools } from "./tools/dpr";
import { registerDprCommands } from "./commands/dpr";

/**
 * DataProxy-Rotate (DPR) OpenCode Plugin.
 * Routes OpenCode free models through DPR cellular proxy and auto-rotates mobile IP on 429.
 */
export const dprPlugin: Plugin = async (
  _input: PluginInput,
  options?: PluginOptions
): Promise<Hooks> => {
  let currentConfig: DPRConfig = loadConfig(undefined, options as Record<string, unknown>);

  // Initialize and install in-process fetch interceptor
  const interceptor = createInterceptedFetch({ config: currentConfig });
  interceptor.install();

  // Create assistant tools for status, toggle, and manual rotation
  const tools = createDprTools(
    () => currentConfig,
    (updated: DPRConfig) => {
      currentConfig = updated;
      interceptor.updateConfig(updated);
    }
  );

  return {
    config: async (cfg) => {
      registerDprCommands(cfg);
    },
    tool: tools,
  };
};

export default dprPlugin;
