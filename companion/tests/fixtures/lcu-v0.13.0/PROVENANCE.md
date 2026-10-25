# LCU test producer provenance

Repository: https://github.com/amontlabs/lcu

Release: v0.13.0, commit `c38f4b6286ba74ebf053c2b3d1970e387556a559`. License: MIT, adjacent LICENSE.

`sources.ts` encodes complete unchanged UTF-8 public files, including their trailing newlines. Tests assert SHA-256 before extracting the actual `collect`, `assess`, `observe`, and `changedSinceInstall` producers into an inert VM with filesystem and metadata dependencies supplied by the test. It does not import or execute LCU runtime, setup, native, update, or diagnostic modules. Source-derived MCP fixtures retain the upstream catalog, initialization guide, and native elicitation payload.

| File | Bytes | SHA-256 |
|---|---:|---|
| `lcu/status.mjs` | 4296 | `78061262846d9526d585d95f92c90d1e1fca69c8620b8f66e276d1bf36dcced3` |
| `lcu/tested.mjs` | 6994 | `92fbe0709f10e4e792c9fff5b7cc853e0e538ef7a20e8ef7f01ff92bec34d7ec` |
| `adapters/test/mcp-fixture.mjs` | 9590 | `a7b45d7a25ee106f90b052121b6535140b942911c96e2ce5ce76dd5bced2b9a8` |
| `tested-versions.json` | 2681 | `9beb808040632948cb854b475cd3357b9287454aebdc297cbce72677e7da21c9` |
