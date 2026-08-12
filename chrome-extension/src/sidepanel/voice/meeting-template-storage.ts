export const MEETING_MINUTES_TEMPLATE_STORAGE_KEY = "meeting_minutes_template_v1"
export const MEETING_TEMPLATE_MAX_CHARS = 16_384

export function clampMeetingTemplate(s: string): string {
  return (s || "").slice(0, MEETING_TEMPLATE_MAX_CHARS)
}

export function loadMeetingTemplate(): Promise<string> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(MEETING_MINUTES_TEMPLATE_STORAGE_KEY, (r) => {
        const v = r[MEETING_MINUTES_TEMPLATE_STORAGE_KEY]
        resolve(typeof v === "string" ? clampMeetingTemplate(v) : "")
      })
    } catch {
      resolve("")
    }
  })
}

export function saveMeetingTemplate(s: string): void {
  try {
    chrome.storage.local.set({
      [MEETING_MINUTES_TEMPLATE_STORAGE_KEY]: clampMeetingTemplate(s),
    })
  } catch {
    /* */
  }
}
