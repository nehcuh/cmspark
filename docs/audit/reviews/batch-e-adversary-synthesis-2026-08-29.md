# 0.5.3 体检批 E — 四路合成 2026-08-29

> **GitHub:** [#251](https://github.com/nehcuh/cmspark/issues/251)  
> **状态:** 四路合成 PASS_WITH_CHANGES — **尚未** kimi+claude dual，**禁止实现**  
> **基线 strawman:** `docs/superpowers/specs/2026-08-29-post-diagnosis-batch-e.md`  
> **HEAD:** `origin/main` `6e17d2df`

```text
Surface:      Operate WS handshake ; Capture overlay HTTP 不动
L2-classes:   n/a
Compose:      n/a
Autonomy:     n/a
Trust:        chrome-extension Origin never summoner ; tray Origin omit ≠ ungated tray
Channel:      community
Blast:        T2 (handshake mis-label) ; T1 (protocol lockstep / esbuild)
```

**产品句（修订）：** 扩展不能靠握手字段自称召唤器去抢 overlay 租约。托盘进程必须显式说自己是 tray 还是 summoner。HMAC 仍是 WS 门；本票不是未授权 RCE。CI 打包不再靠 tsx 偷来的 esbuild。

**实现是否允许开工：否。** 须 kimi+claude dual 都 APPROVE*。

## 1. 四路表

| 路 | verdict | 抽查后站得住的 BLOCK | 与 SoT 冲突需折 |
|----|---------|----------------------|----------------|
| Security | PWC | 引入 `panel` 却不改 `stampCmsparkSurface`/lease `if` = overlay 租约洞；扩展自称 summoner = 租约盗窃；tray Origin omit 逃 SUMMONER_ALLOW | HMAC 仍是真门；omit-deny 不是 unauth RCE |
| Product | PWC | omit-deny **只**打 tray Origin；扩展继续省略 surface；fan-out 保持 `!== "summoner"`；lease 必须认识 panel | 不把 overlay HTTP 当 WS；不挂未签名 DMG |
| Impl | PWC | 类型宇宙是 `tray\|summoner`；`__cmspark_surface` 保持二元；validate 不得把 `panel` 放上线；esbuild 是 tsx hoist；handshake 复本无 Origin | 不拆 message-router；可改 union |
| Skeptic | PWC | Origin 盖不住 tray vs summoner；`panel` 第三身份会 desync；E2 在 v=1 演戏；E4/E5/DMG 删除 | 只留：扩展 Origin 永不 stamp summoner + 声明 esbuild |

**抽查（[inspected]）：**

- `lifecycle.ts:1023-1024` omit/`non-summoner` → tray。
- `composer-lease.ts:118` stamp 二元 collapse；`:194` lease 只在 `tray\|summoner` 检查 holder。
- `validate.ts:782` 客户端 surface 仅 omit/`tray`/`summoner`；`"panel"` 非法。
- `ws-client.ts:161` 扩展不发 surface；`companion-client.ts:612` 托盘恒发。
- `isAllowedWsOrigin` 仅 chrome-extension + `cmspark-tray://local`；local 可伪造 Origin，HMAC 才是门。
- `confirm-fanout.ts:25` / D5 `!== "summoner"`；`pickAuthenticatedClientWs` 看 Origin 不是 surface。
- `run-esbuild-bundle.mjs` 解析 `companion/node_modules/esbuild`；package.json 无直接依赖。
- `release.yml` 上传 zip + NSIS；DMG 仅 `make package-macos` 本机。

## 2. 被推翻 / 降级

- 「纯 Origin 盖章二分 tray/summoner」→ **假**（共用 `cmspark-tray://local`）。折成 **Origin 类 + 显式 surface**。
- omit-deny = 关未授权 RCE → **假**。HMAC 持有者仍可 `surface:"tray"`。Blast **T2**。
- E2 fail-closed omit / bump → **删**。omit=MIN 已测；consume-ok 保留为诚实（缺字段当 MIN）。
- E3 Release DMG / 签名 / engines 当主 DoD → **DMG 删**；engines `>=22` 廉价保留；**esbuild 直接依赖留下**。
- E4 当实现项 → **nit/盘点**。privacy_ack 伪造是 overlay-privacy-ack，**本票不修**。
- E5 当工作项 → **删**。NEVER 拆 message-router 留下。
- Skeptic「扩展自称 summoner 只是自残」→ **部分假**：`SUMMONER_ALLOW` 含 `composer.lease.claim`，扩展 Origin + summoner = overlay 租约盗窃。**保留 terminate**。

## 3. 折法（进 spec）

1. Handshake `wsAuth.surface` 三元：`panel | tray | summoner`。
2. `__cmspark_surface` **保持二元** `summoner | tray`（panel 握手 collapse 成 tray stamp = 现有 panel holder）。Fan-out / confirm 继续 `!== "summoner"`。`=== "tray"` 只用于 HUD 进程消息（`OVERLAY_SHELL_`）。
3. `chrome-extension://`：省略 → stamp `panel`；自称 `tray` → coerce `panel`；自称 `summoner` → **terminate**。
4. `cmspark-tray://local`：必须显式 `tray|summoner`；省略/`panel`/其它 → **terminate**。
5. 客户端 **不得**发 `surface:"panel"`（validate 继续拒）。扩展继续省略。
6. 不扩 `isAllowedWsOrigin`。不改 `SUMMONER_ALLOW`。不拆 `message-router.ts`（允许改 union + coerce 注释）。
7. E2：三处字面量锁步测；越界已拒；客户端读 auth.ok，缺字段 = MIN。不 bump。
8. E3：companion **直接** pin esbuild；engines `>=22`；**不**挂 Release DMG。
9. E4/E5：不实现。
