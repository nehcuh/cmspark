// UIUX v2 soft feature flags (compile-time).
// Spec §4.7 M3 / PR5: bottomBarStrip=false hides permanent tab row; Host remains SoT.

/**
 * Panel chrome flags. Named `ui.*` to match redesign §4.7 (`ui.bottomBarStrip`).
 * Flip `bottomBarStrip` to true only for smoke / rollback of strip chrome.
 */
export const ui = {
  /**
   * When true, render the legacy BottomBar permanent tab strip (+「更多」).
   * Default **false** (PR5): panels open via Composer chips / `/` / 装配 / Host only.
   */
  bottomBarStrip: false,
} as const

export type UiFlags = typeof ui
