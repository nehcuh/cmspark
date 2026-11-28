import type { IncomingMessage } from "node:http"
import { StringDecoder } from "node:string_decoder"

/** Bound the wire bytes while preserving UTF-8 characters split across chunks. */
export function readBody(req: IncomingMessage, maxBytes: number, overflowMessage = "Request body too large"): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8")
    let bytes = 0
    let body = ""
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        reject(new Error(overflowMessage))
        req.destroy()
        return
      }
      body += decoder.write(chunk)
    })
    req.on("end", () => resolve(body + decoder.end()))
    req.on("error", reject)
  })
}
