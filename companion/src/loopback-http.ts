import * as http from "node:http"

export async function findAvailablePort(startPort: number, service: string): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = http.createServer()
        probe.on("error", reject)
        probe.listen(port, "127.0.0.1", () => {
          probe.close(() => resolve())
        })
      })
      return port
    } catch {
      continue
    }
  }
  throw new Error(`No available port for ${service}`)
}

export function parseQuery(qs: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!qs) return out
  for (const pair of qs.split("&")) {
    if (!pair) continue
    const eq = pair.indexOf("=")
    const k = eq < 0 ? decodeURIComponent(pair) : decodeURIComponent(pair.slice(0, eq))
    const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1))
    out.set(k, v)
  }
  return out
}

export function hostOk(req: http.IncomingMessage, port: number): boolean {
  const host = (req.headers.host || "").toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

export function forbidden(res: http.ServerResponse, reason: string) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
  res.end(`Forbidden: ${reason}`)
}
