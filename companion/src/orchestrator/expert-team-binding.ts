import { createHash } from "crypto"

function sliceFingerprint(brief: string): string {
  return createHash("sha256").update(String(brief || "")).digest("hex").slice(0, 16)
}

/** Token binds pack-id set + slice fingerprints so a post-confirm member/slice swap fails. */
export function expertTeamBindingPayload(params: any): string {
  const members = Array.isArray(params?.members) ? params.members : []
  const ids = [
    ...new Set(
      members
        .map((m: any) => String(m?.pack_id || m?.id || "").trim())
        .filter(Boolean),
    ),
  ].sort()
  const slices = members
    .map((m: any) => {
      const id = String(m?.pack_id || m?.id || "").trim()
      if (!id) return null
      return `${id}:${sliceFingerprint(String(m?.brief || m?.task_slice || ""))}`
    })
    .filter((s: string | null): s is string => !!s)
    .sort()
  const goal = String(params?.goal || "").trim()
  return `spawn_expert_team|ids=${ids.join(",")}|goal=${goal}|slices=${slices.join(",")}`
}
