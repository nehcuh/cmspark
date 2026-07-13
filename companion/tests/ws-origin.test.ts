import test from "node:test"
import assert from "node:assert/strict"
import { isAllowedWsOrigin } from "../src/server"

// P0-2 / audit C1 regression: the WS Origin gate must accept only chrome-extension:// origins
// so a visited web page cannot open ws://127.0.0.1:23401 and drive the agent. Page JS cannot
// forge the browser-set Origin; a local process spoofing the header is a separate (P2) vector.

const ALLOW: Array<[string, string]> = [
  ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "valid 32-char extension id"],
  ["chrome-extension://abc123", "short id (scheme still valid)"],
  ["Chrome-Extension://abc123", "scheme is case-insensitive"],
  ["cmspark-tray://local", "trusted first-party tray client (must still pass the #35 HMAC handshake)"],
]

const REJECT: Array<[string | undefined | null, string]> = [
  ["https://evil.com", "web https origin"],
  ["http://localhost:8080", "web http origin"],
  ["http://127.0.0.1:23401", "loopback http origin"],
  ["file:///etc/passwd", "file origin"],
  ["chrome-extension://abc/path", "trailing path component"],
  ["https://chrome-extension://x", "prefix spoof attempt"],
  ["chrome-extension://", "empty id"],
  ["cmspark-tray://local/extra", "tray origin with trailing path (not the exact sentinel)"],
  ["cmspark-tray://evil", "tray scheme but wrong host (not the exact sentinel)"],
  ["cmspark-tray://", "tray scheme, empty host"],
  ["", "empty string"],
  [undefined, "no Origin header (local process without -H)"],
  [null, "null"],
]

test("isAllowedWsOrigin accepts only chrome-extension:// origins (audit C1 / P0-2)", () => {
  for (const [origin, label] of ALLOW) {
    assert.equal(isAllowedWsOrigin(origin), true, `should ALLOW ${label}: ${origin}`)
  }
  for (const [origin, label] of REJECT) {
    assert.equal(isAllowedWsOrigin(origin), false, `should REJECT ${label}: ${origin}`)
  }
})
