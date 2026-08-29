# 0.5.3 体检批 F — 四路合成 2026-08-29

> **GitHub:** [#253](https://github.com/nehcuh/cmspark/issues/253)  
> **状态:** 四路合成 PASS_WITH_CHANGES — **尚未** dual，**禁止实现**  
> **HEAD:** `origin/main` `4d41f92f`

四路皆 PASS_WITH_CHANGES。最大冲突：F2「忽略 panel」会杀掉唯一合法 `tab.navigated` 发送者；F1「空票换工具」是假威胁（HMAC 已绑 toolName）。

| 路 | verdict | 站住的 BLOCK | 推翻/降级 |
|----|---------|--------------|-----------|
| Security | PWC | F1 未知名空载荷；F2 tray 毒化 cache；F3 SW 发明 true；F4 双闸 /0；F5 callTool 带 __thread_id | F1 不是跨工具重放；F2 闸是 Origin 不是 surface |
| Product | PWC | F3 面板已带 true，Save 不停；F2 托盘无合法 tab.navigated；F1 throw 应在确认前 | bits&lt;8 同意；设置页镜像为诚实缺口 |
| Impl | PWC | F2 勿忽略 panel；闸在 lifecycle 不改 applyTabNavigated；F5 勿剥 outbound；测红名单几乎为空须新测 | 现有 HMAC 测不红 |
| Skeptic | PWC | F1 default 今日不可达但仍须 throw；F2 攻击「HUD 当前页」为假；F4 只 /0 是产品句；F5 禁 /^__/ 全剥 | 删跨工具空票文案；bits&lt;8 非必须；勿拉 privacy_ack |

**折法：** 五项都留。F1 产品句改成「新 L2 名忘写绑定就发不出票」。F2 只认 chrome-extension Origin，**panel 是合法发送者**。F4 DoD = 双闸拒 `/0`；bits&lt;8 保留（Security/Product/Impl）。F5 只剥已知内部键，actingTid 从原对象读；outbound 路径不动。
