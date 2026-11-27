import { createHash } from "node:crypto"
import { once } from "node:events"
import { connect, createServer, type Server } from "node:net"
import { dirname, resolve, win32 } from "node:path"
import { lstatSync, mkdirSync, unlinkSync } from "node:fs"

/** A single tray owns Mini for each profile. */
export class MiniProfileLock {
  private readonly pipe: string
  private owner?: Server
  private pending: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    const path = process.platform === "win32" ? win32.toNamespacedPath(win32.resolve(dir)).toUpperCase() : resolve(dir)
    const hash = createHash("sha256").update(path).digest("hex")
    if (process.platform !== "win32") {
      // Keep well within Darwin's 104-byte sun_path even for long profile paths.
      this.pipe = `/tmp/cmspark-mini-${process.getuid!()}/${hash.slice(0,32)}.sock`
      return
    }
    this.pipe = "\\\\.\\pipe\\cmspark-mini-profile-" + hash
  }

  acquire(): Promise<boolean> {
    return this.inOrder(async () => {
      if (this.owner) return true
      if (process.platform !== "win32") {
        const folder = dirname(this.pipe)
        mkdirSync(folder, { recursive: true, mode: 0o700 })
        const protection = lstatSync(folder)
        if (!protection.isDirectory() || protection.uid !== process.getuid!() || (protection.mode & 0o077)) {
          throw new Error("Mini 的用户套接字目录不可用")
        }
        if (!await this.availableSocket()) return false
      }
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

  private async availableSocket(): Promise<boolean> {
    const before = lstatSync(this.pipe, { throwIfNoEntry: false })
    if (!before) return true
    if (!before.isSocket()) return false
    const active = connect(this.pipe)
    try {
      await once(active, "connect")
      return false
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT") return true
      if (code !== "ECONNREFUSED") throw err
      // An abruptly killed POSIX tray leaves its socket inode behind.
      const now = lstatSync(this.pipe, { throwIfNoEntry: false })
      if (!now) return true
      if (before.dev !== now.dev || before.ino !== now.ino) return false
      unlinkSync(this.pipe)
      return true
    } finally { active.destroy() }
  }

  private inOrder<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => {}, () => {})
    return result
  }
}
