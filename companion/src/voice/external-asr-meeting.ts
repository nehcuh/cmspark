export function meetingExternalRefusal(sttEngine: string | undefined | null) {
  if (sttEngine === "external") return { code: "meeting_external_unsupported" as const }
  return null
}
