// #258 final-only STT postprocess. Four independent switches, default all off.

export type VoicePostprocessPrefs = {
  fillers: boolean
  map: Array<[string, string]>
  lowercase: boolean
  stripPunct: boolean
}

export function defaultVoicePostprocessPrefs(): VoicePostprocessPrefs {
  return { fillers: false, map: [], lowercase: false, stripPunct: false }
}

/** Small honest filler lists — not a full NLP stack. */
export const FILLERS_ZH = ["嗯", "啊", "呃", "那个", "就是"]
export const FILLERS_EN = ["um", "uh", "er", "ah"]

export function applyVoicePostprocess(
  text: string,
  prefs: VoicePostprocessPrefs,
): { text: string; postprocessed: boolean } {
  const raw = typeof text === "string" ? text : ""
  if (!raw.trim()) return { text: raw, postprocessed: false }

  const any =
    prefs.fillers === true ||
    prefs.lowercase === true ||
    prefs.stripPunct === true ||
    (Array.isArray(prefs.map) && prefs.map.length > 0)
  if (!any) return { text: raw, postprocessed: false }

  let out = raw
  if (prefs.fillers) {
    const zh = FILLERS_ZH.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    const en = FILLERS_EN.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    if (zh) out = out.replace(new RegExp(zh, "g"), " ")
    if (en) out = out.replace(new RegExp(`\\b(?:${en})\\b`, "gi"), " ")
    out = out.replace(/\s+/g, " ").trim()
  }
  if (Array.isArray(prefs.map)) {
    for (const pair of prefs.map) {
      if (!Array.isArray(pair) || pair.length < 2) continue
      const from = String(pair[0] || "")
      const to = String(pair[1] || "")
      if (!from) continue
      out = out.split(from).join(to)
    }
  }
  if (prefs.lowercase) out = out.toLowerCase()
  if (prefs.stripPunct) out = out.replace(/[\s.!?。！？,，;；:：]+$/u, "").trim()

  return { text: out, postprocessed: out !== raw }
}
