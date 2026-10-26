import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { DPRClient } from "../src/client/dpr";
import { buildSocksUrl, testSocksConnection } from "../src/client/socks";
import type { DPRConfig } from "../src/config";

describe("DPR Client & SOCKS Networking", () => {
  let mockServer: http.Server;
  let serverPort: number;
  let rotationState: "idle" | "running" | "succeeded" | "failed" | "unverified" = "idle";
  let pollCount = 0;

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://127.0.0.1:${serverPort}`);

      if (url.pathname === "/status" && req.method === "GET") {
        pollCount++;
        if (rotationState === "running" && pollCount > 2) {
          rotationState = "succeeded";
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            state: rotationState,
            ipBefore: "10.0.0.1",
            ipAfter: rotationState === "succeeded" ? "10.0.0.2" : undefined,
            attempts: 1,
          })
        );
        return;
      }

      if (url.pathname === "/rotate" && req.method === "POST") {
        rotationState = "running";
        pollCount = 0;
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ state: "accepted" }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const address = mockServer.address() as any;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  test("buildSocksUrl generates proper socks5h URLs with remote DNS", () => {
    const plain = buildSocksUrl({ address: "192.168.1.50:1080" });
    expect(plain).toBe("socks5h://192.168.1.50:1080");

    const withAuth = buildSocksUrl({
      address: "192.168.1.50:1080",
      auth: { username: "user", password: "pwd" },
    });
    expect(withAuth).toBe("socks5h://user:pwd@192.168.1.50:1080");
  });

  test("testSocksConnection succeeds against open mock port", async () => {
    const res = await testSocksConnection(`127.0.0.1:${serverPort}`);
    expect(res.reachable).toBe(true);
  });

  test("DPRClient performs full rotateAndWait lifecycle", async () => {
    const config: DPRConfig = {
      address: `127.0.0.1:${serverPort}`,
      enabled: true,
      maxAttempts: 3,
      pollIntervalMs: 50,
      pollTimeoutMs: 3000,
    };

    const client = new DPRClient(config);
    expect(await client.isReachable()).toBe(true);

    const initialStatus = await client.getStatus();
    expect(initialStatus.state).toBe("idle");

    const result = await client.rotateAndWait();
    expect(result.success).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.ipBefore).toBe("10.0.0.1");
    expect(result.ipAfter).toBe("10.0.0.2");
  });
});
