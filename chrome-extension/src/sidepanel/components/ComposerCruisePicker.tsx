// Composer cruise-tier picker (#325). Display is live deriveAutopilotTier.
// Writes reuse config.set + confirmation_phrase; 值守 is not a composer slot.

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react"
import { useAgentStore } from "../store/agentStore"
import { Modal } from "./ui/Modal"
import { AutopilotConsequenceMatrix } from "./AutopilotConsequenceMatrix"
import { popupMenuStyles } from "../ui/popupMenuStyles"
import { tokens } from "../ui/tokens"
import {
  AUTOPILOT_ARM_PHRASE,
  COMPOSER_CRUISE_SCOPE_NOTE,
  COMPOSER_CRUISE_SLOTS,
  composerCruiseChipLabel,
  composerPickNeedsArm,
  composerSlotFlags,
  composerSlotWrites,
  tierShortLabel,
  type ComposerCruiseSlot,
  type SecurityArmFlags,
} from "./autopilot-tier"

function liveFlags(config: {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}): SecurityArmFlags {
  return {
    auto_approve_dangerous: config.auto_approve_dangerous === true,
    auto_approve_enterprise_tools: config.auto_approve_enterprise_tools === true,
    allow_all_schemes: config.allow_all_schemes === true,
  }
}

function sendSecurityFlagConfig(
  partial: Record<string, boolean>,
  confirmation_phrase?: string,
) {
  chrome.runtime.sendMessage({
    type: "config.set",
    config: partial,
    ...(confirmation_phrase != null ? { confirmation_phrase } : {}),
  })
}

