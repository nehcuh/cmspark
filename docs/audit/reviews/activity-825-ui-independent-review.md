# #825 聊天范围 UI 独立实现验证

日期：2026-11-02。工作区：`$REPO`。

结论：本次指定 UI 差量未发现需要修复的实际可达缺陷。动态执行真实组件、真实 RPC matcher，以及父表单到真实 ActivityService/store 的保存路径均通过。此结论只覆盖下列 UI 实现；不代替 Windows 原生截图/OCR 验收，也不覆盖单独送审、尚未实施的设计 C。

## 范围与能力

- Surface：Windows 工作中心运行应用搜索、指定聊天范围、双矩形校准、本机标题 OCR 预检。
- L2 / Autonomy：由用户主动选择、手动切换窗口、点击本机预览和 OCR；UI 不自动切换窗口，不新增点击/键入能力。保存范围与开启采集仍为独立动作。
- Compose：实际 handler 录制的预览 → 原图像素坐标 → 本机 OCR 回执 → 范围草稿 → 明确保存 → 后台配置。
- Trust / Channel：图片和 OCR 标题只作待核对输入；校准请求使用本机 RPC，未发起模型调用；迟到回执不能覆盖已变更上下文。

已读真实源码：`ChatScopeEditor.tsx`、`activity-request.ts`、`PersonalWorkspace.tsx`、对应 `styles.ts`。没有改产品源码、配置或提交。

测试源指纹：

```text
ChatScopeEditor.tsx SHA256 246174751082567d61f30bd27930abcedc0b59a05f3044afa550aae66cb1065e
PersonalWorkspace.tsx SHA256 d5a924e0d0a27daf49c1c486a9aa6a3a1de87abd7fbeaf192b45e8192e314665
```

## 实际命令与材料

