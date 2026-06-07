# CMspark Site Knowledge Base — Radical Architecture Design

## 1. Architecture Diagram

```
Extension Layer (Plasmo + React)          Companion Layer (Node.js + TypeScript)
┌─────────────────────────┐               ┌────────────────────────────────────────┐
│ Side Panel UI           │◄──WS────────►│ WebSocket Server (ws://127.0.0.1:23401)│
│ Browser Bridge          │               │ Message Router                         │
│ (CDP/Tabs/Cookies)      │               └────────────┬───────────────────────────┘
└─────────────────────────┘                            │
                                                       ▼
                              ┌────────────────────────────────────────────────────┐
                              │           Core Engine                               │
                              │  Thread Manager │ Skill Engine(v2) │ LLM Adapter   │
                              │  Tool Dispatcher│ History Store    │ Security      │
                              └─────────────────┴──────────────────┴───────────────┘
                                                       │
                              ┌────────────────────────▼───────────────────────────┐
                              │        Knowledge Base Subsystem (NEW)               │
                              │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
                              │  │ KB API  │  │ Storage  │  │ Processing       │   │
                              │  │ (facade)│  │ - Vector │  │ - Ingest/Chunk   │   │
                              │  │         │  │   DB     │  │ - Embed/Index    │   │
                              │  │ query() │  │ - Meta   │  │                  │   │
                              │  │ ingest()│  │ - Doc    │  ├──────────────────┤   │
                              │  │ sync()  │  │ - Version│  │ Query Engine     │   │
                              │  └────┬────┘  └──────────┘  │ - Vector Search  │   │
                              │       │                     │ - Keyword Search │   │
                              │       ▼                     │ - RRF Fusion     │   │
                              │  ┌──────────────┐           │ - Context Asm    │   │
                              │  │ Discovery    │           └──────────────────┘   │
                              │  │ - Crawler    │                                   │
                              │  │ - Auto-extract│                                   │
                              │  │ - Scheduler  │                                   │
                              │  └──────────────┘                                   │
                              └─────────────────────────────────────────────────────┘
```

### Storage Layer
- **Vector DB**: SQLite + sqlite-vec (local vector similarity search)
- **Metadata Store**: SQLite (doc registry, tags, site bindings, access stats)
- **Document Store**: File system at `~/.cmspark-agent/knowledge/`
- **Version Control**: libgit2 / isomorphic-git (Git-based versioning)

### Processing Pipeline
- Document Ingestor → Chunking Engine (semantic/structural) → Embedding Generator (local all-MiniLM or remote API) → Indexer (incremental/full)

### Query Engine
- Vector Search + Keyword Search (FTS5/BM25) → Reciprocal Rank Fusion → Context Assembler (relevance + token budget)

### Knowledge Discovery (optional advanced feature)
- Site Crawler (headless browser) → Auto-Extractor (LLM-driven page analysis) → Sync Scheduler (cron/event-driven)

### Collaboration (optional advanced feature)
- Diff Engine → Merge Resolver (3-way merge + LLM conflict resolution) → Git Sync (push/pull/branch)

## 2. Modules and Change Points

### 2.1 New Files (~20 files)

| File | Purpose |
|------|---------|
| `companion/src/knowledge/api.ts` | Public API facade: `KnowledgeBase` class |
| `companion/src/knowledge/types.ts` | Core types: `KnowledgeDoc`, `KnowledgeChunk`, `SearchResult` |
| `companion/src/knowledge/store/vector-db.ts` | SQLite + sqlite-vec wrapper |
| `companion/src/knowledge/store/metadata-store.ts` | SQLite metadata registry |
| `companion/src/knowledge/store/document-store.ts` | File system abstraction with path security |
| `companion/src/knowledge/store/version-control.ts` | Git operations wrapper |
| `companion/src/knowledge/ingest/ingestor.ts` | Main ingest orchestrator |
| `companion/src/knowledge/ingest/chunker.ts` | Chunking strategies (semantic/structural/fixed) |
| `companion/src/knowledge/ingest/embedder.ts` | Embedding generation (local or remote) |
| `companion/src/knowledge/ingest/indexer.ts` | Index builder (incremental updates) |
| `companion/src/knowledge/query/vector-search.ts` | Vector similarity search |
| `companion/src/knowledge/query/keyword-search.ts` | FTS5 + BM25 keyword search |
| `companion/src/knowledge/query/hybrid-fusion.ts` | RRF (Reciprocal Rank Fusion) |
| `companion/src/knowledge/query/context-assembler.ts` | Final context assembly with token budget |
| `companion/src/knowledge/discovery/crawler.ts` | Headless site crawler |
| `companion/src/knowledge/discovery/auto-extractor.ts` | LLM-driven content extraction |
| `companion/src/knowledge/discovery/scheduler.ts` | Sync scheduler (cron-like) |
| `companion/src/knowledge/collab/diff-engine.ts` | Semantic diff for markdown |
| `companion/src/knowledge/collab/merge-resolver.ts` | 3-way merge with LLM assistance |
| `companion/src/knowledge/collab/git-sync.ts` | Remote Git sync |

