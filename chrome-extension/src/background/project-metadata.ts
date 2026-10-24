import { workspaceSenderAllowed } from "./workspace-sender"
/** This UI-only family cannot be relayed by a website/content-script sender. */
export function projectMetadataSenderAllowed(sender: { id?: string; url?: string; frameId?: number } | undefined, extensionId: string): boolean {
  return workspaceSenderAllowed(sender, extensionId)
}
