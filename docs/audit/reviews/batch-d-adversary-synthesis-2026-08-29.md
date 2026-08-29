# 0.5.3 体检批 D — 四路合成 2026-08-29

> **GitHub:** [#249](https://github.com/nehcuh/cmspark/issues/249)  
> **状态:** 四路合成 PASS_WITH_CHANGES — **尚未** kimi+claude dual，**禁止实现**  
> **HEAD:** `origin/main` `10a6a322`

四路皆 PASS_WITH_CHANGES。D3 cookie 与 D2「整段复制 chat.abort」是最大冲突，已按下表折。

| 路 | verdict | 站住的 BLOCK | 推翻/降级 |
|----|---------|--------------|-----------|
| Security | PWC | D1 第二份 TM+get 写盘；D2 upload 无 owner；D3 argv token + Origin null + GET /api/thread 变更；D4 整串 slice；D5 确认不得扇出 | — |
| Product | PWC | D3 首屏必须 Cookie 不是 header-only；D5 禁止死按钮；D2 owner 过滤、无头 nextRun 丢弃；D1 内存 seed | — |
| Impl | PWC | 文件地图；EventSource 不能自定义 header；settings-web 不是 cookie 克隆目标；无 `chat.delta` | — |
| Skeptic | PWC | D2 只补 upload owner，禁 copy chat.abort drain；D4 只修 shrink 闭合；D5 thread 范围双写 | D1「空快照常砸盘」过重；D3 argv 在 A1 后不是 T3；禁 naive cookie CSRF |

**折法：** D1 仍做（get 不写盘 + 注入单例，廉价）。D2 不复制 chat.abort。D3 仍出 argv（产品句），Cookie=窗口、Header=测，POST 精确 Origin。D4 不改 suffix `x`。D5 进度扇出、确认单播。
