import { iso } from './validation'

// A capture timestamp is not a message timestamp. A model-selected substring
// may omit negation, conditions or another task's context. Accept only a
// standalone absolute deadline occupying the entire captured text and quote.
export function evidencedDeadline(sourceText: string, quote: string, proposed: unknown): string | null {
  if (typeof sourceText !== 'string' || typeof quote !== 'string' || typeof proposed !== 'string' || sourceText.trim() !== quote.trim()) return null
  const match = /^(?:截止\s*[:：]?\s*|(?:due(?:\s+by)?|deadline)(?:\s*[:：]\s*|\s+))(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))[。.!]?$/i.exec(quote.trim())
  if (!match) return null
  try {
    const evidence = iso(match[1]), candidate = iso(proposed)
    return evidence !== null && evidence === candidate ? candidate : null
  } catch { return null }
}
