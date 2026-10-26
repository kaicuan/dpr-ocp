# DPR-OCP: OpenCode DataProxy-Rotate Plugin

An OpenCode plugin for **DataProxy-Rotate (DPR)**. It routes OpenCode free-tier model requests (`opencode/*` hitting `opencode.ai/inference/...`) through your DPR mobile cellular SOCKS5 proxy and automatically rotates the mobile IP when encountering daily rate limits (HTTP 429), replaying interrupted prompt requests seamlessly without disrupting your coding workflow.

All paid or direct providers (e.g., Anthropic, OpenAI, GitHub Copilot) bypass DPR completely and connect directly.

---

## Features

- **Selective Free-Tier Proxy Routing**:
  - Automatically targets only OpenCode free models (`opencode/*`).
  - Other providers and local tool network operations connect directly.
- **Automated HTTP 429 IP Rotation & Request Replay**:
  - **Short-Term RPM Throttling (<= 10s)**: Pauses for cooldown duration and retries without rotating.
  - **Daily Free Quota Limits (> 10s or quota messages)**: Sends `POST /rotate` to DPR, polls `GET /status` until verified, and immediately replays the original prompt over the new mobile IP.
  - **Informative Notices**: Prints clear console status notices so you understand the brief 3–5s pause.
- **Strict Fail-Closed Protection**:
  - Never leaks your real direct IP when DPR is enabled.
  - If the DPR phone proxy is offline or unreachable, the request aborts with an immediate diagnostic error.
- **Slash Commands & Assistant Tools**:
  - Control and inspect routing in real-time without restarting OpenCode.

---

## Installation

### Method 1: Local Path Integration (Development)

Add the local plugin directory path to your global `~/.config/opencode/opencode.json` (or workspace `opencode.json`):

```json
{
  "plugin": [
    "/home/zephy/proj/aip/dpr-ocp"
  ]
}
```

### Method 2: Global CLI Install

```bash
opencode plugin add /home/zephy/proj/aip/dpr-ocp
```

---

## Configuration

On first run, the plugin auto-generates a documented configuration file at:
`~/.config/opencode/dpr.jsonc`

```jsonc
// DataProxy-Rotate OpenCode Plugin Configuration
{
  // DPR phone IP and port
  "address": "192.168.1.50:1080",

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
```

### Environment Variable Overrides

You can also override settings via environment variables:
- `DPR_ADDRESS`: e.g. `192.168.1.50:1080`
- `DPR_ENABLED`: `true` or `false`
- `DPR_AUTH`: `username:password`

---

## Usage & Commands

Inside OpenCode's chat prompt, you can use dedicated slash commands:

* **`/dpr-status`**: Check DPR phone reachability, current rotation state, and active mobile IP.
* **`/dpr-on`**: Enable cellular proxy routing for OpenCode free models.
* **`/dpr-off`**: Disable proxy routing (all requests connect directly).
* **`/dpr-rotate`**: Trigger an immediate manual mobile IP rotation on the phone.

---

## Development & Testing

```bash
# Install dependencies
bun install

# Run full test suite (unit & mock network tests)
bun test

# Typecheck TypeScript source
bun run typecheck

# Build bundle and declaration files
bun run build
```
