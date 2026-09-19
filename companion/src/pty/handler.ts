// terminal.* WS handler (spec §4/§5). Panel-only. L2 on open never skipped by cruise.

import { getConfig, getConfigDir } from "../config"
import { CodeReviewService } from "../code-review/service"
import { reviewPrompt } from "../code-review/report"
import type { ThreadManager } from "../threads/thread-manager"
import * as path from "path"
import { peekEmbedIntent, recordEmbedIntent, sameEmbedIntent, takeEmbedIntent } from "../acp/open-local-terminal"
import { resolveTerminalStartCwd } from "./cwd"
import {
  ackPty,
  closePty,
  INVALID_PTY_OPTS,
  pausePty,
  pingPty,
  resizePty,
  resumePty,
  spawnPtySession,
  writePtyInput,
  ptyHostPlatform,
  getOwnedPtyContext,
} from "./session"

type Services = { threadManager: ThreadManager }
type Session = {
  sendToExtension: (data: unknown) => void
  requestConfirmation?: (details: {
    toolName: string
    dangerousApis: string[]
    code: string
  }) => Promise<{ approved: boolean }>
  surface?: string
  originWs?: unknown
}
let pendingOpen: { id: string; owner: unknown; canceled: boolean } | null = null

function clampSize(n: unknown, fallback: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(1, Math.floor(n)))
}

function deny(error: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: "terminal.error", code: "request_failed", error, ...extra }
}

