/**
 * CDP Input.dispatchKeyEvent helpers (web act-loop §5.5).
 * Official CDP modifiers: Alt=1 Ctrl=2 Meta=4 Shift=8.
 * Legacy catalog bitmask was Shift=4 Meta=8 — still decoded when only `modifiers` int is passed.
 */

export const CDP_MOD_ALT = 1
export const CDP_MOD_CTRL = 2
export const CDP_MOD_META = 4
export const CDP_MOD_SHIFT = 8

export type KeyBools = {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function cdpModifiersFromKeys(k: Partial<KeyBools>): number {
  return (
    (k.altKey ? CDP_MOD_ALT : 0) |
    (k.ctrlKey ? CDP_MOD_CTRL : 0) |
    (k.metaKey ? CDP_MOD_META : 0) |
    (k.shiftKey ? CDP_MOD_SHIFT : 0)
  )
}

/** Decode the historical catalog mask (Shift=4, Meta=8). */
export function keysFromLegacyModifierMask(mask: number): KeyBools {
  return {
    altKey: !!(mask & 1),
    ctrlKey: !!(mask & 2),
    shiftKey: !!(mask & 4),
    metaKey: !!(mask & 8),
  }
}

export function windowsVirtualKeyCode(key: string): number | undefined {
  if (!key) return undefined
  if (key.length === 1) {
    const c = key.toUpperCase()
    if (c >= "A" && c <= "Z") return c.charCodeAt(0)
    if (c >= "0" && c <= "9") return c.charCodeAt(0)
    if (key === " ") return 32
  }
  const map: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    Space: 32,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
  }
  return map[key]
}

export type SelectAllKeyPayload = {
  type: "keyDown" | "keyUp"
  key: string
  code: string
  metaKey?: boolean
  ctrlKey?: boolean
  modifiers: number
  windowsVirtualKeyCode: number
  nativeVirtualKeyCode: number
}

/** Meta+A then Ctrl+A — both halves carry VK so Windows select-all is real. */
export function selectAllKeyPayloads(): SelectAllKeyPayload[] {
  const vk = 65
  const chord = (
    type: "keyDown" | "keyUp",
    which: "meta" | "ctrl",
  ): SelectAllKeyPayload => ({
    type,
    key: "a",
    code: "KeyA",
    ...(which === "meta" ? { metaKey: true } : { ctrlKey: true }),
    modifiers: which === "meta" ? CDP_MOD_META : CDP_MOD_CTRL,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  return [
    chord("keyDown", "meta"),
    chord("keyUp", "meta"),
    chord("keyDown", "ctrl"),
    chord("keyUp", "ctrl"),
  ]
}