从工作区执行，Node 22.23.4：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null && node /tmp/cmspark-825-ui-independent-probe.cjs
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null && node /tmp/cmspark-825-ui-parent-probe.cjs
```

两条最终命令均 exit 0。完整输出分别为：

- `/tmp/cmspark-825-ui-independent-probe.log`
- `/tmp/cmspark-825-ui-parent-probe.log`

两份独立 harness 均在 `/tmp`，没有修改产品。第一份将真实组件与真实 `activity-request.ts` 编译到 VM，执行真实事件处理器与 effect cleanup，只将 React 调度、DOM 图片边界、计时器和 Chrome 传输设为受控观察端。预览与 OCR 回执来自 `companion/tests/fixtures/activity-scope825.json` 的真实 handler 输出；跨应用负例只改变目标 app_id 与请求关联 ID。第二份导出仓库已有 full workspace UI harness，运行真实父组件与真实 Service/store/validation；只暴露 fixture 的 service 供清理和观察。其应用列表观察端提供 201 个受控进程身份，不声称它们来自本机 Windows。

## Outcome：可观察验收

| 行为 | 动态证据与结果 |
| --- | --- |
| 双框坐标正确 | 800×300 原图在 400×150 显示，实际 pointer 事件生成内容框 `{x:100,y:10,width:700,height:290}`、标题框 `{x:110,y:20,width:400,height:60}`；OCR RPC 收到原图标题坐标与 `zh-Hans`。内容 overlay 的 left=12.5%、width=87.5%。 |
| 标题在内容框内 | 标题框跨出内容框时真实 OCR 按钮 disabled；没有发出 OCR。 |
| 同布局替换 | 两个已存布局中，校准相同 `[window_class,width,height]` 后替换原布局，最终保留 2 个 profile，800×300 布局仅 1 个，另一尺寸仍在。 |
| 无 profile 受限说明 | 真实 UI 展示“尚未校准；保存后该应用会跳过采集，不会回退为整窗记录”。 |
| OCR 预检后才形成草稿 | 真实 OCR 回执显示 `ALPHA GROUP`；点击添加仅触发 onChange，不发送 activity.configure。 |
| 上下文变更使 OCR 失效 | 分别在 OCR pending 时变更语言、修改矩形、取消、移除应用，再交付原回执；全部不显示识别结果、不出现可添加标题草稿、不调用 onChange。 |
| 切换应用忽略旧预览 | 取消 A 后开始 B，先交付 A 回执不创建 img，再交付 B 回执仅显示 B 的 1 张预览。 |
| unmount 不恢复图片 | 将预览成功回执排入 Promise continuation 后立即 unmount；cleanup 后继续 microtask，没有 state write，因此不重建图片。 |
| RPC 关联与时限 | 真实 matcher 接受实际预览/OCR fixture、拒绝错误 app_id；真实 requestActivity 注册 preview=90,000ms、preview_ocr=45,000ms。 |
| 明确保存才生效 | 父表单接收范围 onChange 后，Service 持久配置仍无 scopes，configure 调用数 0；真实 form submit 才产生 1 次 configure，后台 ok=true，store 中 scopes 与草稿完全一致。 |
| 搜索不受旧 200 cap 影响 | 201 条运行应用 + 1 条未发现的已选身份。第 201 条 WeChat 可用“微信”及完整 app_id 搜出；旧已选身份可搜索，显示未发现说明且仍 checked，后台 allowed_apps 没变。 |

实际日志最后标志分别为 `SCOPE_UI_INDEPENDENT_PROBE_PASS` 与 `SCOPE_PARENT_INDEPENDENT_PROBE_PASS`。

## Component / trajectory 核对

- `ChatScopeEditor.tsx:33`–`:37` 统一版本失效、abort、卸载及语言/已选应用变化；`:44`–`:55` 与 `:75`–`:85` 在异步 continuation 核对版本，动态迟到回执覆盖此路径。
- `ChatScopeEditor.tsx:62`–`:74` 使用图片实际显示边界换算原图像素；`:91`–`:96` 按布局 key 过滤后加入草稿，未调用 configure。
- `ChatScopeEditor.tsx:103` 明确未校准的跳过语义；`:115`–`:116` 将有效双框、预检、添加及最终保存说明连接。
- `activity-request.ts:19`–`:23` 检查 preview/OCR 回执形状；`:44`–`:53` 检查请求 ID、清理监听和专用时限。
- `PersonalWorkspace.tsx:279`–`:284` 在分页前合并已选身份并按名称/身份搜索；`:299` 将 Windows scopes 放入明确保存的 patch；`:303` 只把 scopes 交给编辑器本地状态。
- 产品文件未被本次验证修改，没有扩大到队列、模型质量或 Windows 原生权限新设计。

## 后续 C 增量验证（2026-11-02）

原报告的全局 revision 草稿冲突后来由 root 按 GLM 批准的设计 C 实施。独立验证已固化为 `chrome-extension/tests/activity-config-draft-825.test.ts`；本 agent 只新增该测试，未修改产品。

真实 WorkspaceFrame/PersonalWorkspace → requestActivity → forwardWorkspaceRequest → Service/store 的 6 组回归全部通过：source-only 刷新保留 scope 草稿并以 fresh revision 保存；已刷新或仅后台发生的 config/model ID 变化均 0 configure；读取失败、错误 ID、失败后 late reply、unmount、peer disconnected/connecting、busy 均 0 configure；双击只产生 1 次 fresh read 和 1 次 configure；fresh read 后 source 写入触发真实 REVISION_CONFLICT，保留 profile 草稿、不自动重试。成功写入时 profile 的实际 JSON 字节与录制 handler fixture 一致。

最终命令（在 chrome-extension）：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
./node_modules/.bin/tsc -p tsconfig.test.json --outDir /tmp/cmspark-825-c-ui-dist
NODE_PATH="$PWD/node_modules" node --test /tmp/cmspark-825-c-ui-dist/tests/activity-config-draft-825.test.js
```

最终 tsc exit 0，test 6 pass / 0 fail。日志 `/tmp/cmspark-825-c-ui-types.log`、`/tmp/cmspark-825-c-ui-tests.log`。旧 workspace harness 只被测试时导出，不注册或运行其旧 suite；Chrome state 投递是受控观察端，Service 消息经真实 workspace forward producer 去除连接专用字段。

本报告确认的坐标、取消与保存语义来自真实源码动态执行；Windows 原生窗口/截图/OCR 的行为仍由对应 Windows CI 原生测试负责。

VERDICT: APPROVE
