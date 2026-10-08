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

## 尚未验证的边界

Mac 被锁定时 computer-use 返回浏览器列表为空，内置浏览器不可用。
因此浏览器→真实 PTY 尚未通过。Windows 真机、ConPTY/SEA/taskkill/Chrome
MV3 多任务与重连仍待实机验收；生产 agent 未指定/授权，默认关闭。
没有合并放行或全 companion 仓库测试通过的声明。
