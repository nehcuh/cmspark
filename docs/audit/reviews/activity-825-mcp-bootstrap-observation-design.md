# #825 / #476：复用 #773 的最小观测接入简报

问题：实际 Windows 首错停在 controller callback 与导航完成之间，原 20 秒内没有 MCP 业务请求。现有 phase 不能区分同步 API 未返回、失败 HRESULT 或启动耗时。当前根因 UNKNOWN，产品修复等待真实观测。

提议仅修改未分发测试生成/观察代码，不改 DesktopHost.cpp、产品、deadline、权限、业务断言或 cleanup，不增加 CI 入口或重新调用任何原 COM API。

1. `desktop-bootstrap-observation-fixture.mjs`：保留原 export 与旧 #480 生成输出；从现有同一实现增加 MCP 入口。复用原 declarations、record/flush formatter、30 站点表、250ms native 时钟、uint32 HRESULT/presence、每站点前 8 次及总 192 行上限。MCP 只包装存在的 WebView 站点 5–25、27–30；不植入 #480 bootstrap/checker/auth/attach 行为。
2. 适配仅在生成的 D476Acceptance 中：声明原观测成员、在原 ready 接受后绑定 host、增加 string emit 适配以产生原 `D480A_BOOT_...` 格式。既有 D476 receipt emit、form/controller 均保持原文。每一原 API 仅执行原来那一次。完整逆变换恢复真实 MCP source 的全部字节，LF/CRLF 都核。
3. `build-desktop-windows.mjs`：仅 MCP family 生成源码调用新入口；其它 family 的源码、编译 flags 与原 #480 输出不变。
4. 复用 `native-phase-observation.ts` 所在既有闭集观察 helper：抽出 #480 controller 已有的 BOOT ID 验证/去重逻辑，使 #480 与 MCP 共用。MCP 在原已认证 outgoing pong observer 里收取固定行，不把它算作业务成功或 UI ready。#480 解析输出保持原状。
5. `desktop-native-mcp-476.test.ts`：原 finally 的 `DESKTOP_476_PROGRESS` 增加同形状 `bootstrap773` 有限投影（clock、processInstanceAttributed=false、rows）；无新等待/重试/时限/成功判据。更新原清理契约测试的闭集字段，确保诊断失败仍不能替换 primary failure 或中断 cleanup。
6. 验证：旧 #773 source-derived controls；MCP 的真实 producer LF/CRLF 逐字节 inverse、原 WebView API 次数与操作数保持、其它 family/原 #773 输出比较；真实 recorder/formatter 生成的正例和错站点、ordinal、edge、bucket、HRESULT、presence、extra-key、unauth/错误响应、重复/超限反例；476 原 cleanup/receipt controls；相关完整 TypeScript 编译。

已有本轮调查与 CPU 依据：`/tmp/cmspark-825-mcp-startup-root-cause-investigation.md`、`/tmp/cmspark-825-mcp-startup-diagnosis.log`。新观察仍可能缺失；缺失不能被解释为某个 API 故障。首个原生失败结果/清理和完整业务断言继续决定 pass/fail。

验收：独立非作者 B 复核实际差量与机器结果，再交 GLM 源码复审；批准后 root 才提交并执行一次有目的的 instrumented CI。当前不 stage/commit/push。

## 当前实现与机器证据

实现已在共享工作区完成，未 stage/commit/push。产品 `DesktopHost.cpp` 及原生权限/业务/20 秒/cleanup 未修改。原有 `companion/src/host-use/darwin/host-integrity.ts` 脏改不是本批。

- 共享 helper 新增 `desktopMcpBootstrapObservationFixture773`，原入口调用同一内部实现。MCP 仅新增 D476 的观测声明、ready 后 host 绑定及 string emit 重载，保留原 wchar_t receipt emit。该适配仍使用原 `D480A_BOOT_...` 协议，没有复制 recorder/formatter。
- 既有 Windows builder 只为 `family === 'mcp'` 接入新入口，local 仍走原确认观测，其余 family 返回原样。
- 原 #480 controller 的 inline BOOT parser 移至既有 `native-phase-observation.ts`，原控制器使用共享函数；现有 pong observer 通过可选 BOOT 容器承载 MCP 行。没有新增传输、listener 等待或业务成功回执。
- #476 原 finally 增加 `bootstrap773` 有限投影。对应 AST 实际 finally 消费者包含新字段，已核诊断正常/抛错 × LF/CRLF 的原 primary failure、环境恢复与全套 cleanup 顺序。
- `docs/windows-development.md` 只补充此观测范围和 UNKNOWN/不跨钟域语义。

命令在 companion 目录、Node 22.23.4 下运行：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
./node_modules/.bin/tsc -p tsconfig.test.json
node scripts/run-tests.mjs .test-dist/tests/desktop-acceptance-diagnostics.test.js .test-dist/tests/desktop-native-phases-480.test.js .test-dist/tests/desktop-native-receipts-476.test.js
node --test scripts/tests/desktop-bootstrap-observation-773.test.mjs scripts/tests/desktop-build-windows-480.test.mjs scripts/tests/desktop-local-native-476.test.mjs
```

完整 TypeScript 编译 exit 0；实际消费者 CPU **19 pass / 0 fail / 0 skip**；源生成/构建契约 **223 pass / 0 fail / 0 skip**。日志 `/tmp/cmspark-825-mcp-bootstrap-types.log`、`/tmp/cmspark-825-mcp-bootstrap-cpu.log`、`/tmp/cmspark-825-mcp-bootstrap-scripts.log`。

核心验证不是只 import：新实际 MCP recorder、共享 formatter、string 与 wchar_t 两层实际 emit 函数体经现有解释器执行，输出走真实 HMAC channel 与共享 pong/BOOT parser。涵盖 unauth、错误 type/extra keys、闭集范围、重复、192 cap、旧 8 phase 满额仍能收 BOOT、原 send throw、诊断发送/格式化失败不重试及不改变调用者。旧 #480 的 HMAC/recorder 控制继续通过。

额外把本批改动前 helper 保存在 `/tmp/cmspark-825-bootstrap773-before.mjs`，使用真实 #480 fixture producer 做完整输出对象差分，source/inverse/sites 在 LF/CRLF 都完全相同。日志 `/tmp/cmspark-825-mcp-bootstrap-preservation.log`；source SHA256：LF `24a4d0dc1beb2c2cadc9494dc4888c39b416e60bc56949055b66fe1fa3da6609`，CRLF `a0d8d935fb639683cc96da93bb4ee88f68a31aefdaa40cb92d1c8b11df8b722e`。新 MCP 真实 producer 的逐字节 LF/CRLF inverse、所有原 API 只被包装一次及其它 family 的真实 builder selector 均有仓库测试。

本机未运行 Windows C++ 编译/原生测试，未获得实际新 BOOT 行。本实现只补齐下一次定位证据，不声称修复历史超时。当前状态：MACHINE PASS，待非作者 B 与 GLM 复审。
