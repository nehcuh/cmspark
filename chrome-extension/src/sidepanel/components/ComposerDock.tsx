// ComposerChips container — cut out of App.tsx InputArea in #321 PR-7.
// Pure move of the `styles.inputArea` wrapper. Chips still render via ComposerChips;
// the capsule / send cluster stays the caller's child (send-matrix visuals untouched).

import type { CSSProperties, ReactNode } from "react"
import { tokens } from "../ui/tokens"

export type ComposerDockProps = {
  chips: ReactNode
  children: ReactNode
}

export function ComposerDock({ chips, children }: ComposerDockProps) {
  return (
    <div style={styles.inputArea}>
      {chips}
      {children}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  inputArea: {
    display: "flex",
    flexDirection: "column",
    padding: "8px 14px 12px",
    background: tokens.bgElevated,
    flexShrink: 0,
    position: "relative" as const,
  },
}
