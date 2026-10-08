# 分阶段发布与接手验证

## 发布范围

用户授权将本次已验证阶段推送到 `nehcuh/cmspark` 的
`codex/windows-artifact-review`，不 force push、不合并、不部署。
发布副本从远程 main `3d368a4ee9d57569dd7f27085223b24fb1e51000` 建立，
只移植首次实现 `78e0077d` 相对其父提交的补丁。
`c098f404` 用户修改快照和 `288ed02c` 整合提交不在发布分支的历史里；
原 checkout 与旧任务副本未改写。补丁应用无冲突，干净基线中已无重复
worker 白名单定义，因此该处历史撤销为空。没有配置、密钥、运行数据或
构建二进制进入提交；对 staged diff 的私钥/GitHub/AWS/OpenAI key
常见格式检查无命中，该检查不是完整秘密审计。

## 第一阶段：重新机核

平台为 macOS，Node 22.23.2。独立 lockfile 依赖，不使用原 checkout
共享 node_modules；扩展实际 KaTeX 0.18.2。

| 检查 | 实际结果 |
| --- | --- |
| companion / extension `tsc -p tsconfig.test.json` | 均 exit 0 |
| companion 相关回归 | 127 tests，124 pass，0 fail，3 Windows-only skip |
| extension 连接与 KaTeX 定向回归 | 6/6 pass |
| extension 全量已编译测试 | 1511/1511 pass |
| companion production `tsc` | exit 0 |
| companion `run-esbuild-bundle.mjs` | exit 0，19.1 MiB bundle；并非 Windows exe 实机 |
| extension production `tsc --noEmit` | exit 0 |
| extension `plasmo build`（chrome-mv3） | exit 0，Finished in 9795ms |
| `git diff --check` / staged diff check | exit 0 |

companion 定向套件：local-code-review、local-download、acp-peer-isolation、
ws-peer-error、acp-jsonrpc-timeline、acp-win-spawn、acp-agent-env、code-review、
l2-admission-pure、security-confirmation-origin/broadcast、
l2-summoner-confirm-origin。真实合成 ACP child、worker、坏 WS peer 和已配对
健康 peer 通过；下载 transport 仍为 mock，无生产 agent 或私有代码外发。
跳过项包括 Windows BOM/真实 cmd wrapper/已发现 CLI 的启动。

依赖首次下载停滞；未完整下载时提前运行的 companion 回归有 4 个失败，
均为缺 node-notifier，bundle 同样未完成。下载恢复后上述回归与 bundle
重新通过。扩展 sandbox 内 Plasmo 无诊断 exit 1；宿主权限下重跑通过。
这些失败日志保留，不能将初次尝试写为成功。

接手证据保存在工作目录同级 `evidence/`：stage1-companion-tests-retry.log、
stage1-extension-all.log、stage1-extension-tests.log、两个测试类型编译日志、
stage1-extension-production-typecheck.log、stage1-companion-bundle-retry.log。
历史证据位于旧任务同级 evidence，未覆盖。

## 第二阶段：Windows 终端与恢复

在第一阶段远程提交 `164f36d53c9bb73b6daae9007dff0277b72620f2` 上移植
原副本未提交的第二阶段补丁，未重新实现已有功能。最后的重复附着修复
重新经过测试：同一已认证 owner 的重复 attach 成功，另一 peer 即使持有
token 也不能抢占已附着会话；旧 owner 不能输入或关闭新 owner 的进程。

| 检查 | 实际结果 |
| --- | --- |
| companion 最终测试类型编译 | exit 0 |
| PTY / ACP embed / 本地终端 / gates / review / WS / Windows helper 定向套件 | 220 tests，216 pass，0 fail，4 Windows-only skip |
| extension 全量 `npm test`（含 UI hygiene） | 1515/1515 pass |
| extension `npm run build` | exit 0，chrome-mv3，Finished in 8079ms |
| companion `npm run build:exe` | exit 0；Mac 类型编译、Windows脚本 staging、JS bundle，非 Windows SEA 实机 |
| 认证 loopback WS → 真实 Mac native PTY | exit 0，全部四组断言通过 |

真实 PTY 冒烟使用临时数据目录与 `/bin/sh -i`，无 profile、LLM 或生产 agent。
L2 确认前无 PID；批准后验证中文/emoji 输入输出、`stty size` 为 27×83、
断线重连 PID 不变、未 ACK 的真实输出按原 seq/b64 重放、重复 attach、
恢复后输入，以及关闭后 OS 返回 PID 不存在。服务及临时目录在测试结束时
显式清理。它使用真实 WebSocket/native PTY 和生产终端 handler，
没有使用真实浏览器、MV3 worker 或生产完整路由；不能代替浏览器验收。

接手过程中修复了验证脚手架遗漏：浏览器 TSX 夹具被 Node 测试 tsconfig
纳入导致类型编译失败，已移到 `scripts/browser-fixtures`；旧 macOS-only
门控和旧 L2 shell 文案断言已更新，未放宽配置/线程/L2 验证。
初轮扩展 2 个旧断言失败，companion 4 个旧断言失败，均在更新后重新通过。
完整日志：stage2-companion-typecheck-complete.log、
stage2-companion-tests-complete.log、stage2-extension-all-final.log、
stage2-extension-build-final.log、stage2-companion-build-exe.log、
stage2-real-mac-pty.log。依赖安装最终均 exit 0（companion 第二次安装约 7 分钟）。

## 启动与复验

在新目录 clone 此远程分支，保留原脏 checkout。Node 22+；各自执行
`cd companion && npm ci && npm run build:exe`，
`cd chrome-extension && npm ci && npm run build`。
设置独立 `CMSPARK_DATA_DIR` 后在 companion 目录运行 `npm start`，使用独立
Chrome/Edge profile（至少116），加载 `chrome-extension/build/chrome-mv3-prod`
并手动配对该测试实例。不要把测试配对密钥提交或写入报告。

真实产品入口经源码与门控测试核对：设置 → 本机与工具 →
「内嵌终端（实验 · 默认关 · macOS / Windows）」→ 开启 →
「打开内嵌终端」→ 返回侧栏批准 L2。它可启动默认交互 shell；配置的 Mode C
agent 另需已有编程接力和 thread-bound embed intent。本次未启用生产 agent。

Mac 上在仓库根目录执行 `node companion/scripts/terminal-protocol-smoke.cjs`
可复验已通过的协议冒烟；执行 `node companion/scripts/terminal-browser-smoke.cjs`
启动浏览器夹具，打开其输出的随机 loopback URL，点 Open controlled terminal →
Approve fixture L2 → 输入 → Resize → Drop socket → 关闭。该夹具连接生产
TerminalApp/xterm/WSClient/relay，但 chrome runtime/确认 UI 是测试替身；
即使通过，也仍需上述真实扩展 UI / Windows 实机检查。结束时 Ctrl-C 显式清理。

## 尚未验证的边界

Mac 被锁定时 computer-use 返回浏览器列表为空，内置浏览器不可用。
因此浏览器→真实 PTY 尚未通过（仅协议冒烟通过）。Windows 真机、ConPTY/SEA/taskkill/Chrome
MV3 多任务与重连仍待实机验收；生产 agent 未指定/授权，默认关闭。
没有合并放行或全 companion 仓库测试通过的声明。