export async function handleTerminalMessage(
  type: string,
  rest: Record<string, unknown>,
  services: Services,
  session: Session | undefined,
  _stampedSurface: string | undefined,
): Promise<Record<string, unknown>> {
  const id = typeof rest.id === "string" ? rest.id.trim() : ""
  const surface = session?.surface

  if (surface !== "panel") {
    return deny("terminal.* is panel-only (Side Panel / extension tab)", {
      error_code: surface === "summoner" ? "SUMMONER_ACL" : "TERMINAL_SURFACE",
    })
  }
  // A tab can close while its L2 prompt is still pending on the shared WS.
  if (type === "terminal.close" && pendingOpen?.id === id && pendingOpen.owner === session?.originWs) {
    pendingOpen.canceled = true
    pendingOpen = null
    return { type: "terminal.ok", id }
  }

  if (type === "terminal.open") {
    if (!id) return deny("terminal.open requires id")
    if (rest.review_id !== undefined && (typeof rest.review_id !== "string" || !rest.review_id)) return deny("INVALID_REVIEW_ID", { id })
    if (rest.user_gesture !== true) {
      return deny("terminal.open requires user_gesture:true")
    }
    if (getConfig().embedded_terminal?.enabled !== true) {
      return deny("embedded_terminal_disabled")
    }
    if (ptyHostPlatform() !== "darwin") {
      return {
        type: "terminal.closed",
        id,
        code: "unsupported",
        signal: 0,
        error: "内嵌终端仅支持 macOS（darwin）；Windows/Linux 另票。",
      }
    }

    const threadId = typeof rest.thread_id === "string" ? rest.thread_id.trim() : ""
    let workspaceRoot: string | null = null
    if (threadId) {
      const thr = services.threadManager.get(threadId)
      if (!thr) return deny(`Thread not found: ${threadId}`)
      if (thr.execution_policy === "plan_readonly") {
        return deny("PLAN_READONLY: terminal.open denied for this thread")
      }
      workspaceRoot = typeof thr.workspace_root === "string" ? thr.workspace_root : null
    }

    const cwdRes = resolveTerminalStartCwd({
      requested: typeof rest.cwd === "string" ? rest.cwd : undefined,
      workspaceRoot,
    })
    if (!cwdRes.ok) return deny(cwdRes.error)

    if (!session?.requestConfirmation) {
      return deny("terminal.open requires an origin-bound confirmation channel")
    }
    const peer = session.originWs as { readyState?: number } | undefined
    if (!peer || peer.readyState !== 1) return deny("TERMINAL_PEER_REQUIRED", { id })
    const reviewId = typeof rest.review_id === "string" ? rest.review_id : ""
    let review: ReturnType<CodeReviewService["read"]> | undefined
    if (reviewId) {
      if (!threadId) return deny("CODE_REVIEW_THREAD_REQUIRED", { id })
      try { review = new CodeReviewService(getConfigDir(), { kind: "chat", threadId }).read({ review_id: reviewId }) }
      catch { return deny("CODE_REVIEW_NOT_FOUND_OR_INVALID", { id }) }
    }
    if (pendingOpen) return deny("terminal_busy", { id })
    // #502 C: PEEK (non-consuming) before building the L2 copy. The dialog must describe what the
    // PTY will actually run — a user approving a "login shell" while the handler launches the agent
    // binary with their task file would be consenting to something the text does not describe.
    // The `threadId` test below is the SAME one the TAKE uses: an intent is claimed only by a
    // thread-bound tab, and peek/take must never disagree about which key they are looking at. If
    // peek used the normalizing key while take refused a falsy thread, the L2 copy could promise an
    // agent that the spawn site then rejects as "expired" — a copy that lies in the other direction.
    const embedIntent = threadId ? peekEmbedIntent(threadId) : null
    // A wire `argv` may only refine the args of an intent-supplied executable, never choose one.
    const wireArgs = Array.isArray(rest.argv)
      ? rest.argv.filter((a): a is string => typeof a === "string")
      : null
    const embedArgs = embedIntent ? wireArgs ?? embedIntent.args : null
    const pending = { id, owner: session.originWs, canceled: false }
    pendingOpen = pending
    let decision: { approved: boolean }
    try {
      decision = await session.requestConfirmation({
        toolName: "terminal.open",
        dangerousApis: ["pty", "shell"],
        code: embedIntent && embedArgs
          ? `open embedded PTY cwd=${cwdRes.cwd}\n本机内嵌终端将运行 Agent：${path.basename(embedIntent.file)}（参数 ${embedArgs.length} 个）；该 Agent 可读取用户 Agent 登录配置和环境；非只读沙箱。${review ? `\nreview=${reviewId}\nrepository=${review.repository}\nbase=${review.base}\nhead=${review.head}` : ""}`
          : `open login PTY cwd=${cwdRes.cwd}\n本机用户 shell，可读取用户 Agent 登录配置和环境；非只读沙箱。${review ? `\nreview=${reviewId}\nrepository=${review.repository}\nbase=${review.base}\nhead=${review.head}` : ""}`,
      })
    } catch { return deny("TERMINAL_CONFIRMATION_FAILED", { id }) }
    finally { if (pendingOpen === pending) pendingOpen = null }
    if (pending.canceled) return deny("TERMINAL_OPEN_CANCELED", { id })
    if (!decision.approved) {
      return {
        type: "terminal.closed",
        id,
        code: "denied",
        signal: 0,
      }
    }
    // Confirmation can outlive a socket, thread, workspace or execution policy.
    if (peer.readyState !== 1) return deny("TERMINAL_PEER_CLOSED", { id })
    const current = threadId ? services.threadManager.get(threadId) : null
    if (threadId && (!current || current.execution_policy === "plan_readonly" || (current.workspace_root || null) !== workspaceRoot)) return deny("TERMINAL_CONTEXT_CHANGED", { id })
    const freshCwd = resolveTerminalStartCwd({ requested: cwdRes.cwd, workspaceRoot })
    if (!freshCwd.ok || freshCwd.cwd !== cwdRes.cwd) return deny("TERMINAL_CONTEXT_CHANGED", { id })
    if (review) {
      try {
        const freshReview = new CodeReviewService(getConfigDir(), { kind: "chat", threadId }).read({ review_id: reviewId })
        if (JSON.stringify(freshReview) !== JSON.stringify(review)) return deny("CODE_REVIEW_CONTEXT_CHANGED", { id })
        review = freshReview
      } catch { return deny("CODE_REVIEW_CONTEXT_CHANGED", { id }) }
    }

    const send = (frame: Record<string, unknown>) => {
      try {
        session.sendToExtension(frame)
      } catch {
        /* ignore */
      }
    }
    // #502 C: only NOW may the intent be consumed. Without one this is exactly today's request
    // (`$SHELL -l`) — a page-supplied `argv` alone can never choose an executable or args.
    const intent = threadId ? takeEmbedIntent(threadId) : null
    if (embedIntent && !intent) {
      // The copy promised an agent; the intent expired between confirm and spawn. Spawning
      // `$SHELL -l` here would run what the user did NOT approve, so fail closed instead.
      return deny("EMBED_INTENT_EXPIRED: 内嵌 Agent 启动意图已失效，请重新点击面板「在本插件打开终端」按钮", { id })
    }
    if (intent && !embedIntent) {
      // The mirror image of the guard above. Mode C can RECORD an intent while the L2 dialog is
      // open, so peek found nothing and the user was shown (and approved) the "本机用户 shell" copy.
      // Take now sees a freshly recorded intent, and spawning the agent binary with the task file
      // would run what this dialog never described — the same consent violation, inverted. Fail
      // CLOSED: `$SHELL -l` is refused too, because the approved copy promised a shell while the
      // panel's own state now says embed; returning without spawning and asking again is the only
      // honest answer. The intent is put back (same choice as the denied-confirmation path) so the
      // re-click the error text asks for really does show the embed copy and ask again.
      recordEmbedIntent(threadId, intent)
      return deny(
        "EMBED_INTENT_UNCONFIRMED: 确认期间新出现了内嵌 Agent 启动意图，本次确认的是本机用户 shell，未授权启动 Agent，故已拒绝（未降级为登录 shell）。请重新点击面板「在本插件打开终端」按钮，按提示确认内嵌 Agent 后再启动",
        { id },
      )
    }
    if (embedIntent && intent && !sameEmbedIntent(embedIntent, intent)) {
      // The third race, and the only one where BOTH sides are present: a REPLACEMENT intent. Mode C
      // can start a second run for this thread while the dialog is open, and `recordEmbedIntent`
      // overwrites the entry in place — so take returns a different `file`/`args`/`cwd` than the ones
      // the copy named. The EXPIRED guard sees a non-null take and the UNCONFIRMED guard sees a
      // non-null peek, so neither fires; spawning would run an agent whose basename and argv the user
      // never approved (approved A, got B). Fail CLOSED for both: neither A nor B spawns, and not
      // `$SHELL -l` either. The TAKEN (newer) intent is put back — the same choice the UNCONFIRMED
      // guard makes — so the re-click the error text asks for shows the embed copy for the agent the
      // panel's CURRENT state points at. Restoring the stale approved intent would instead let the
      // next click re-run A without ever having described it again.
      recordEmbedIntent(threadId, intent)
      return deny(
        "EMBED_INTENT_REPLACED: 确认期间内嵌 Agent 启动意图已被替换为另一个 Agent，本次确认的 Agent 未获授权启动，替换后的 Agent 也未经确认，故两者均未启动。请重新点击面板「在本插件打开终端」按钮，按提示确认当前 Agent 后再启动",
        { id },
      )
    }
    const spawned = spawnPtySession({
      id,
      cols: clampSize(rest.cols, 80, 500),
      rows: clampSize(rest.rows, 24, 200),
      cwd: cwdRes.cwd,
      threadId: threadId || undefined,
      reviewId: reviewId || undefined,
      owner: session.originWs,
      send,
      ...(intent ? { file: intent.file, args: wireArgs ?? intent.args } : {}),
    })
    if (!spawned.ok) {
      // #506 B: `takeEmbedIntent` already CONSUMED the intent above. A spawn that never started
      // (the single slot was busy, or the agent binary failed to exec) must hand the intent back —
      // the same put-back the EXPIRED/UNCONFIRMED/REPLACED guards make — or the re-click the error
      // sends the user to would silently downgrade to a login shell. TTL resets on re-record;
      // INVALID_PTY_OPTS stays consumed because that retry would fail identically forever.
      if (intent && threadId && (spawned.error === "terminal_busy" || spawned.code === "spawn_failed")) {
        recordEmbedIntent(threadId, intent)
      }
      if (spawned.code === INVALID_PTY_OPTS) {
        // #502 C: a malformed file/argv never spawned anything, so reporting it as
        // `terminal.closed`/`spawn_failed` would render as "opened then died". It is a request error.
        return deny(spawned.error, { id })
      }
      if (spawned.code === "unsupported" || spawned.code === "spawn_failed") {
        return {
          type: "terminal.closed",
          id,
          code: spawned.code,
          signal: 0,
          error: spawned.error,
        }
      }
      return deny(spawned.error)
    }
    return { type: "terminal.opened", id, pid: spawned.pid, platform: "darwin", ...(review ? { review_id: reviewId, review_prompt: reviewPrompt(review) } : {}) }
  }

  if (!id) return deny(`${type} requires id`)
  const context = getOwnedPtyContext(id, session?.originWs)
  if (!context) return deny("TERMINAL_SESSION_NOT_OWNED", { id })
  if (context.threadId) {
    const thread = services.threadManager.get(context.threadId)
    if (!thread || thread.execution_policy === "plan_readonly") { closePty(id); return deny("TERMINAL_CONTEXT_CHANGED", { id }) }
  }

  if (type === "terminal.review.submit") {
    if (!context.threadId || !context.reviewId || rest.user_gesture !== true || !session?.requestConfirmation) return deny("CODE_REPORT_BOUND_CONFIRMATION_REQUIRED", { id })
    const thread = services.threadManager.get(context.threadId)
    if (!thread || thread.execution_policy === "plan_readonly") return deny("CODE_REPORT_THREAD_UNAVAILABLE", { id })
    try {
      const service = new CodeReviewService(getConfigDir(), { kind: "chat", threadId: context.threadId })
      const report = service.previewReport(rest.report)
      if (report.review_id !== context.reviewId) return deny("CODE_REPORT_IDENTITY_MISMATCH", { id })
      const decision = await session.requestConfirmation({ toolName: "terminal.review.submit", dangerousApis: ["external_report_import"],
        code: `将以下外部评审报告保存至原任务 ${context.threadId}。确认仅表示同意导入，不表示代码/测试核实或批准。\n${JSON.stringify(report, null, 2)}` })
      if (!decision.approved) return deny("CODE_REPORT_DENIED", { id })
      const current = services.threadManager.get(context.threadId)
      if (getOwnedPtyContext(id, session.originWs) !== context || !current || current.execution_policy === "plan_readonly") return deny("CODE_REPORT_CONTEXT_CHANGED", { id })
      const receipt = service.receive(report)
      const messageId = `code-review-${receipt.id}`
      // Retry heals an interrupted history write without duplicating the receipt.
      let message = services.threadManager.getMessages(context.threadId).find(item => item.id === messageId)
      if (!message) message = services.threadManager.addMessage(context.threadId, { id: messageId, thread_id: context.threadId, role: "assistant",
        content: `已收到用户确认导入的外部代码评审报告。审阅编号：${context.reviewId}；回执：${receipt.id}。报告和网页覆盖仍待核实，可调用 code_review_read 查看原任务中的完整报告及缺项。` })
      // Delivery is best-effort after durable receipt/history writes. A lost
      // socket must not turn a successful import into a persistence failure.
      try { session.sendToExtension({ type: "code_review.handback.message", thread_id: context.threadId, message }) } catch { /* history restores on reconnect */ }
      return { type: "terminal.review.received", id, receipt_id: receipt.id, review_id: context.reviewId }
    } catch (error) {
      const code = (error as Error).message
      return deny(/^[A-Z][A-Z0-9_]+$/.test(code) ? code : "CODE_REPORT_INVALID_OR_PERSIST_FAILED", { id })
    }
  }

  if (type === "terminal.input") {
    if (typeof rest.b64 !== "string") return deny("terminal.input requires b64")
    const r = writePtyInput(id, rest.b64)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.resize") {
    const r = resizePty(id, clampSize(rest.cols, 80, 500), clampSize(rest.rows, 24, 200))
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.ack") {
    if (typeof rest.seq !== "number" || !Number.isFinite(rest.seq)) {
      return deny("terminal.ack requires seq")
    }
    const r = ackPty(id, Math.floor(rest.seq))
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.ping") {
    pingPty(id)
    return { type: "terminal.ok", id }
  }
  if (type === "terminal.pause") {
    const r = pausePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.resume") {
    const r = resumePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.close") {
    const r = closePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  return deny(`Unhandled terminal type: ${type}`)
}
