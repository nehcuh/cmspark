Implement L1 docs honesty for CMspark 0.6.7. READ-WRITE. Worktree: C:\Users\HuChen\Projects\cmspark

You may ONLY edit these files:
- README.md
- PRODUCT.md
- CLAUDE.md
- docs/GOAL.md
- docs/README.md
- docs/architecture.md
- docs/summoner-user-guide.md
- docs/meeting-and-dictation-user-guide.md
- docs/computer-use-user-guide.md
- docs/host-and-apps.md
- companion/README.txt

Do NOT edit package.json, installer, source TS (except README.txt), CHANGELOG.md, audit reviews, or memory/.

Required content (cite by meaning, not cargo-cult):

1. Every living “当前阶段 / Version lock / 产品” banner that says 0.6.0 or 0.5.x → **0.6.7**. Do not rewrite historical CHANGELOG sections (you are not editing CHANGELOG).
2. Capture / summoner: default size is **1040×760** (`OVERLAY_WINDOW_SIZE` in `companion/src/summoner/shell-open.ts`). **360×420 is compact toggle**, not default. Fix README table, PRODUCT #241 line, summoner guide, CLAUDE.md.
3. README knowledge 「三种注入模式」 (~364–367): DELETE checkbox ∪ hostname / 「全选：所有知识文档全部注入」. Replace with truth: default smart-match is TF-IDF top-k (`KNOWLEDGE_DOC_TOPK_AUTO=5`, `ALL=8`) + `KNOWLEDGE_INJECT_BUDGET_CHARS=8000` + score floor 0.10. Manual checkboxes still apply. Site hostname match is a **candidate filter**, not “inject all site docs”.
4. PRODUCT remaining work: keep **#230 freeze** and **#228 do not expand outbound**. REMOVE #258–#260 as remaining (Hex PTT / Windows SAPI / embedding exist; embedding stays experimental).
5. GOAL.md G19: remove 「非目标：交互式 PTY」. Note #432 Darwin-only embedded PTY, default off, Windows unsupported.
6. README 已交付表: add rows or fix underclaim for knowledge graph (#427), embedded terminal (#432 Darwin), search_threads/search_knowledge (#439). CU locate remains experimental; do not claim #363 passed.
7. meeting-and-dictation-user-guide.md: 「设置 → 听写」 → 「设置 → 输入与语音」. Version banner 0.6.7. Keep embedding experimental.
8. computer-use / host-and-apps version banners 0.6.7.
9. companion/README.txt: if it still prefers cmspark-agent.exe SEA as primary, official path is node.exe + cmspark-agent.js / NSIS.

Do not invent features. Keep Issue-first / #230 freeze language. After edits, grep your files for `0.6.0`, `360×420`, `全部注入`, `设置 → 听写` and fix remaining living claims.

When done, print a file list and VERDICT: DONE
