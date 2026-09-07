export type DraftKind = "change_material.v1" | "development_trace.v1"
export type FieldState = "supported" | "missing" | "conflict" | "unverified" | "stale"
export type FactType = "scalar" | "collection"
export interface FieldDefinition { type: FactType; token: boolean; clock: "mutable" | "immutable" | "runtime" | "tests"; required: boolean }

const scalar = (token = true, clock: FieldDefinition["clock"] = "mutable", required = true): FieldDefinition => ({ type: "scalar", token, clock, required })
const collection = (clock: FieldDefinition["clock"] = "mutable", token = true): FieldDefinition => ({ type: "collection", token, clock, required: true })

export const DRAFT_SCHEMAS: Readonly<Record<DraftKind, { fields: Readonly<Record<string, FieldDefinition>>; relations: readonly string[] }>> = {
  "change_material.v1": {
    fields: {
      "target.system_id": scalar(), "target.environment": scalar(),
      "release.id": scalar(), "release.version": scalar(), "release.commit_id": scalar(true, "immutable"), "release.build_id": scalar(),
      "artifact.id": scalar(), "artifact.version": scalar(), "artifact.digest": scalar(true, "immutable"), "artifact.build_id": scalar(),
      "architecture.system_id": scalar(), "architecture.revision": scalar(true, "immutable"),
      "architecture.dependencies": collection(), "architecture.impact_note": scalar(false),
      "runtime.system_id": scalar(true, "runtime"), "runtime.environment": scalar(true, "runtime"),
      "runtime.assets": collection("runtime"), "runtime.source_updated_at": scalar(false, "runtime"),
    },
    relations: ["release_artifact", "architecture_target", "runtime_target"],
  },
  "development_trace.v1": {
    fields: {
      "requirement.id": scalar(), "requirement.revision": scalar(), "requirement.acceptance_criteria": collection("mutable", false),
      "story.requirement_id": scalar(), "story.acceptance_criteria": collection("mutable", false),
      "code.repository_id": scalar(), "code.commit_id": scalar(true, "immutable"), "code.pr_id": scalar(true, "mutable", false), "code.requirement_id": scalar(),
      "tests.case_ids": collection(), "tests.requirement_id": scalar(), "tests.commit_id": scalar(true, "immutable"),
      "tests.run_id": scalar(true, "tests"), "tests.outcome": scalar(true, "tests"), "tests.source_updated_at": scalar(false, "tests"),
      "tests.criteria_mapping": collection(),
      "defects.status": scalar(), "defects.ids": collection(), "defects.requirement_id": scalar(),
    },
    relations: ["story_requirement", "code_requirement", "tests_requirement", "tests_commit", "defects_requirement", "criteria_cases"],
  },
}

export const DERIVED_RELATIONS = new Set(["story_requirement", "criteria_cases"])
export const KNOWN_FIELDS = new Set(Object.values(DRAFT_SCHEMAS).flatMap(schema => Object.keys(schema.fields)))
export const COLLECTION_FIELDS = new Set(Object.values(DRAFT_SCHEMAS).flatMap(schema => Object.entries(schema.fields).filter(([, field]) => field.type === "collection").map(([name]) => name)))
export const KNOWN_RELATIONS = new Set(Object.values(DRAFT_SCHEMAS).flatMap(schema => [...schema.relations]))
