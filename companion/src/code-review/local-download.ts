import * as https from "node:https"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { createHash } from "node:crypto"
import { assertOutboundFetchUrlAllowed, isPrivateOrLoopbackIp } from "../security"
import { LOCAL_LIMITS } from "./local-contract"

export function isPublicArtifactAddress(address: string): boolean {
  if (!isIP(address) || isPrivateOrLoopbackIp(address)) return false
  // Conservative public-unicast gate, including IPv4-mapped IPv6 and
  // documentation/benchmark/multicast/reserved space. Require native IPv6
  // global unicast; mapped and transition addresses are deliberately denied.
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address)
    && !/^2001:(?:0:|db8:)/i.test(address) && !/^2002:/i.test(address)
  const [a, b, c] = address.split(".").map(Number)
  return a > 0 && a < 224 && a !== 127 && !(a === 192 && (b === 0 || b === 168 || b === 2))
    && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
    && !(a === 203 && b === 0 && c === 113)
}

/** No cookies, credentials, proxy env, redirects, shell or arbitrary destination.
 * Resolve once, reject every non-public answer, pin that IP on the TLS socket.
 * TLS still validates the original hostname, so DNS rebinding cannot bypass it. */
export async function downloadArtifact(url: string, sha256: string, signal: AbortSignal): Promise<Buffer> {
  const u = new URL(url)
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.port && u.port !== "443"
    || assertOutboundFetchUrlAllowed(url)) throw new Error("ARTIFACT_URL_DENIED")
  const host = u.hostname.replace(/^\[|\]$/g, "")
  signal.throwIfAborted()
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const abort = () => reject(new Error("ARTIFACT_DOWNLOAD_CANCELLED"))
    signal.addEventListener("abort", abort, { once: true })
    lookup(host, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
    if (signal.aborted) abort()
  })
  signal.throwIfAborted()
  if (!addresses.length || addresses.some(item => !isPublicArtifactAddress(item.address))) throw new Error("ARTIFACT_DNS_DENIED")
  const pinned = addresses[0]
  return new Promise((resolve, reject) => {
    const request = https.get(u, {
      signal, agent: false,
      lookup: (_hostname, _opts, callback) => callback(null, pinned.address, pinned.family),
      headers: { Accept: "application/zip", "User-Agent": "CMspark-local-review/1" },
    }, response => {
      response.on("error", reject)
      if (response.statusCode !== 200) {
        response.destroy(); reject(new Error("ARTIFACT_HTTP_STATUS_OR_REDIRECT")); return
      }
      const advertised = Number(response.headers["content-length"] || 0)
      if (advertised > LOCAL_LIMITS.downloadBytes) {
        response.destroy(); reject(new Error("ARTIFACT_DOWNLOAD_LIMIT")); return
      }
      const chunks: Buffer[] = []; let bytes = 0
      response.on("data", chunk => {
        bytes += chunk.length
        if (bytes > LOCAL_LIMITS.downloadBytes) {
          response.destroy(new Error("ARTIFACT_DOWNLOAD_LIMIT")); return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on("end", () => {
        const body = Buffer.concat(chunks)
        if (createHash("sha256").update(body).digest("hex") !== sha256) reject(new Error("ARTIFACT_HASH_MISMATCH"))
        else resolve(body)
      })
    })
    request.on("error", reject)
    request.setTimeout(30_000, () => request.destroy(new Error("ARTIFACT_DOWNLOAD_TIMEOUT")))
  })
}