export function ComposerCruisePicker() {
  const { state, dispatch } = useAgentStore()
  const flags = liveFlags(state.config)
  const chipLabel = composerCruiseChipLabel(flags)

  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingSlot, setPendingSlot] = useState<ComposerCruiseSlot | null>(null)
  const [phrase, setPhrase] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const phraseRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setMenuOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  const applySlot = (slot: ComposerCruiseSlot, confirmationPhrase?: string) => {
    const target = composerSlotFlags(slot)
    const writes = composerSlotWrites(flags, slot)
    for (const w of writes) {
      if (w.value === true) {
        if (!confirmationPhrase) return
        sendSecurityFlagConfig({ [w.flag]: true }, confirmationPhrase)
      } else {
        sendSecurityFlagConfig({ [w.flag]: false })
      }
    }
    dispatch({ type: "SET_CONFIG", config: { ...target } })
  }

  const onPick = (slot: ComposerCruiseSlot) => {
    if (composerPickNeedsArm(flags, slot)) {
      setPendingSlot(slot)
      setPhrase("")
      setMsg(null)
      setMenuOpen(false)
      return
    }
    applySlot(slot)
    setMenuOpen(false)
  }

  const onConfirmArm = () => {
    if (!pendingSlot) return
    if (phrase.trim() !== AUTOPILOT_ARM_PHRASE) {
      setMsg(`请输入「${AUTOPILOT_ARM_PHRASE}」`)
      return
    }
    applySlot(pendingSlot, phrase.trim())
    setPendingSlot(null)
    setPhrase("")
    setMsg(null)
  }

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        type="button"
        data-testid="composer-cruise-chip"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`巡航档位 ${chipLabel}，${COMPOSER_CRUISE_SCOPE_NOTE}`}
        title={`${chipLabel} · ${COMPOSER_CRUISE_SCOPE_NOTE}`}
        style={{
          ...styles.chip,
          ...(chipLabel !== "每次确认" ? styles.chipArmed : null),
        }}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {chipLabel}
      </button>

      {menuOpen && (
        <div
          role="menu"
          data-testid="composer-cruise-menu"
          style={{ ...popupMenuStyles.menu, ...styles.menu }}
        >
          <div style={styles.scope}>{COMPOSER_CRUISE_SCOPE_NOTE}</div>
          {COMPOSER_CRUISE_SLOTS.map((slot) => {
            const label = tierShortLabel(slot)
            const selected = label === chipLabel
            return (
              <button
                key={slot}
                type="button"
                role="menuitem"
                data-testid={`composer-cruise-slot-${slot}`}
                style={{
                  ...popupMenuStyles.menuItem,
                  ...(selected ? styles.menuItemSelected : null),
                }}
                onClick={() => onPick(slot)}
              >
                <span style={{ flex: 1 }}>{label}</span>
                {selected ? <span aria-hidden>✓</span> : null}
              </button>
            )
          })}
        </div>
      )}

      <Modal
        open={pendingSlot != null}
        onClose={() => {
          setPendingSlot(null)
          setPhrase("")
          setMsg(null)
        }}
        role="alertdialog"
        ariaLabel={
          pendingSlot
            ? `确认武装「${tierShortLabel(pendingSlot)}」`
            : "确认武装"
        }
        backdropDismiss={false}
        initialFocusRef={phraseRef as RefObject<HTMLElement>}
        overlayStyle={styles.overlay}
        panelStyle={styles.sheet}
      >
        {pendingSlot != null && (
          <div data-testid="composer-cruise-arm-sheet">
            <div style={styles.sheetTitle}>
              确认武装「{tierShortLabel(pendingSlot)}」— 请输入「
              <b>{AUTOPILOT_ARM_PHRASE}</b>」
            </div>
            <div style={styles.scope}>{COMPOSER_CRUISE_SCOPE_NOTE}</div>
            <div style={{ margin: "8px 0" }}>
              <AutopilotConsequenceMatrix />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                ref={phraseRef}
                style={styles.phrase}
                type="text"
                value={phrase}
                onChange={(e) => {
                  setPhrase(e.target.value)
                  setMsg(null)
                }}
                placeholder={AUTOPILOT_ARM_PHRASE}
                autoComplete="off"
                spellCheck={false}
                data-testid="composer-cruise-phrase"
              />
              <button
                type="button"
                style={styles.armBtn}
                onClick={onConfirmArm}
                data-testid="composer-cruise-arm-confirm"
              >
                确认武装
              </button>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => {
                  setPendingSlot(null)
                  setPhrase("")
                  setMsg(null)
                }}
              >
                取消
              </button>
            </div>
            {msg && <div style={styles.err}>{msg}</div>}
          </div>
        )}
      </Modal>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    flexShrink: 0,
    alignSelf: "flex-end",
  },
  chip: {
    height: 32,
    maxWidth: 92,
    borderRadius: tokens.radiusPill,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 550,
    fontFamily: tokens.font,
    padding: "0 8px",
    lineHeight: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chipArmed: {
    color: tokens.accentText,
    background: tokens.accentSoft,
    borderColor: tokens.accentBorderSoft,
  },
  menu: {
    position: "absolute",
    right: 0,
    bottom: 36,
    zIndex: 40,
    minWidth: 168,
    maxWidth: 240,
  },
  scope: {
    fontSize: 10,
    color: tokens.textMuted,
    padding: "4px 11px 6px",
    lineHeight: 1.4,
  },
  menuItemSelected: {
    background: tokens.accentSoft,
    color: tokens.accentText,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 260,
    background: tokens.scrim,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sheet: {
    background: tokens.bgElevated,
    borderTopLeftRadius: tokens.radiusSheet,
    borderTopRightRadius: tokens.radiusSheet,
    boxShadow: tokens.shadowLg,
    maxHeight: "82vh",
    overflowY: "auto",
    padding: "14px 14px 18px",
    fontFamily: tokens.font,
    width: "100%",
  },
  sheetTitle: {
    fontSize: 12,
    color: tokens.danger,
    fontWeight: 500,
    marginBottom: 4,
    lineHeight: 1.45,
  },
  phrase: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: tokens.font,
    padding: "6px 8px",
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.borderStrong}`,
    color: tokens.text,
    background: tokens.bgElevated,
  },
  armBtn: {
    border: `1px solid ${tokens.danger}`,
    background: tokens.danger,
    color: tokens.userBubbleText,
    borderRadius: tokens.radiusMd,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  cancelBtn: {
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    borderRadius: tokens.radiusMd,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  err: {
    fontSize: 11,
    color: tokens.danger,
    marginTop: 4,
  },
}
