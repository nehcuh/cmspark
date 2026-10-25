import type { SecurityConfirmationDecision, SecurityConfirmationDetails } from "../../security-confirmation"
import type { BiometricGateOutcome, BiometricGateRequest } from "../../apps/biometric-gate"

export interface LcuHumanChannel {
  current: () => boolean
  request: (details: SecurityConfirmationDetails, signal?: AbortSignal) => Promise<SecurityConfirmationDecision>
}

/** A browser approval alone cannot authorize a tool which may control that browser. */
export async function authorizeLcuOperation(
  channel: LcuHumanChannel,
  action: string,
  preview: string,
  signal?: AbortSignal,
  deps: { platform?: string; biometric?: (request: BiometricGateRequest) => Promise<BiometricGateOutcome> } = {},
): Promise<boolean> {
  const current = () => !signal?.aborted && channel.current()
  if ((deps.platform ?? process.platform) !== "darwin" || !current() || typeof preview !== "string" || Buffer.byteLength(preview) > 96 * 1024) return false
  try {
    const decision = await channel.request({
      toolName: action,
      dangerousApis: ["computer-use.lcu"],
      criticalApis: ["computer-use.lcu"],
      code: preview,
      fullPreview: preview,
      riskLevel: "high",
      autoConfirmEligible: false,
    }, signal)
    if (!decision.approved || !current()) return false
    const biometric = deps.biometric ?? (async (request: BiometricGateRequest): Promise<BiometricGateOutcome> => {
      try {
        const { biometricVerify } = await import("../../host-use/darwin")
        const nonce = await biometricVerify(request.action, request.reason)
        return { approved: true, method: "touchid", nonce }
      } catch { return { approved: false, reason: "error" } }
    })
    const outcome = await biometric({
      action,
      reason: "确认 CMspark LCU 桌面操作授权",
      requestConfirmation: details => channel.request(details, signal),
    })
    // The existing common gate can downgrade to a browser nonce. LCU cannot:
    // desktop input could type that nonce into its own hosting confirmation UI.
    return current() && outcome.approved && outcome.method === "touchid"
  } catch { return false }
}
