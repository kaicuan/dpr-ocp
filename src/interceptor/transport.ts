import net from "node:net";
import tls from "node:tls";
import { Readable, Transform } from "node:stream";
import { SocksClient } from "socks";
import type { DPRConfig } from "../config";

/**
 * Decodes HTTP/1.1 chunked transfer encoding stream into raw payload stream.
 */
export class ChunkedDecoder extends Transform {
  private buffer = Buffer.alloc(0);
  private chunkSize: number | null = null;

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      if (this.chunkSize === null) {
        const idx = this.buffer.indexOf("\r\n");
        if (idx === -1) break;

        const line = this.buffer.subarray(0, idx).toString("utf-8").trim();
        this.buffer = this.buffer.subarray(idx + 2);
        if (!line) continue;

        const size = parseInt(line, 16);
        if (isNaN(size)) {
          return callback(new Error(`Invalid HTTP chunk size: ${line}`));
        }
        if (size === 0) {
          this.push(null); // End of stream
          return callback();
        }
        this.chunkSize = size;
      }

      if (this.chunkSize !== null) {
        if (this.buffer.length < this.chunkSize) break;

        const data = this.buffer.subarray(0, this.chunkSize);
        this.push(data);
        this.buffer = this.buffer.subarray(this.chunkSize);

        if (
          this.buffer.length >= 2 &&
          this.buffer[0] === 13 &&
          this.buffer[1] === 10
        ) {
          this.buffer = this.buffer.subarray(2); // strip trailing \r\n
        }
        this.chunkSize = null;
      }
    }
    callback();
  }
}

export interface SocksHttpOptions {
  targetUrl: URL;
  method: string;
  headers: Record<string, string>;
  bodyBuffer: Buffer | null;
  config: DPRConfig;
  signal?: AbortSignal;
}

/**
 * Performs a direct HTTP/HTTPS request through DPR's SOCKS5 proxy using raw sockets.
 * Fully compatible with Bun and Node.js runtimes.
 */
export async function socksHttpRequest(
  options: SocksHttpOptions
): Promise<Response> {
  const { targetUrl, method, headers, bodyBuffer, config, signal } = options;

  const cleanAddress = config.address
    .replace(/^https?:\/\//, "")
    .replace(/^socks5h?:\/\//, "");
  const [proxyHost, proxyPortStr] = cleanAddress.split(":");
  const proxyPort = parseInt(proxyPortStr || "1080", 10);

  const isHttps = targetUrl.protocol === "https:";
  const defaultPort = isHttps ? 443 : 80;
  const targetPort = targetUrl.port
    ? parseInt(targetUrl.port, 10)
    : defaultPort;

  // 1. Establish SOCKS5 tunnel
  let socket: net.Socket;
  try {
    const socksOptions: any = {
      proxy: {
        host: proxyHost,
        port: proxyPort,
        type: 5,
      },
      destination: {
        host: targetUrl.hostname,
        port: targetPort,
      },
      command: "connect",
      timeout: 10000,
    };

    if (config.auth?.username && config.auth?.password) {
      socksOptions.proxy.userId = config.auth.username;
      socksOptions.proxy.password = config.auth.password;
    }

    const info = await SocksClient.createConnection(socksOptions);
    socket = info.socket;
  } catch (err: any) {
    throw new Error(
      `[DPR Error] DataProxy phone proxy is unreachable at ${config.address}. Please ensure the phone is connected to Wi-Fi and DataProxy is running. (${err.message})`
    );
  }

  // 2. Wrap in TLS if HTTPS
  let stream: net.Socket | tls.TLSSocket = socket;
  if (isHttps) {
    stream = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket,
        servername: targetUrl.hostname,
      });

      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", (err) => reject(err));
    });
  }

  // 3. Build HTTP request wire payload
  const path = (targetUrl.pathname || "/") + targetUrl.search;
  let requestText = `${method} ${path} HTTP/1.1\r\n`;

  const reqHeaders: Record<string, string> = {
    ...headers,
    host: targetUrl.hostname,
    connection: "close",
  };

  if (bodyBuffer && bodyBuffer.length > 0) {
    reqHeaders["content-length"] = String(bodyBuffer.length);
  }

  for (const [key, value] of Object.entries(reqHeaders)) {
    requestText += `${key}: ${value}\r\n`;
  }
  requestText += "\r\n";

  // Send request wire bytes
  stream.write(Buffer.from(requestText, "utf-8"));
  if (bodyBuffer && bodyBuffer.length > 0) {
    stream.write(bodyBuffer);
  }

  // 4. Parse HTTP response header and stream body
  return new Promise<Response>((resolve, reject) => {
    let rawBuffer = Buffer.alloc(0);
    let headersParsed = false;
    let statusCode = 200;
    let statusText = "OK";
    const resHeaders = new Headers();
    const bodyPassThrough = new Readable({ read() {} });

    const onAbort = () => {
      stream.destroy();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        stream.destroy();
        return reject(
          new DOMException("The operation was aborted.", "AbortError")
        );
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.on("data", (chunk: Buffer) => {
      if (!headersParsed) {
        rawBuffer = Buffer.concat([rawBuffer, chunk]);
        const headerEnd = rawBuffer.indexOf("\r\n\r\n");

        if (headerEnd !== -1) {
          headersParsed = true;
          const headerString = rawBuffer
            .subarray(0, headerEnd)
            .toString("utf-8");
          const lines = headerString.split("\r\n");

          const statusLine = lines[0] || "HTTP/1.1 200 OK";
          const statusParts = statusLine.split(" ");
          statusCode = parseInt(statusParts[1] || "200", 10);
          statusText = statusParts.slice(2).join(" ") || "OK";

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const colon = line.indexOf(":");
            if (colon > 0) {
              const name = line.substring(0, colon).trim();
              const val = line.substring(colon + 1).trim();
              resHeaders.append(name, val);
            }
          }

          const remainingBytes = rawBuffer.subarray(headerEnd + 4);
          let responseStream: Readable = bodyPassThrough;

          const isChunked =
            resHeaders.get("transfer-encoding")?.toLowerCase() === "chunked";
          if (isChunked) {
            const decoder = new ChunkedDecoder();
            bodyPassThrough.pipe(decoder);
            responseStream = decoder;
          }

          const webStream = Readable.toWeb(
            responseStream
          ) as ReadableStream<Uint8Array>;
          const response = new Response(webStream, {
            status: statusCode,
            statusText,
            headers: resHeaders,
          });

          if (remainingBytes.length > 0) {
            bodyPassThrough.push(remainingBytes);
          }

          resolve(response);
        }
      } else {
        bodyPassThrough.push(chunk);
      }
    });

    stream.on("end", () => {
      bodyPassThrough.push(null);
    });

    stream.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (!headersParsed) {
        reject(err);
      } else {
        bodyPassThrough.destroy(err);
      }
    });
  });
}
