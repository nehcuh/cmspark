// Shared types for NotebookLM importer (v1.1).

/** A single source to import. The runner picks URL vs text path based on which field is set. */
export interface ImportItem {
  /** Optional display title — used as filename hint for offline MD, or as source-rename target. */
  title?: string
  /** URL to add as a Website source. If set, `text` must be empty. */
  url?: string
  /** Text content to add as a "Copied text" source. If set, `url` must be empty. */
  text?: string
}

/** Result of one item's import attempt. */
export interface ImportItemResult {
  item: ImportItem
  ok: boolean
  /** When ok=false, a short human-readable error. */
  error?: string
  /** Milliseconds the import took. */
  durationMs: number
}

/** Aggregate state of a batch, persisted across SW restarts. */
export interface BatchState {
  /** Stable batch ID (UUID-ish). */
  id: string
  /** ISO timestamp when batch started. */
  startedAt: string
  /** ISO timestamp when batch finished (ok or aborted). */
  finishedAt?: string
  /** Original items in submission order. */
  items: ImportItem[]
  /** Per-item result, indexed parallel to `items`. Undefined = pending. */
  results: (ImportItemResult | undefined)[]
  /** Cursor — index of the next item to attempt. */
  nextIndex: number
  /** "running" | "paused" | "done" | "cancelled" | "error" */
  status: BatchStatus
  /** Notebook ID we're importing into. Empty = use whatever notebook the user has open. */
  notebookId?: string
  /** Phase 5 review: cancel flag persisted so it survives SW restart.
   *  When true, the loop checks this between items AND between retry attempts. */
  cancelRequested?: boolean
}

export type BatchStatus = "running" | "paused" | "done" | "cancelled" | "error"

/** Minimal notebook info returned by the list RPC. */
export interface NotebookInfo {
  id: string
  title: string
  /** ISO timestamp of last update, if the RPC returns it. */
  updatedAt?: string
}

/** Selector strategy entry. We try each `selector` in order until one resolves to a unique element. */
export interface SelectorStrategy {
  /** Stable key for logging / CI canary. */
  key: string
  /** CSS selectors to try in order. */
  css: string[]
  /** Fallback: find by button/element text content (case-insensitive contains). */
  textContent?: string[]
  /** Fallback: find by aria-label. */
  ariaLabel?: string[]
  /** Fallback: find by role attribute. */
  role?: string
}

/** Selector registry — every NotebookLM DOM touchpoint goes through this. */
export interface SelectorRegistry {
  /** "Add source" button on the notebook page (opens the dialog). */
  addSourceButton: SelectorStrategy
  /** Dialog container that wraps the Add Source modal. */
  dialogContainer: SelectorStrategy
  /** Sub-page picker button for "Website/Link". */
  websiteLinkOption: SelectorStrategy
  /** Sub-page picker button for "Copied text". */
  copiedTextOption: SelectorStrategy
  /** URL input textarea inside the dialog. */
  urlInput: SelectorStrategy
  /** Copied-text input textarea inside the dialog. */
  textInput: SelectorStrategy
  /** "Insert" / "插入" submit button inside the dialog. */
  submitButton: SelectorStrategy
  /** "Back" button inside the dialog (to navigate between sub-pages). */
  backButton: SelectorStrategy
  /** A source row in the source list (used to detect "newly added"). */
  sourceRow: SelectorStrategy
  /** Title element inside a source row. */
  sourceTitle: SelectorStrategy
}
