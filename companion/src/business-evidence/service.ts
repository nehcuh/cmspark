import * as path from "node:path"
import type { EvidenceScope } from "./content"
import { EvidenceStore } from "./store"
import { DraftRepository } from "./draft-repository"
import { checkDraft } from "./checker"
import { renderDraft } from "./render"

/** Scope is provided by the authenticated executor, never parsed from params. */
export class BusinessEvidenceService {
  readonly store: EvidenceStore
  private readonly drafts: DraftRepository
  constructor(dataDir: string, scope: EvidenceScope, private readonly now: () => number = Date.now) {
    this.store = new EvidenceStore(dataDir, scope)
    this.drafts = new DraftRepository(this.store, path.join(dataDir, "pilot-contract.json"), now)
  }
  create(input: unknown) { return this.drafts.create(input).mutation_result }
  update(input: unknown) { return this.drafts.update(input).mutation_result }
  read(input: unknown) {
    const draft = this.drafts.read(input)
    const state = this.store.read()
    return checkDraft(draft, state.observations, state.locked_pilot!, state.capacity_gap, this.now())
  }
  render(input: unknown) { return renderDraft(this.read(input)) }
}
