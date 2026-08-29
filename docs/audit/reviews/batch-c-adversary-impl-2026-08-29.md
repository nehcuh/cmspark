# Batch C lane — impl

**LANE:** impl  
**VERDICT:** PASS_WITH_CHANGES  
**HEAD:** e36176a5 · #247 strawman

Strawman 缺文件地图；HMAC/denylist/URL 合同未锁。五项可一 PR 多 commit。

BLOCK (folded into spec):
- File map (dispatch / security-policy / l2-admission / catalog / tool-schemas / mcp handlers+transport / user-env loader helper / shell / powershell / spawn)
- C1: zod url stays optional; canonical = resolved string drop-hash keep-query no re-serialize; validateTokenFor; execute bound URL not re-resolve tabId
- C2: `isUnsafeLoaderEnvKey` not wholesale USER_ENV_DENYLIST; deny at validate + spawn
- C3: parsed argv + clustered shorts; parse-null keep raw deny
- C4: clone Darwin throw-unless-ALLOW; fix computer-uia-watch.test.ts
- C5: sort+unique JSON; lock `[]` vs missing; HARD_DENY stays; pack_id composition residual out of C

Tests that will go red named in spec §文件地图.
