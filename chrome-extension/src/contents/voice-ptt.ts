// #258 new content-script injection surface (Plasmo contents/).
// host_permissions already includes <all_urls> — no new permission.
// Chord on an editable page field → Side Panel PTT (tier-2 insert).

import type { PlasmoCSConfig } from "plasmo"
import { eventMatchesChord, isPttReleaseEvent, parseHotkeyChord } from "../sidepanel/voice/hotkey-chord"
import { isEditableTarget } from "../sidepanel/voice/insert-target"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
}

let enabled = false
let chordRaw = "Control+Shift+Space"

function refreshPrefs(): void {
  try {
    chrome.storage.local.get(["dictationHotkeyEnabled", "dictationHotkeyChord"], (res) => {
      enabled = res.dictationHotkeyEnabled === true
      if (typeof res.dictationHotkeyChord === "string" && res.dictationHotkeyChord.trim()) {
        chordRaw = res.dictationHotkeyChord.trim()
      }
    })
  } catch {
    /* */
  }
}

refreshPrefs()
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (changes.dictationHotkeyEnabled) enabled = changes.dictationHotkeyEnabled.newValue === true
    if (typeof changes.dictationHotkeyChord?.newValue === "string") {
      chordRaw = changes.dictationHotkeyChord.newValue.trim() || chordRaw
    }
  })
} catch {
  /* */
}

function emit(kind: "down" | "up", ev: KeyboardEvent): void {
  const chord = parseHotkeyChord(chordRaw)
  if (!enabled || !chord) return
  if (ev.repeat) return
  if (kind === "down") {
    if (!eventMatchesChord(ev, chord)) return
    const editable = isEditableTarget(document.activeElement as { tagName?: string; isContentEditable?: boolean } | null)
    if (!editable) return
  } else if (!isPttReleaseEvent(ev, chord)) {
    // keyup: treat modifier release as up (same as sidepanel onKeyUp). Do not
    // require the editable still focused — the chord started on one.
    return
  }
  ev.preventDefault()
  ev.stopPropagation()
  try {
    chrome.runtime.sendMessage({ type: "voice.ptt.page_chord", kind, editable: true })
  } catch {
    /* */
  }
}

window.addEventListener("keydown", (e) => emit("down", e), true)
window.addEventListener("keyup", (e) => emit("up", e), true)
