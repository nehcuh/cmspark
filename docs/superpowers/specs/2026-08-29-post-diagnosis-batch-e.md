# 0.5.3 体检批 E — P2 handshake / esbuild（#251）

> **GitHub:** [#251](https://github.com/nehcuh/cmspark/issues/251)  
> **状态:** 四路已折 · dual Claude **AWN** + Kimi **AWN** · nits 已折 · 允许 TDD  
> **对抗合成:** [batch-e-adversary-synthesis-2026-08-29.md](../../audit/reviews/batch-e-adversary-synthesis-2026-08-29.md)  
> **前序:** #245/#246 A+B、#247/#248 C、#249/#250 D 已合 `6e17d2df`  
> **HEAD 基线:** `origin/main` `6e17d2df`

```text
Surface:      Operate WS handshake ; Capture overlay HTTP 不动
L2-classes:   n/a
Compose:      n/a
Autonomy:     n/a
Trust:        chrome-extension Origin never summoner ; tray Origin omit deny
Channel:      community
Blast:        T2 (handshake mis-label) ; T1 (protocol lockstep / esbuild)
```

**产品句：** 扩展不能靠握手字段自称召唤器去抢 overlay 租约。托盘进程必须显式说自己是 tray 还是 summoner。HMAC 仍是 WS 门。打包不再靠 tsx 偷来的 esbuild。

**实现是否允许开工：是。** dual both AWN；下列 dual nits 已折。

## 1. 四路表

见合成文档。overall = PASS_WITH_CHANGES。

## 2. 必须折进路径的针（folded pins）

1. **E1-ORIGIN-CLASS：** `chrome-extension://[A-Za-z0-9_-]+` → handshake `panel`。`cmspark-tray://local` → 仅显式 `"tray"` | `"summoner"`。其它 Origin 仍 `isAllowedWsOrigin` 拒。**禁止**加 overlay HTTP / loopback。
2. **E1-NO-SUMMONER-FROM-EXTENSION：** 扩展 Origin + 自称 `summoner` → **terminate**（verifyProof 成功之后，不是 validator linger）。扩展 Origin + 自称 `tray` → **coerce `panel`**（不砖 reconnect）。扩展 **省略** surface → stamp `panel`。
3. **E1-OMIT-DENY-TRAY：** tray Origin **省略**（schema 合法）→ lifecycle **terminate**。claimed `"panel"` / 非法值仍先被 `validate.ts` 拒（连接未认证，可等 timer；**不要**为了对齐 terminate 去改 validator 成功路径）。生产 `CompanionClient` 已发 `surface: this.options.surface ?? "tray"`。
4. **E1-BINARY-STAMP：** `wsAuth.surface` 三元 `panel | tray | summoner`。`__cmspark_surface` **保持** `summoner | tray`（`stampCmsparkSurface`：非 summoner → `tray`）。`incomingHolderFromSurface` 已把非 summoner 映射成 lease holder `"panel"`。**不要**把 `"panel"` 放上握手 wire（`validate.ts` 继续拒 claimed `"panel"`）。
5. **E1-FANOUT-PREDICATES：** 确认/聊天镜像保持 `surface !== "summoner"`（含 `panel`）。`pickAuthenticatedClientWs` / `waitForExtensionPeer` 仍看 **chrome-extension Origin**。`OVERLAY_SHELL_` 中继保持 `auth.surface === "tray"`（真 HUD）。STT **按 Origin 键**（扩展 Origin 总是允许；tray Origin 仅 `summoner`）——禁止改成只看 handshake surface。
6. **E1-LOGS：** 扩展+`summoner` terminate 与扩展+`tray` coerce 打不同日志，方便认错扩展。
7. **E1-TYPES：** `wsAuth.surface` 用 `"panel" | "tray" | "summoner"` 联合，不要 `string`。
8. **E1-FILEMAP：** 必碰 `lifecycle.ts`、`validate.ts`（claimed 枚举不变）、`composer-lease.ts` 仅当 stamp 政策被打破时（默认 stamp 二元则 lease `if` 不用为 panel 放宽）。`message-router.ts` **只许** session union 加 `"panel"`（若 `wsAuth.surface` 传入 handleMessage）；**禁止拆文件**。
9. **E2-LOCKSTEP：** `PROTOCOL_VERSION` 仍为 1。测：三处字面量彼此相等 **且** 等于 `PROTOCOL_VERSION`（读文件，**不要** extension import companion）。越界 `auth.failed` + terminate 已有。omit version = MIN。
10. **E2-CONSUME-OK：** 客户端读 `auth.ok.protocol_version` / `negotiated_protocol_version`；与本地常量不等则 close。**缺字段 = 当 MIN**。不 bump。PR 文案不要把这写成活闸（MAX=1 时 mismatch 不会开火）。
11. **E3-ESBUILD：** `companion/package.json` **直接** `devDependency` pin（与 lock 的 `0.28.1` 对齐）。保持 `run-esbuild-bundle.mjs` 路径 spawn。禁止 `npx esbuild`。tsx hoist 不算 vendored。
12. **E3-ENGINES：** root + companion `engines.node` = `>=22`（允许 nvm 24）。CONTRIBUTING/TESTING 一句跟上。**不**bump `@types/node`。**不**挂 GitHub Release DMG；不签名/公证。
13. **E4/E5：** 本票不实现测试簇翻案、不拆 router、不做 ConfirmSink。privacy_ack HTTP 伪造记 overlay-privacy-ack，**不在 #251**。

## 3. 三项 DoD（机核）

| ID | DoD |
|----|-----|
| **E1** | Origin chrome-extension + `surface:"summoner"` → 连接关，不得 stamp summoner、不得 overlay lease。扩展 + `surface:"tray"` → coerce `panel`，stamp 二元 `tray`，`holder:"overlay"` 仍 `LEASE_HOLDER_SURFACE_MISMATCH`。tray Origin 无 surface → terminate。tray+`tray` / tray+`summoner` / 扩展省略 → 绿。`isAllowedWsOrigin("http://127.0.0.1") === false`。 |
| **E2** | `protocol_version: 99` → `auth.failed`。三处字面量 === `PROTOCOL_VERSION`。 |
| **E3** | `companion/package.json` 直接依赖能解析 esbuild；engines 主版本与 CI `node-version: '22'` 一致。 |

## 4. 文件地图

| 文件 | ID | 做什么 |
|------|----|--------|
| `companion/src/ws/lifecycle.ts` | E1 | `surfaceFromOrigin` 在 verifyProof 后盖章；mismatch terminate |
| `companion/src/ws/validate.ts` | E1 | claimed 仍 omit/`tray`/`summoner`；拒 `"panel"` |
| `companion/src/tray/companion-client.ts` | E1, E2 | 已发 surface；读 auth.ok（缺字段=MIN） |
| `chrome-extension/src/background/ws-client.ts` | E1, E2 | **继续省略** surface；读 auth.ok |
| `companion/src/protocol.ts` | E2 | 常量不动 |
| `companion/src/message-router.ts` | E1 | 仅 union `"panel"`（若 session.surface 传入）；**不拆** |
| `companion/package.json` + lock | E3 | esbuild pin + engines |
| 测 | E1–E3 | Origin×surface 矩阵（不要只改无 Origin 的 replica）；lockstep 读文件；protocol 99 |

**不改：** `summoner-acl.ts` ALLOW；`isAllowedWsOrigin` 集合；overlay HTML；`stampCmsparkSurface` 二元（除非 dual 改选）。

## 5. NEVER / KEEP

**NEVER：** `SUMMONER_ALLOW` / overlay Allow/Deny / #228；拆 `message-router.ts`；overlay HTTP 进 WS Origin；代码签名；live config；宣称 Capture/CU/F-S-10 闭合；protocol bump；Release DMG。

**KEEP：** HMAC 配对；#245 L0；#247 HMAC；#249 cookie first-paint；Confirm origin-bound；D5 `!== "summoner"`。

## 6. 测试红名单（更新，不要保 omit→tray）

- `summoner-acl.test.ts`：omit 在 **schema** 仍 valid；claimed `"panel"` 仍拒。
- `composer-lease.test.ts`：stamp 二元仍 `tray`（panel 握手不进 stamp）。
- `l2-summoner-confirm-origin.test.ts`：fixture 可改 `panel` **或** 保持 tray 只要 `shouldReceiveConfirmRequest` 仍 `!== "summoner"`。
- `companion-client-auth.test.ts`：mock `auth.ok` 缺 protocol 字段 → 当 MIN，不 close。
- **新测** 必须带 Origin 头；`ws-auth-handshake.test.ts` replica 无 Origin，不能单独当 E1 DoD。
