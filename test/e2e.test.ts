import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import { createMockSocksServer, type MockSocksServer } from "./mock-socks";
import { createInterceptedFetch } from "../src/interceptor/fetch";
import { DPRClient } from "../src/client/dpr";
import { RotationCoordinator } from "../src/interceptor/coordinator";
import type { DPRConfig } from "../src/config";

describe("E2E Rate Limit 429 Interception & Auto-Rotation Flow", () => {
  let mockHttpServer: http.Server;
  let httpPort: number;
  let mockSocksServer: MockSocksServer;
  let requestAttempts = 0;
  let dprRotated = false;

  beforeAll(async () => {
    // 1. Mock Upstream Provider (simulating opencode.ai free model endpoint)
    mockHttpServer = http.createServer((req, res) => {
      requestAttempts++;

      if (requestAttempts === 1) {
        // First attempt: Rate limit daily quota exhausted
        res.writeHead(429, {
          "Content-Type": "application/json",
          "Retry-After": "3600",
        });
        res.end(
          JSON.stringify({
            error: {
              message: "Daily quota limit reached for free models. Resets at midnight.",
            },
          })
        );
        return;
      }

      // Second attempt (after mobile IP rotation): Success!
      res.writeHead(200, {
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify({
          id: "chatcmpl-123",
          choices: [{ message: { content: "Seamless answer after IP rotation!" } }],
        })
      );
    });

    await new Promise<void>((resolve) => {
      mockHttpServer.listen(0, "127.0.0.1", () => {
        const addr = mockHttpServer.address() as any;
        httpPort = addr.port;
        resolve();
      });
    });

    // 2. Mock SOCKS5 Proxy pointing to mock HTTP server
    mockSocksServer = await createMockSocksServer(httpPort);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockHttpServer.close(() => resolve()));
    await mockSocksServer.close();
  });

  test("Automatically intercepts 429, triggers rotation, and replays request to success", async () => {
    // Mock DPR client that succeeds rotation
    const mockDPRClient = {
      rotateAndWait: async () => {
        dprRotated = true;
        return {
          success: true,
          state: "succeeded" as const,
          ipBefore: "100.64.0.1",
          ipAfter: "100.64.0.2",
        };
      },
    } as unknown as DPRClient;

    const config: DPRConfig = {
      address: `127.0.0.1:${mockSocksServer.port}`,
      enabled: true,
      maxAttempts: 3,
      pollIntervalMs: 50,
      pollTimeoutMs: 2000,
    };

    const coordinator = new RotationCoordinator(config, mockDPRClient);
    const interceptor = createInterceptedFetch({ config, coordinator });
    interceptor.install();

    // Send request to opencode inference endpoint (note: use http:// for local mock without tls cert)
    // We test with http://opencode.ai/inference/... which triggers our interceptor
    const response = await fetch(
      "http://opencode.ai/inference/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer public",
        },
        body: JSON.stringify({
          model: "opencode/deepseek-v4.1-flash-free",
          messages: [{ role: "user", content: "Hello AI!" }],
        }),
      }
    );

    // Assert that the user receives 200 OK seamlessly!
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe(
      "Seamless answer after IP rotation!"
    );
    expect(dprRotated).toBe(true);
    expect(requestAttempts).toBe(2);

    interceptor.restore();
  });
});
