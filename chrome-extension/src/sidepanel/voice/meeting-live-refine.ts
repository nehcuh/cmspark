/**
 * Meeting live STT — AI ASR refine (opt-in) + soft-error banner helpers.
 * Uses voice.refine.* (ADR-024 correct_only); priorContext for homophone disambiguation.
 */

import { isSoftSttSegmentError } from "./local-stt-adapter"

/** Cap prior transcript chars sent with each refine request. */
export const MEETING_REFINE_PRIOR_MAX = 2_000

/** Soft segment loss copy (adversary F-merge-5 / D-F1). */
export const MEETING_SOFT_SEGMENT_LOSS_HINT =
  "本段转写已丢失（不可恢复）；后续段继续；结束会议默认仍删音频"

/**
 * Clip prior transcript for refine priorContext (last N chars).
 */
export function clipPriorContextForRefine(
  prior: string,
  max = MEETING_REFINE_PRIOR_MAX,
): string {
  const t = (prior || "").trim()
  if (!t) return ""
  return t.length > max ? t.slice(-max) : t
}

/**
 * Whether MeetingPanel should show non-fatal soft banner (adapter keeps recording).
 * Must NOT include resource_conflict / session_busy / oom (those hard-stop after reclaim).
 */
export function isMeetingSoftSegmentBanner(code: string): boolean {
  return isSoftSttSegmentError(code)
}

/**
 * Honest soft-error banner: mapped message + irreversible segment loss.
 */
export function formatMeetingSoftSegmentError(mappedMessage: string): string {
  const base = (mappedMessage || "本段识别失败").trim()
  return `${base} — ${MEETING_SOFT_SEGMENT_LOSS_HINT}`
}

/**
 * Build voice.refine.request payload for a live meeting segment.
 */
export function buildMeetingRefineRequest(opts: {
  sessionId: string
  refineGen: number
  text: string
  priorTranscript: string
}): Record<string, unknown> {
  const prior = clipPriorContextForRefine(opts.priorTranscript)
  const body: Record<string, unknown> = {
    type: "voice.refine.request",
    v: 1,
    sessionId: opts.sessionId,
    refineGen: opts.refineGen,
    text: opts.text,
  }
  if (prior) body.priorContext = prior
  return body
}

/** Default max wait for in-flight meeting refine before end/minutes (ms). */
export const MEETING_REFINE_DRAIN_MAX_MS = 22_000

/**
 * Serial refine queue: preserve segment order when LLM is slow.
 * `whenIdle` lets finalizeCapture wait for pending segment refines (dual-review nit #2).
 */
export function createSerialRefineQueue(): {
  enqueue: <T>(fn: () => Promise<T>) => Promise<T>
  pendingCount: () => number
  whenIdle: () => Promise<void>
  /**
   * Wait until idle or timeout. Returns true if drained, false if timed out.
   */
  drain: (timeoutMs?: number) => Promise<boolean>
} {
  let chain: Promise<unknown> = Promise.resolve()
  let pending = 0
  let idleWaiters: Array<() => void> = []

  const notifyIdle = () => {
    if (pending !== 0) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const w of waiters) w()
  }

  return {
    enqueue<T>(fn: () => Promise<T>): Promise<T> {
      pending += 1
      const run = chain.then(() => fn())
      chain = run.then(
        () => {
          pending -= 1
          notifyIdle()
        },
        () => {
          pending -= 1
          notifyIdle()
        },
      )
      return run
    },
    pendingCount: () => pending,
    whenIdle: () => {
      if (pending === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
      })
    },
    async drain(timeoutMs = MEETING_REFINE_DRAIN_MAX_MS): Promise<boolean> {
      if (pending === 0) return true
      let timedOut = false
      await Promise.race([
        this.whenIdle(),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            timedOut = true
            resolve()
          }, timeoutMs)
        }),
      ])
      return !timedOut && pending === 0
    },
  }
}

/**
 * One-shot refine via chrome.runtime messages (Side Panel).
 * Falls back to raw text on timeout / error / abort.
 */
export function requestMeetingSegmentRefine(opts: {
  sessionId: string
  refineGen: number
  text: string
  priorTranscript: string
  timeoutMs?: number
  send?: (msg: Record<string, unknown>) => void
  onMessage?: (handler: (msg: any) => void) => () => void
}): Promise<{ text: string; refined: boolean }> {
  const send =
    opts.send ??
    ((msg: Record<string, unknown>) => {
      try {
        chrome.runtime.sendMessage(msg)
      } catch {
        /* */
      }
    })
  const onMessage =
    opts.onMessage ??
    ((handler: (msg: any) => void) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
        return () => {}
      }
      const listener = (msg: any) => {
        handler(msg)
        return false
      }
      chrome.runtime.onMessage.addListener(listener)
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(listener)
        } catch {
          /* */
        }
      }
    })

  const timeoutMs = opts.timeoutMs ?? 20_000
  const raw = opts.text.trim()
  if (!raw) return Promise.resolve({ text: "", refined: false })

  return new Promise((resolve) => {
    let settled = false
    const finish = (text: string, refined: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        unsub()
      } catch {
        /* */
      }
      resolve({ text, refined })
    }

    const unsub = onMessage((msg: any) => {
      if (!msg || typeof msg.type !== "string") return
      if (msg.sessionId !== opts.sessionId) return
      if (msg.refineGen !== opts.refineGen) return
      if (msg.type === "voice.refine.result" && typeof msg.text === "string") {
        const out = msg.text.trim() || raw
        finish(out, out !== raw)
        return
      }
      if (msg.type === "voice.refine.error" || msg.type === "voice.refine.aborted") {
        finish(raw, false)
      }
    })

    const timer = setTimeout(() => finish(raw, false), timeoutMs)

    send(
      buildMeetingRefineRequest({
        sessionId: opts.sessionId,
        refineGen: opts.refineGen,
        text: raw,
        priorTranscript: opts.priorTranscript,
      }),
    )
  })
}
