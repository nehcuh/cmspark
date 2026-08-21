# Lane B — Windows packaging correctness / locale

**Range**: `e8900bc`..`be52585`  
**HEAD**: `be52585`  
**Patch SHA256** match `[executed]`  
**Worktree**: `subagent-01a021d7-0f4f-7473-9747-b53ca89703fa`

## Claim check

| Claim | Result |
|-------|--------|
| NSIS `Bin/` search | Valid superset. Commit overclaims “winget only puts makensis in Bin” — official setup copies **root and Bin**. Code still correct. Unpinned by tests. |
| installer.nsi ASCII | Product fix real (pre-range 2× U+2014 comments). Gate `grep -qP` fail-open on Darwin. |
| 7z fallback cwd | After `cd dist-package`; quoted; zip layout matches `zip -rq` (`7zz` replica). |
| cwd-relative require | Correct Git Bash fix; empty COMP_VER still FAIL. |

`test-package-gates.sh` **95/0** with `grep: invalid option -- P` noise `[executed]`.

## P2 nits

1. ASCII gate fail-open without GNU `grep -P`
2. `find_makensis` Bin entries untested
3. 7-Zip pin is string not behavior
4. Node zip **extract** still PATH-only
5. `[ -x ]` vs `[ -e ]` for `.exe` under Program Files
6. `/c/` + `C:/` duplicates on Git Bash

VERDICT: APPROVE_WITH_NITS
