# Batch C lane — product

**LANE:** product  
**VERDICT:** PASS_WITH_CHANGES  
**HEAD:** e36176a5 · #247 strawman

产品句「确认台看到的，就是实际跑的」成立。C1 fail-closed **不**过苛；C4 双 opt-in **不**打断本机 Windows `npm run dev`。

BLOCK (folded into spec):
1. C2-HONEST-KEYS — 键名或显式 `(none)`
2. C2-NO-VALUES — 确认台无明文 env
3. C2-DENY-NOT-STRIP — loader 键拒绝整次变更
4. C2-DENYLIST-SCOPE — 不要整表 USER_ENV_DENYLIST；保留 PATH + 密钥
5. C1-TABID-RECOVERY — 无 url 且无 tabId 才失败
6. C1-CATALOG-TABID — schema 暴露 tabId
7. C1-EXACT-URL-CONTRACT — 废除 fragment 文案；URL = 解析后的那条（drop hash keep query）
8. C1-PREVIEW-URL — L2 预览含 canonical URL

C4 产品 PASS，无 BLOCK。日常 Windows 开发不碰 WIN_SCRIPTS；`computer-uia-watch.test.ts` 须加 ALLOW=1。
