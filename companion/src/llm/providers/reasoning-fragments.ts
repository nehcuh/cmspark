/**
 * Some gateways stream a growing snapshot in a delta field. Require three
 * strictly growing prefixes in the same block before treating it as snapshots.
 * A single matching pair and ordinary repeated delta text stay intact.
 */
export class GatewayReasoningFragments {
  private previous = ""
  private candidate = ""
  private snapshots = false

  push(text: string): string {
    if (this.snapshots && text.startsWith(this.previous)) {
      const suffix = text.slice(this.previous.length)
      this.previous = text
      return suffix
    }
    if (this.candidate && text.length > this.candidate.length && text.startsWith(this.candidate)) {
      const suffix = text.slice(this.previous.length)
      this.snapshots = true
      this.previous = text
      this.candidate = ""
      return suffix
    }
    if (!this.candidate && this.previous && text.length > this.previous.length && text.startsWith(this.previous)) {
      this.candidate = text
      return ""
    }
    const pending = this.flush()
    this.previous = text
    return pending + text
  }

  flush(): string {
    const pending = this.candidate
    this.previous = ""
    this.candidate = ""
    this.snapshots = false
    return pending
  }
}
