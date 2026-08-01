// Experimental locate-layer admission — Qwen3-VL (replaces TinyClick ONNX path).
// Per-task evaluation before runComputerTask; fail-closed → locator null.

import type { ComputerConfig } from "../config"
import { logger } from "../logger"
import {
  modelLicenseAccepted,
  type ComputerModelSessionHolder,
} from "./model-handlers"
import { migrateLegacyModelVariant, type QwenVlVariant } from "./qwen-vl-catalog"
import { QwenVlLocator } from "./qwen-vl-locator"
import { QwenVlSession, type QwenVlSessionDeps } from "./qwen-vl-session"

export const ADMISSION_REASON = {
  SWITCH_OFF: "model-switch-off",
  LICENSE_DECLINED: "model-license-declined",
  LICENSE_NOT_ACCEPTED: "model-license-not-accepted",
  CIRCUIT_DISABLED: "model-circuit-disabled",
  BUILD_FAILED: "model-build-failed",
  SESSION_FOREIGN: "model-session-foreign",
  ADMISSION_ERROR: "model-admission-error",
} as const

export type AdmissionSession = Pick<
  QwenVlSession,
  "locate" | "prepare" | "getStatus" | "getFaults" | "resetCircuitBreaker" | "dispose"
>

export interface ModelAdmissionDeps {
  sessionFactory?: (deps: QwenVlSessionDeps) => AdmissionSession
  broadcast?: (msg: unknown) => void
  log?: (event: string, payload: Record<string, unknown>) => void
  stillEnabled?: () => boolean
}

export interface ModelAdmission {
  locator: Pick<QwenVlLocator, "locate"> | null
  reason?: string
}

/** @deprecated use ModelAdmission — kept for smoke scripts */
export type TinyClickAdmission = ModelAdmission
/** @deprecated use ModelAdmissionDeps */
export type TinyClickAdmissionDeps = ModelAdmissionDeps

const inflight = new WeakMap<object, Promise<ModelAdmission>>()

export async function resolveModelAdmission(args: {
  config: ComputerConfig | undefined
  holder: ComputerModelSessionHolder
  deps?: ModelAdmissionDeps
}): Promise<ModelAdmission> {
  const cfg = args.config ?? { coordinateEnabled: false }
  const deps = args.deps ?? {}
  const log = deps.log ?? ((e, p) => logger.info(e, p))

  if (cfg.modelEnabled !== true) {
    return { locator: null, reason: ADMISSION_REASON.SWITCH_OFF }
  }
  if (cfg.modelLicenseDeclined === true) {
    return { locator: null, reason: ADMISSION_REASON.LICENSE_DECLINED }
  }
  if (!modelLicenseAccepted(cfg)) {
    return { locator: null, reason: ADMISSION_REASON.LICENSE_NOT_ACCEPTED }
  }

  const holder = args.holder
  const existing = holder.session as AdmissionSession | null
  if (existing) {
    if (existing.getStatus() === "disabled") {
      return { locator: null, reason: ADMISSION_REASON.CIRCUIT_DISABLED }
    }
    return {
      locator: new QwenVlLocator({ session: existing }),
    }
  }

  let p = inflight.get(holder)
  if (!p) {
    p = buildSession(cfg, holder, deps, log)
    inflight.set(holder, p)
    p.finally(() => inflight.delete(holder))
  }
  return p
}

async function buildSession(
  cfg: ComputerConfig,
  holder: ComputerModelSessionHolder,
  deps: ModelAdmissionDeps,
  log: (e: string, p: Record<string, unknown>) => void,
): Promise<ModelAdmission> {
  const variant: QwenVlVariant = migrateLegacyModelVariant(cfg.modelVariant)
  try {
    const factory =
      deps.sessionFactory ??
      ((d: QwenVlSessionDeps) => new QwenVlSession(d) as AdmissionSession)
    const session = factory({
      variant,
      broadcast: deps.broadcast,
      log,
    })
    await session.prepare()
    if (deps.stillEnabled && !deps.stillEnabled()) {
      try {
        await session.dispose()
      } catch {
        /* best-effort */
      }
      log("computer.model.admission.discarded", { reason: "disabled-during-build" })
      return { locator: null, reason: ADMISSION_REASON.SWITCH_OFF }
    }
    holder.session = session as any
    log("computer.model.admission.ready", { variant })
    return { locator: new QwenVlLocator({ session }) }
  } catch (err) {
    log("computer.model.admission.failed", {
      variant,
      error: err instanceof Error ? err.message : String(err),
    })
    return { locator: null, reason: ADMISSION_REASON.BUILD_FAILED }
  }
}

/** Never throws — folds evaluation errors. */
export async function resolveModelAdmissionSafe(args: {
  config: ComputerConfig | undefined
  holder: ComputerModelSessionHolder
  deps?: ModelAdmissionDeps
}): Promise<ModelAdmission> {
  try {
    return await resolveModelAdmission(args)
  } catch (err) {
    logger.warn("computer.model.admission.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return { locator: null, reason: ADMISSION_REASON.ADMISSION_ERROR }
  }
}

/** @deprecated alias */
export const resolveTinyClickAdmission = resolveModelAdmission
/** @deprecated alias */
export const resolveTinyClickAdmissionSafe = resolveModelAdmissionSafe
