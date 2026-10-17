// #686 private request capability: never serialized into tool params or stored globally.
import os from "os"
import { spawn } from "child_process"
import { CONFIG_CHANGE_EVENT, configEvents, getConfig } from "../config"
import { securityPolicy } from "../security-policy"
import { logger } from "../logger"
import type { SecurityConfirmationDecision, SecurityConfirmationDetails } from "../security-confirmation"
import { requireAppsBiometric } from "./biometric-gate"
import { GUI_TEMPLATE_FLAGS, guiTemplateCall, guiTemplateSubject, selectGuiTemplate } from "./gui-templates"
import { prepareGuiTemplateFiles, type GuiTemplateFileSnapshot } from "./gui-template-files"

export interface GuiTemplateReceipt {
  /** Server-owned execution options only; not a transport/data field. */
  execute(params: Record<string, any>): Promise<{ success: boolean; error?: string; data?: any }>
  close(): void
}
export interface GuiTemplateAdmission {
  params: Record<string, any>
  signal?: AbortSignal
  ownerCurrent: () => boolean
  requestConfirmation: (details: SecurityConfirmationDetails) => Promise<SecurityConfirmationDecision>
}
/** Explicit test seams. These never come from tool args or an App configuration. */
export interface GuiTemplateRuntimeDeps {
  platform?: () => string
  config?: typeof getConfig
  changes?: Pick<typeof configEvents, "on" | "off">
  files?: typeof prepareGuiTemplateFiles
  policy?: Pick<typeof securityPolicy, "issueToken" | "validateToken">
  biometric?: typeof requireAppsBiometric
  spawn?: typeof spawn
}
function failure(): { success: false; error: string } {
  // Do not leak a private file/profile path or raw filesystem error into tool history.
  return { success: false, error: "App file template unavailable or changed; review the App configuration and approve a new operation." }
}
export async function admitGuiTemplate(request: GuiTemplateAdmission, deps: GuiTemplateRuntimeDeps = {}): Promise<{
  finalParams: Record<string, any>; receipt: GuiTemplateReceipt
}> {
  if ((deps.platform?.() ?? os.platform()) !== "win32") throw new Error("GUI file templates require Windows")
  const input = guiTemplateCall(request.params)
  const startedAt = Date.now()
  const config = deps.config ?? getConfig, changes = deps.changes ?? configEvents
  const original = config().apps
  const entry = original?.entries?.[input.app]
  if (!original?.enabled || !entry?.enabled) throw new Error("App file template unavailable")
  const template = selectGuiTemplate(entry, input.template)
  const captured = guiTemplateSubject(entry, original.enabled)
  let stale = false, closed = false, used = false
  const onChange = (next: ReturnType<typeof getConfig>) => {
    if (guiTemplateSubject(next.apps?.entries?.[input.app], next.apps?.enabled ?? true) !== captured) stale = true
  }
  const close = () => { if (!closed) { closed = true; changes.off(CONFIG_CHANGE_EVENT, onChange) } }
  // Install before the first await. Event-visible ABA never revives this request.
  changes.on(CONFIG_CHANGE_EVENT, onChange)
  const checkpoint = () => {
    onChange(config())
    request.signal?.throwIfAborted()
    if (stale || closed || !request.ownerCurrent()) throw new Error("App file template approval stale")
  }
  try {
    checkpoint()
    // Freeze subject data before passing it across an asynchronous preparation seam.
    const files: GuiTemplateFileSnapshot = await (deps.files ?? prepareGuiTemplateFiles)(structuredClone(entry), input.file, checkpoint)
    checkpoint(); files.recheck()
    const argv = Object.freeze([...GUI_TEMPLATE_FLAGS, files.canonicalFile])
    const binding = JSON.stringify(["gui-template-686", captured, template, files.canonicalExe, argv, files.bindingIdentity])
    if (!securityPolicy.checkLength("host_app", binding).ok) throw new Error("App file template operation exceeds existing token bound")
    const preview = [`Open local file in ${JSON.stringify(entry.display_name)} (${input.app})`, `Template: ${JSON.stringify(template.name)} (${template.id})`,
      `Risk: ${template.risk}`, `Executable: ${JSON.stringify(files.canonicalExe)}`, ...argv.map((arg, i) => `argv[${i}]: ${JSON.stringify(arg)}`)].join("\n")
    const decision = await request.requestConfirmation({ toolName: "host_app", dangerousApis: [], code: preview,
      fullPreview: preview, relevantApps: [], relevantDomains: [], riskLevel: "high", autoConfirmEligible: false })
    checkpoint(); files.recheck()
    if (!decision.approved || decision.reason !== "approved") throw new Error("App file template denied")
    const policy = deps.policy ?? securityPolicy
    // Original caller tokens never skip this fresh interactive decision.
    const token = policy.issueToken("host_app", binding).token
    const finalParams = { ...request.params, security_token: token }
    const approvedCall = JSON.stringify(input)
    const receipt: GuiTemplateReceipt = Object.freeze({
      close,
      async execute(params: Record<string, any>) {
        if (used) return failure()
        // Lock before any second-factor await: a parallel/replayed invocation cannot race.
        used = true
        try {
          checkpoint(); files.recheck()
          if (params.security_token !== token || JSON.stringify(guiTemplateCall(params)) !== approvedCall) throw new Error("Wrong approved operation")
          if (template.risk === "dangerous") {
            const outcome = await (deps.biometric ?? requireAppsBiometric)({ action: "host_app", reason: preview,
              requestConfirmation: request.requestConfirmation })
            checkpoint(); files.recheck()
            if (!outcome.approved) throw new Error("App file template second factor denied")
          }
          // Last synchronous fence. No import/preprobe/await between these checks and spawn.
          checkpoint(); files.recheck()
          if (!policy.validateToken(token, "host_app", binding)) throw new Error("Invalid App file template token")
          const child = (deps.spawn ?? spawn)(files.canonicalExe, [...argv], {
            shell: false, detached: true, stdio: "ignore", windowsHide: false,
          })
          child.on("error", () => { /* late errors cannot be represented as file-open success */ })
          child.unref()
          logger.info("apps.template_launch", { token: input.app, action: "run_template", template: template.id,
            policy: entry.policy, risk: template.risk, tier_used: "l2", argv_count: argv.length,
            file_slot_count: 1, evidence: "requested_no_pid", duration_ms: Date.now() - startedAt })
          return { success: true, data: { token: input.app, action: "run_template", template: template.id,
            launched: true, evidence: "requested_no_pid", detail: "Launch requested; file display was not independently observed." } }
        } catch { return failure() } finally { close() }
      },
    })
    return { finalParams, receipt }
  } catch (error) { close(); throw error }
}
