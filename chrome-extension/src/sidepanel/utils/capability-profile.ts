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
        "enterprise 档只解锁「可开启」以下能力的资格，不会自动开启任何模块：" +
        "shell（宿主 shell_exec 命令执行）与 netsec（netsec_port_scan 端口扫描）" +
        "将允许在「本机能力」中开启；企业场景包（channel: enterprise）也允许应用。" +
        "开启模块与实际调用仍各自需要你在设置中开电源、在确认台中放行（L2）。三旗巡航开关不受此切换影响。",
      confirmLabel: "切换到 enterprise",
    }
  }

  const toPowerOff = [
    shellEnabled ? "shell" : null,
    netsecEnabled ? "netsec" : null,
  ].filter((x): x is string => !!x)
  const powerOffSentence = toPowerOff.length
    ? `当前已开启的 ${toPowerOff.join("、")} 电源将被强制断电（一并关闭，模块状态如实变为「未开启」）。`
    : "当前没有已开启的 shell / netsec 电源，无模块会被关闭。"
  return {
    title: "切回 community 能力档？",
    body:
      "切回后 shell（宿主命令执行）与 netsec（端口扫描）将被挡在 enterprise 门外。" +
      powerOffSentence +
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
