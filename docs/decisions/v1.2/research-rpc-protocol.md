# NotebookLM batchexecute RPC Protocol — Deep Research

**Date**: 2026-07-15
**Sources**: 
- Kimi CLI deep research (partial — OAuth died mid-research but extracted RPC IDs first)
- Direct fetch of `teng-lin/notebooklm-py` source files
- Phase 0 research (jetpack source)

## Root cause of repeated failures

**DOM automation produces false positives**. The "dialog closed = success" heuristic treats ANY dialog closure as acceptance — including:
- Validation failure (dialog closes with error toast)
- Network error during submit
- User pressing Escape
- Angular state change
- Race conditions during SPA navigation

My orchestrator reported "✓ 1/1 success" while NotebookLM showed nothing imported. This is the root cause of 5 rounds of failed fixes.

## Solution: switch to direct batchexecute RPC

NotebookLM has a private batchexecute API (reverse-engineered by `notebooklm-py`). RPC calls give:
- **Definitive success/failure** — response contains source ID or error code
- **No UI selector drift** — RPC IDs are stable strings
- **No Angular timing races** — direct HTTP, no DOM

## RPC IDs (verified from `rpc/types.py:74-112`)

```typescript
const RPC = {
  LIST_NOTEBOOKS: "wXbhsf",       // ListRecentlyViewedProjects
  CREATE_NOTEBOOK: "CCqFvf",      // CreateProject
  GET_NOTEBOOK: "rLM1Ne",         // GetProject (also returns sources)
  RENAME_NOTEBOOK: "s0tc2d",      // MutateProject
  DELETE_NOTEBOOK: "WWINqb",      // DeleteProjects (batch)
  ADD_SOURCE: "izAoDd",           // AddSources (URL/YouTube/Text all use this)
  ADD_SOURCE_FILE: "o4cbdc",      // File upload registration
  UPDATE_SOURCE: "b7Wfje",        // MutateSource (rename source)
  DELETE_SOURCE: "tGMBJ",         // DeleteSources (batch)
} as const
```

## Template block (shared wrapper)

**Source**: `upload_payloads.py:32`

```typescript
// [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
function buildTemplateBlock(): any[] {
  return [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
}
```

Per Gemini-3.5 wire migration (#1546): migrated backends reject the old flat `[2], [1]` tail. MUST use the nested template block.

## Param structures

### CREATE_NOTEBOOK (CCqFvf) — `notebooks.py:56`
```typescript
function buildCreateNotebookParams(title: string) {
  return [title, null, null, buildTemplateBlock()]
}
```

### RENAME_NOTEBOOK (s0tc2d) — `notebooks.py` rename()
```typescript
function buildRenameNotebookParams(notebookId: string, newTitle: string) {
  return [notebookId, [[null, null, null, [null, newTitle]]]]
}
```

### GET_NOTEBOOK (rLM1Ne) — `notebooks.py:70` (also lists sources)
```typescript
function buildGetNotebookParams(notebookId: string) {
  return [notebookId, null, buildTemplateBlock(), null, 0]
}
```

### ADD_SOURCE for URL (izAoDd) — `source_add.py:420`
```typescript
// URL goes at source-spec position [2]
function buildAddUrlSourceParams(notebookId: string, url: string) {
  return [
    [[null, null, [url], null, null, null, null, null, null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}
```

### ADD_SOURCE for YouTube (izAoDd) — `source_add.py:391`
```typescript
// YouTube URL goes at source-spec position [7] (different from URL!)
function buildAddYoutubeSourceParams(notebookId: string, url: string) {
  return [
    [[null, null, null, null, null, null, null, [url], null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}
```

### ADD_SOURCE for Text (izAoDd) — `source_add.py:145`
```typescript
// [title, content] at position [1]; literal 2 at position [3] is source-type code
function buildAddTextSourceParams(notebookId: string, title: string, content: string) {
  return [
    [[null, [title, content], null, 2, null, null, null, null, null, null, 1]],
    notebookId,
    buildTemplateBlock(),
  ]
}
```

## CSRF + auth

- **SNlM0e** token: regex extract from home HTML `"SNlM0e":"([^"]+)"`
- Same-origin fetch from inside NotebookLM tab → cookies auto-attached
- Token rotates per session; re-extract on 403/401

## Request body template

```
POST https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=<ID>&source-path=/&rt=c

f.req=<urlencoded JSON>&at=<urlencoded CSRF>&

JSON shape: [[["<rpcId>", "<json-stringified-params>", null, "generic"]]]
```

## Response envelope (chunked)

```
)]}'

<chunklen>

[["wrb.fr","<rpcId>","<json-string>",null,null,null,"generic"]]
[<timing>]
```

Strip `)]}'` + chunk-length line, parse first balanced `[...]`, find `wrb.fr` entry, JSON.parse `entry[2]`.

## Success verification (the missing piece)

**Don't trust dialog closure. Instead:**

1. **For ADD_SOURCE**: response contains the new source object directly (with source ID). If response is null or contains error code → fail.
2. **For CREATE_NOTEBOOK**: response contains new notebook ID. Match against `\/notebook\/([a-f0-9-]+)` pattern.
3. **For verification**: call `GET_NOTEBOOK` (rLM1Ne) → parse source list → confirm new source URL/title appears.

## Architecture decision

**RPC-first, DOM-fallback**:
1. All operations use batchexecute RPC by default
2. RPC calls happen INSIDE the NotebookLM tab (same-origin, cookies auto-attached)
3. CSRF extracted from home HTML via regex (already implemented)
4. Success verified by response parsing + (optionally) list-sources poll
5. DOM automation kept ONLY for cases RPC can't handle (none currently identified)

## Why our DOM automation was unreliable

`notebooklm-web-importer` actually DOES use DOM automation in production (their fetch interception is dead code per Phase 0 research). They avoid false positives by:
- After submit, they wait for `.single-source-container` count to INCREASE (real source added)
- If count doesn't increase in 1.5s, they consider it failed

My heuristic was wrong: I added "dialog closed = success" which is wrong. Should be "source count increased = success". But even that can fail if Angular delays the source-row render.

**RPC is strictly better**: no UI dependency, definitive response.

## Implementation

→ `chrome-extension/src/notebooklm/rpc-client.ts` (new)
→ Orchestrator rewritten to use RPC
→ DOM automation kept as commented-out fallback only
