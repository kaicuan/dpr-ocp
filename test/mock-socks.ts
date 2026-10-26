import net from "node:net";

export interface MockSocksServer {
  server: net.Server;
  port: number;
  close: () => Promise<void>;
}

export function createMockSocksServer(targetHttpPort: number): Promise<MockSocksServer> {
  return new Promise((resolve) => {
    const server = net.createServer((clientSocket) => {
      let state: "auth" | "connect" | "pipe" = "auth";

      clientSocket.on("data", (data) => {
        if (state === "auth") {
          // Version 5 handshake
          if (data[0] === 0x05) {
            clientSocket.write(Buffer.from([0x05, 0x00])); // No auth
            state = "connect";
          }
          return;
        }

        if (state === "connect") {
          // Connect command
          if (data[0] === 0x05 && data[1] === 0x01) {
            // Forward connection to local targetHttpPort
            const targetSocket = net.connect(targetHttpPort, "127.0.0.1", () => {
              // SOCKS5 success reply
              clientSocket.write(
                Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0])
              );
              state = "pipe";
              clientSocket.pipe(targetSocket);
              targetSocket.pipe(clientSocket);
            });

            targetSocket.on("error", () => {
              clientSocket.destroy();
            });
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        server,
        port: addr.port,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
