# 0.5.3 体检批 F — P2 完整性（#253）

> **GitHub:** [#253](https://github.com/nehcuh/cmspark/issues/253)  
> **状态:** 四路已折 · dual Claude **AWN** + Kimi **AWN** · nits 已折 · 允许 TDD  
> **对抗合成:** [batch-f-adversary-synthesis-2026-08-29.md](../../audit/reviews/batch-f-adversary-synthesis-2026-08-29.md)  
> **前序:** A–E 已合 `4d41f92f`  
> **HEAD 基线:** `origin/main` `4d41f92f`

```text
Surface:      Operate L2 / extension SW / MCP outbound args
L2-classes:   existing (no new dialect)
Compose:      n/a
Autonomy:     n/a
Trust:        unknown L2 cannot issue empty bind ; tab.navigated Origin ; user_gesture honest ; netsec not /0
Channel:      community
Blast:        T3 (HMAC footgun / netsec) ; T2 (tab / gesture / MCP strip)
```

**产品句：** 新的危险工具名如果忘了写绑定载荷，就不能发出批准票。evaluate 信任的当前页只能由扩展报告。保存知识必须是你点的。网段白名单不能写成全网。MCP 服务器看不到我们内部的线程号。

**实现是否允许开工：是。** dual both AWN。F1 确认前+确认后都要拦 unknown；其余 dual nits 不挡。

## 1. 折进路径的针

1. **F1-THROW：** `bindingPayloadFor` `default` **throw** 并点名 `toolName`。不是跨工具重放（HMAC 已绑 toolName）。是「闸名单加了名、switch 忘了 case」的脚枪。已列名工具空字段（`evaluate` 无 code）仍走 **case** 返回 `""`，本票不改。
2. **F1-NO-NEW-DIALECT：** 不把新工具加进 `L2_GATE_TOOLS`。`host_app`/`host_cli`/`host_computer` 已有 case，不要为对齐去改数组。issue 在 **确认前** 调 binding（未知名不要先弹确认）；闸内收成 `{success:false,error}` 优于裸 throw 打爆整轮。
3. **F2-ORIGIN-NOT-PANEL-DENY：** `tab.navigated` 仅当 `wsAuth.origin` 匹配 `chrome-extension://…` 才 `applyTabNavigated`。**panel 是扩展握手 surface，是唯一合法发送者，禁止忽略 panel。** tray Origin 静默 `return`（不 500）。闸写在 `lifecycle.ts`，**不改** `applyTabNavigated` 签名。`isAllowedWsOrigin` 集合不动。handler 约 `:1329`（不是 1312 HUD spike）。
4. **F3-FORWARD：** SW 三处 `user_gesture: message.user_gesture === true`。缺省 / `"true"` / `1` → false。面板 `knowledge-save.ts` 已带 true，Save 不停。不要 `...message` 无过滤。
5. **F4-BOTH-GATES：** `isValidNetsecAllowlistEntry` **与** `parseCidrV4` 拒 `bits < 8`（含 `/0`）。`10.0.0.0/8` 仍 true。`*` 已拒。设置页镜像 / 失败文案是 nit，不挡 DoD。
6. **F5-KNOWN-KEYS：** 调 inbound `executeMcpTool` → `callTool` 前，对 **副本** 删除 `__thread_id`、`_thread_id`、`/^__cmspark_/`。actingTid 从 **原** params 读。禁止 `/^__/` 全剥（MCP 工具可能声明 `__meta`）。**不要**剥 outbound companion 执行器路径。
7. **NEVER：** SUMMONER_ALLOW、overlay Allow/Deny、#228、privacy_ack、HUD 导入、mcp-02 grant_id、拆 message-router。

## 2. DoD

| ID | 机核 |
|----|------|
| **F1** | `issueTokenFor("brand_new_l2", {})` throw 且消息含名字；`evaluate` 仍绑 `code` |
| **F2** | lifecycle 在 `applyTabNavigated` 前有 chrome-extension Origin 闸；tray Origin 不写 cache |
| **F3** | `index.ts` 三处无字面 `user_gesture: true`；缺字段 → false |
| **F4** | `isValidNetsecAllowlistEntry("0.0.0.0/0")===false`；`isTargetAllowed("1.2.3.4",["0.0.0.0/0"])===false`；`10.0.0.0/8` true |
| **F5** | inbound `callTool` args 无 `__thread_id`；actingTid 仍从原 params 读；outbound-mcp 测仍绿 |

## 3. 文件地图

| 文件 | ID |
|------|----|
| `companion/src/security-policy.ts` | F1 |
| `companion/src/tool/l2-admission.ts` | F1 确认前 binding（try/收 error） |
| `companion/src/ws/lifecycle.ts` | F2 |
| `chrome-extension/src/background/index.ts` | F3 |
| `companion/src/capability/modules.ts` + `netsec/scope.ts` | F4 |
| `companion/src/mcp/dispatch.ts` | F5 |
| `companion/tests/security/security-policy.test.ts` | F1 |
| `companion/tests/netsec-scope.test.ts` | F4 |
| 新测 | F2 Origin；F3 SW；F5 strip 副本 |

**不改：** `applyTabNavigated` 签名；`summoner-acl.ts` ALLOW；`knowledge-save.ts` 面板 true；outbound-mcp-executor 的 `__thread_id`。

## 4. NEVER / KEEP

**NEVER：** `SUMMONER_ALLOW` / overlay Allow/Deny / #228 / #229 HUD 导入 / overlay-privacy-ack / 拆 `message-router.ts` / live config / 宣称 Capture/CU/F-S-10 闭合。

**KEEP：** HMAC 配对；#247 URL bind；#252 Origin 类 surface；Confirm origin-bound。
