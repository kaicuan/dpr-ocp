import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  stripJsonComments,
  loadConfig,
  updateConfigFile,
  DEFAULT_CONFIG_TEMPLATE,
} from "../src/config";

describe("DPR Config Management", () => {
  const tmpDir = path.join(os.tmpdir(), `dpr-test-${Date.now()}`);
  const tmpConfig = path.join(tmpDir, "dpr.jsonc");

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    delete process.env.DPR_ADDRESS;
    delete process.env.DPR_ENABLED;
    delete process.env.DPR_AUTH;
  });

  test("stripJsonComments removes single-line and multi-line comments and trailing commas", () => {
    const raw = `
    // comment 1
    {
      "address": "127.0.0.1:1080", /* inline comment */
      "enabled": true,
    }
    `;
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned);
    expect(parsed.address).toBe("127.0.0.1:1080");
    expect(parsed.enabled).toBe(true);
  });

  test("loadConfig auto-generates default template when file is missing", () => {
    expect(fs.existsSync(tmpConfig)).toBe(false);
    const config = loadConfig(tmpConfig);
    expect(fs.existsSync(tmpConfig)).toBe(true);
    expect(config.address).toBe("127.0.0.1:1080");
    expect(config.enabled).toBe(true);
    expect(config.maxAttempts).toBe(3);
  });

  test("loadConfig merges inline options and env vars", () => {
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({ address: "192.168.1.10:1080", enabled: false })
    );

    process.env.DPR_ADDRESS = "192.168.1.99:9090";
    process.env.DPR_AUTH = "admin:secret";

    const config = loadConfig(tmpConfig, { enabled: true });
    expect(config.address).toBe("192.168.1.99:9090");
    expect(config.enabled).toBe(true);
    expect(config.auth?.username).toBe("admin");
    expect(config.auth?.password).toBe("secret");
  });

  test("updateConfigFile modifies and persists configuration changes", () => {
    loadConfig(tmpConfig);
    updateConfigFile({ enabled: false, address: "10.0.0.5:1080" }, tmpConfig);

    const reloaded = loadConfig(tmpConfig);
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.address).toBe("10.0.0.5:1080");
  });
});
