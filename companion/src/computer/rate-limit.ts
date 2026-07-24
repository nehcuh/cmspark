// WP2 (Y7): session-level injection rate limiting.
//
// Per-task budgets (15/30) cap ONE run; they do nothing against a runaway
// agent looping host_computer calls back-to-back. This limiter is the
// PROCESS-level backstop: the server refuses a new computer task when the
// last 60s already saw RATE_LIMIT_MAX_IN_WINDOW successful injections, and
// the task-level L2 dialog always shows the running counters so the human
// gate sees the cumulative picture, not just the current draft.
//
// Counted: SUCCESSFUL SendInput dispatches only (executor onActionInjected
// hook). Failed/located-but-never-injected actions do not consume the rate.

export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_IN_WINDOW = 30

export class InjectionRateLimiter {
  private stamps: number[] = []
  private total = 0

  constructor(
    private now: () => number = () => Date.now(),
    private windowMs: number = RATE_LIMIT_WINDOW_MS,
    private maxInWindow: number = RATE_LIMIT_MAX_IN_WINDOW,
  ) {}

  /** Record n successful injections (default 1). */
  record(n = 1): void {
    const t = this.now()
    for (let i = 0; i < n; i++) this.stamps.push(t)
    this.total += n
  }

  /** Injections inside the trailing window (prunes stale stamps). */
  countInWindow(): number {
    const cutoff = this.now() - this.windowMs
    // stamps are append-ordered; drop everything at/before the cutoff.
    let drop = 0
    while (drop < this.stamps.length && this.stamps[drop] <= cutoff) drop++
    if (drop > 0) this.stamps.splice(0, drop)
    return this.stamps.length
  }

  /** Session-cumulative successful injections (never pruned). */
  totalApproved(): number {
    return this.total
  }

  /** True when a NEW task must be refused (window saturated). */
  saturated(): boolean {
    return this.countInWindow() >= this.maxInWindow
  }

  /** The L2 dialog status line (Y3 extraLines). */
  statusLine(): string {
    return `本会话累计已批准注入 ${this.totalApproved()}；近 60 秒已注入 ${this.countInWindow()}/${this.maxInWindow}`
  }
}
