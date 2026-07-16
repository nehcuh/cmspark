import type { HostReadParams, HostReadResult } from "./types"

export { NotImplementedOnPlatform } from "./types"
export type { HostReadParams, HostReadResult } from "./types"

export async function hostRead(params: HostReadParams): Promise<HostReadResult> {
  if (process.platform === "darwin") {
    const { hostRead: darwinHostRead } = await import("./darwin")
    return darwinHostRead(params)
  }
  if (process.platform === "linux") {
    const { hostRead: linuxHostRead } = await import("./linux")
    return linuxHostRead(params)
  }
  if (process.platform === "win32") {
    const { hostRead: winHostRead } = await import("./win")
    return winHostRead(params)
  }
  throw new Error(`host_read: not implemented on ${process.platform}`)
}