### 2.2 Modified Files

| File | Changes |
|------|---------|
| `companion/src/skills/skill-engine.ts` | Refactor to unified query interface; delegate knowledge queries to `KnowledgeBase`; remove `site_knowledge`/`domain_knowledge` special-casing |
| `companion/src/llm/adapter.ts` | Inject knowledge context via `KnowledgeBase.queryContext()` |
| `companion/src/message-router.ts` | Add handlers: `knowledge.query`, `knowledge.ingest`, `knowledge.sync` |
| `companion/src/server.ts` | Initialize `KnowledgeBase` in `initServices()` |
| `companion/src/config.ts` | Add `knowledge` config section |
| `companion/src/bridge/tool-definitions.ts` | Add `knowledge_search`, `knowledge_ingest`, `knowledge_discover` tools |
| `chrome-extension/src/sidepanel/App.tsx` | Add Knowledge Base panel UI |
| `chrome-extension/src/sidepanel/components/KnowledgePanel.tsx` | New: doc browser, search, sync controls |

### 2.3 Data Directory

```
~/.cmspark-agent/
├── config.json              # + knowledge section
├── skills/                  # prompt_template, tool_chain, sub_agent only
├── builtin-skills/
├── threads/
├── history.db
├── knowledge/               # NEW
│   ├── docs/global/         # global knowledge docs
│   ├── docs/sites/          # site-specific docs
│   ├── .git/                # version control
│   ├── vector.db            # sqlite-vec database
│   └── metadata.db          # doc registry
└── cache/                   # NEW: embedding cache, crawl cache
```

## 3. Estimated Development Effort

| Phase | Scope | Person-Days |
|-------|-------|-------------|
| P1: Core Storage & Ingestion | Vector DB, document store, chunking, local embedding, indexer | 5 |
| P2: Query Engine | Vector search, keyword search (FTS5), RRF fusion, context assembler | 4 |
| P3: Integration | SkillEngine refactor, adapter.ts, message-router, tool definitions | 3 |
| P4: UI Panel | Extension KnowledgePanel, search UI, doc browser, sync controls | 3 |
| P5: Knowledge Discovery | Site crawler, auto-extractor, scheduler | 4 |
| P6: Version Control & Collaboration | Git integration, diff engine, merge resolver | 3 |
| P7: Testing & Hardening | Unit tests, integration tests, performance tuning | 3 |
| **Total** | | **25 person-days** (~5 calendar weeks) |

## 4. Potential Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| sqlite-vec compatibility | High | Requires SQLite 3.41+; fallback to pure-JS HNSW or remote vector DB |
| Embedding model size (all-MiniLM ~80MB) | Medium | Support remote embedding API as primary with local as fallback |
| Crawler detection / rate limiting | Medium | Respect robots.txt, polite delays, configurable crawl depth |
| Git merge conflicts in markdown | Medium | Semantic diff + LLM-assisted merge; auto-backup before merge |
| Context window overflow | Medium | Token budget enforcement in ContextAssembler; relevance threshold filtering |
| Privacy / data leakage | High | All knowledge stays local by default; explicit opt-in for remote sync |
| Incremental update correctness | Medium | Content hash-based change detection; periodic full re-index as safety net |

## 5. Key Design Decisions

- **D1. Skill/Knowledge decoupling**: Skills = executable behavior; Knowledge = informational context. Prevents skill bloat.
- **D2. Hybrid search (vector + keyword)**: Vector captures semantic similarity; keyword captures exact matches. RRF provides best-of-both.
- **D3. Local-first embedding**: Privacy, offline capability. Remote API as optional upgrade.
- **D4. Git-based versioning**: Familiar to developers, branching for experiments, full audit trail.
- **D5. Site-scoped + global knowledge**: `sites/{hostname}/` for site-specific; `global/` for universal.
- **D6. Lazy loading with relevance threshold**: Query on-demand per turn, filter by relevance score, respect token budget.

## 6. Migration Path

Current `site_knowledge` and `domain_knowledge` skills with `entries` arrays will be automatically migrated on first boot to the new Knowledge Base subsystem.
