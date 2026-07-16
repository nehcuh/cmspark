export interface HostReadParams {
  application?: string
  maxChars?: number
}

export interface HostReadResult {
  sender: string
  subject: string
  date_received: string
  body_preview: string
}

export class NotImplementedOnPlatform extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`host_read: not implemented on ${platform} — Phase 0 macOS-only`)
    this.name = "NotImplementedOnPlatform"
  }
}
