# Specification: OpenCode DataProxy-Rotate Plugin

## Goal
A dedicated OpenCode plugin for **DataProxy-Rotate (DPR)**. It routes model requests through your DPR phone proxy and automatically rotates the mobile IP when a rate limit (HTTP 429) occurs, retrying the request without interrupting your coding session.

---

## Configuration

The user configures DPR connection details:
* **DPR Address**: Phone IP and port (e.g., `192.168.1.50:1080`).
* **Auth**: Username & password (if enabled in DPR).
* **Max Rotation Attempts**: Number of rotation retries before giving up (default: 3).
* **Poll Interval & Timeout**: Poll `GET /status` every 500ms up to 15s timeout.

---

## User Flows & Behaviors

### Flow 1: Turn Proxy On / Off (Toggle)
* User can toggle DPR proxy routing **ON** or **OFF** at any time.
* When **OFF**: All requests bypass DPR and connect directly.
* When **ON**: All model requests route through DPR.

### Flow 2: Normal Request Flow
1. User sends a prompt in OpenCode.
2. If DPR is **OFF**, request connects directly to the provider.
3. If DPR is **ON**, request routes through DPR's SOCKS5 proxy.
4. Provider responds successfully $\rightarrow$ User sees response normally.

### Flow 3: Rate Limit Detection & Auto-Rotation Flow
1. OpenCode receives a response from the provider:
   * **If Short-term Throttling (temporary RPM / server busy 429)**:
     * Wait a few seconds and retry without rotating.
   * **If Provider Error (400, 401, 403, 500)**:
     * Pass the error straight to the user. Do not rotate.
   * **If Daily Quota Limit Reached (Free Tier 429)**:
     1. Plugin sends `POST /rotate` to DPR.
     2. Plugin polls `GET /status` until DPR returns `"state": "succeeded"`.
     3. Once confirmed, plugin immediately replays the original request over the new IP.
     4. If the retry succeeds, the user receives the answer seamlessly.
2. **Failure Handling**:
   * If rotation fails or times out, or if all retry attempts are exhausted, the plugin stops and shows a clear error message.

### Flow 4: Connectivity Issues
* If the DPR phone proxy is offline or unreachable (e.g., Wi-Fi disconnected or app not running), the plugin informs the user that DPR is unreachable rather than hanging indefinitely.
