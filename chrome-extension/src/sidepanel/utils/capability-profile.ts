// #284: settings 能力档 (community ⇄ enterprise) switch — pure helpers so the
// consent copy and the "no send without confirmation" gate are testable.

export type CapabilityProfile = "community" | "enterprise"

export type ProfileSwitchConfirmInput = {
  from: CapabilityProfile
  to: CapabilityProfile
  shellEnabled: boolean
  netsecEnabled: boolean
}

export type ProfileSwitchConfirm = {
  title: string
  body: string
  confirmLabel: string
}

/**
 * Two-step confirm copy for a profile switch. null when from === to —
 * a same-profile click is never a switch and must not confirm or send.
 */
export function buildProfileSwitchConfirm(input: ProfileSwitchConfirmInput): ProfileSwitchConfirm | null {
  const { from, to, shellEnabled, netsecEnabled } = input
  if (from === to) return null

  if (to === "enterprise") {
    return {
      title: "切换到 enterprise 能力档？",
      body:
        "切换到 enterprise 后，本档会提供 shell。netsec 不会因此打开。" +
        "每条 shell_exec 命令仍按现有策略和 L2 确认。三旗、确认短语和自动批准不变。",
      confirmLabel: "切换到 enterprise",
    }
  }

  const netsecSentence = netsecEnabled
    ? "当前已开启的 netsec 电源将被强制关闭。"
    : "当前没有已开启的 netsec 电源。"
  void shellEnabled
  return {
    title: "切回 community 能力档？",
    body:
      "切回 community 后 shell 不再提供。" +
      netsecSentence +
      "企业场景包也会无法应用。此操作会写入能力审计日志。",
    confirmLabel: "切回 community",
  }
}

/**
 * Consent gate: build the modules.set_profile wire frame ONLY when the user
 * confirmed AND the target differs. Unconfirmed → null → nothing sent →
 * no live config write.
 */
export function resolveProfileSwitchSend(input: {
  confirmed: boolean
  from: CapabilityProfile
  to: CapabilityProfile
}): { type: "modules.set_profile"; profile: CapabilityProfile } | null {
  if (!input.confirmed) return null
  if (input.from === input.to) return null
  return { type: "modules.set_profile", profile: input.to }
}
