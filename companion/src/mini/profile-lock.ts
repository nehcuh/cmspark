import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer, type Server } from "node:net"
import { win32 } from "node:path"

/** One Windows tray owns both the orb and global shortcuts for this profile. */
export class MiniProfileLock {
  private readonly pipe: string
  private owner?: Server
  private pending: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    const path = win32.toNamespacedPath(win32.resolve(dir)).toUpperCase()
    const hash = createHash("sha256").update(path).digest("hex")
    this.pipe = "\\\\.\\pipe\\cmspark-mini-profile-" + hash
  }

  acquire(): Promise<boolean> {
    return this.inOrder(async () => {
      if (this.owner) return true
      const server = createServer(socket => socket.destroy())
      try {
        server.listen({ path: this.pipe, exclusive: true })
        await once(server, "listening")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return false
        throw error
      }
      server.unref()
      this.owner = server
      return true
    })
  }

  release(): Promise<void> {
    return this.inOrder(async () => {
      const server = this.owner
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
      this.owner = undefined
    })
  }

  private inOrder<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => {}, () => {})
    return result
  }
}
