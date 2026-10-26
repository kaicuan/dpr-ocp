import net from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { DPRConfig } from "../config";

export interface SocksAgentOptions {
  address: string;
  auth?: {
    username: string;
    password: string;
  };
}

export function buildSocksUrl(options: SocksAgentOptions): string {
  const cleanAddress = options.address
    .replace(/^https?:\/\//, "")
    .replace(/^socks5h?:\/\//, "");

  if (options.auth?.username && options.auth?.password) {
    const user = encodeURIComponent(options.auth.username);
    const pass = encodeURIComponent(options.auth.password);
    return `socks5h://${user}:${pass}@${cleanAddress}`;
  }

  return `socks5h://${cleanAddress}`;
}

export function createSocksAgent(config: DPRConfig): SocksProxyAgent {
  const url = buildSocksUrl({
    address: config.address,
    auth: config.auth,
  });

  return new SocksProxyAgent(url, {
    keepAlive: true,
    timeout: 30000,
  });
}

/**
 * Checks if the DPR SOCKS5 proxy port is reachable via raw TCP handshake.
 */
export async function testSocksConnection(
  address: string,
  timeoutMs = 3000
): Promise<{ reachable: boolean; error?: string }> {
  const cleanAddress = address
    .replace(/^https?:\/\//, "")
    .replace(/^socks5h?:\/\//, "");
  const [host, portStr] = cleanAddress.split(":");
  const port = parseInt(portStr || "1080", 10);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ reachable: true });
      }
    });

    socket.on("timeout", () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          reachable: false,
          error: `Connection timed out after ${timeoutMs}ms`,
        });
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ reachable: false, error: err.message });
      }
    });

    socket.connect(port, host);
  });
}
