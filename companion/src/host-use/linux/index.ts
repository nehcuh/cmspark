import { NotImplementedOnPlatform } from "../types"
import type { HostReadParams, HostReadResult } from "../types"

export async function hostRead(_params: HostReadParams): Promise<HostReadResult> {
  throw new NotImplementedOnPlatform(process.platform)
}
