import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

export const DPRAuthConfigSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const DPRConfigSchema = z.object({
  address: z.string().default("127.0.0.1:1080"),
  enabled: z.boolean().default(true),
  auth: DPRAuthConfigSchema.optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  pollIntervalMs: z.number().int().min(100).max(5000).default(500),
  pollTimeoutMs: z.number().int().min(1000).max(60000).default(15000),
});

export type DPRConfig = z.infer<typeof DPRConfigSchema>;

export const DEFAULT_CONFIG_TEMPLATE = `// DataProxy-Rotate OpenCode Plugin Configuration
{
  // DPR phone IP and port (e.g., "192.168.1.50:1080")
  "address": "127.0.0.1:1080",

  // Master toggle: when true, OpenCode free models route through DPR
  "enabled": true,

  // Maximum rotation retry attempts before failing (default: 3)
  "maxAttempts": 3,

  // Polling interval in ms for checking rotation status (default: 500)
  "pollIntervalMs": 500,

  // Max timeout in ms for rotation completion (default: 15000)
  "pollTimeoutMs": 15000

  // Optional HTTP / SOCKS auth if enabled in DataProxy
  // "auth": {
  //   "username": "user",
  //   "password": "password"
  // }
}
`;

/**
 * Strips single-line (//) and multi-line comments and trailing commas from JSONC.
 */
export function stripJsonComments(jsonc: string): string {
  // Strip comments while preserving strings
  const withoutComments = jsonc.replace(
    /("(?:\\.|[^"\\])*")|(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)/g,
    (match, str) => (str ? match : "")
  );

  // Strip trailing commas before } or ]
  return withoutComments.replace(/,(\s*[}\]])/g, "$1");
}

export function getDefaultConfigDir(): string {
  const home = os.homedir();
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configHome, "opencode");
}

export function getDefaultConfigPath(): string {
  return path.join(getDefaultConfigDir(), "dpr.jsonc");
}

/**
 * Loads configuration from file, merging with inline options and environment variables.
 */
export function loadConfig(
  customPath?: string,
  inlineOptions?: Record<string, unknown>
): DPRConfig {
  const filePath = customPath || getDefaultConfigPath();
  let fileData: Record<string, unknown> = {};

  if (!fs.existsSync(filePath)) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, DEFAULT_CONFIG_TEMPLATE, "utf-8");
    } catch {
      // If unable to write default file, proceed with defaults in memory
    }
  } else {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const cleaned = stripJsonComments(raw);
      fileData = JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[DPR] Failed to parse config file at ${filePath}:`, err);
    }
  }

  // Environment variables overrides
  const envOverrides: Record<string, unknown> = {};
  if (process.env.DPR_ADDRESS) {
    envOverrides.address = process.env.DPR_ADDRESS;
  }
  if (process.env.DPR_ENABLED !== undefined) {
    envOverrides.enabled = process.env.DPR_ENABLED === "true" || process.env.DPR_ENABLED === "1";
  }
  if (process.env.DPR_AUTH) {
    const [username, password] = process.env.DPR_AUTH.split(":");
    if (username && password) {
      envOverrides.auth = { username, password };
    }
  }

  const merged = {
    ...fileData,
    ...inlineOptions,
    ...envOverrides,
  };

  const parsed = DPRConfigSchema.safeParse(merged);
  if (!parsed.success) {
    console.warn("[DPR] Invalid configuration values, falling back to defaults:", parsed.error.format());
    return DPRConfigSchema.parse({});
  }

  return parsed.data;
}

/**
 * Updates a configuration key in the config file.
 */
export function updateConfigFile(
  updates: Partial<DPRConfig>,
  customPath?: string
): void {
  const filePath = customPath || getDefaultConfigPath();
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      existing = JSON.parse(stripJsonComments(raw));
    } catch {
      existing = {};
    }
  }

  const updated = {
    ...existing,
    ...updates,
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[DPR] Failed to update config file at ${filePath}:`, err);
  }
}
