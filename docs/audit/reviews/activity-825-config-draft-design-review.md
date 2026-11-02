# #825 设计 C：采集期间保留配置草稿与校准结果

独立只读设计验证。未修改产品文件、实时配置或正在运行的采集设置；探针与候选源码副本仅写入 `/tmp`。

## 结论

用公开配置与模型目标指纹代替“打开表单时的全局 revision”是正确方向：来源、候选、待办或提醒状态的正常写入不应使配置草稿失效。

最小完整 C 还需明确一次**提交前读取最新 activity.state**。当前 UI 每 20 秒刷新，5 秒校准结束时 props 中的 revision 常已落后于 3 秒采集产生的实际 revision。只替换 guard、继续使用缓存 props revision，仍然被后台正确拒绝，无法解决该支持路径。

本报告批准下文修订后的最小 C 进入 GLM-Claude 复审。原“只替换 guard”版本单独实施不足以完成验收。

## 已执行验证

```sh
source ~/.nvm/nvm.sh
nvm use 22.23.4
node /tmp/cmspark-825-config-draft-probe.cjs
```

exit 0；完整证据为 `/tmp/cmspark-825-config-draft-probe.log`。

方法：从现有 `activity-bulk-753-ui.test.ts` 导出真实 UI harness，不执行其测试注册；从真实 `createActivityFixture` 测试 helper 导出服务实例，继续执行当前生产 Service/Store/validation/model-config 源码，仅保留已有的惰性原生/模型叶子。候选 UI 副本只替换 `initialRevision` 与对应 guard，两处变换都校验原源码标记。所有来源新增通过真实 `service.store.addSource()`，所有保存通过真实 `service.handle(activity.configure)`。

验证时 UI 源 SHA256：`cb6e5478f3c32506f6caf2a267740f02efd7fa36ac548005e06056ceea35e4fa`。

| 场景 | 实际结果 |
|---|---|
| 现有 UI 打开后仅新增来源，刷新到新快照 | config 完全相同，revision 7→8，旧 guard 拒绝，0 次提交 |
| 指纹候选 UI，仅新增来源，已获取最新快照 | 使用 revision 8 提交，后台保存成功 |
| 指纹候选 UI，仅新增来源，未刷新快照 | 仍提交缓存 revision 7，后台真实 revision 8，返回 REVISION_CONFLICT |
| 真实 activity.configure 修改检查间隔 | 指纹变化，候选 UI 要求重开，0 次提交 |
| 改变视觉 Key，公开 config 不变 | 真实 model-config 生成的新 target ID 改变，候选 UI 要求重开，0 次提交 |
| 读取最新快照后、提交之前再新增来源 | 后台返回 REVISION_CONFLICT，未误报成功 |

这证明正常来源更新与配置变更可以分离，又不需要删除后台原子校验。

## 修订后的最小设计 C

1. 打开表单时冻结基线 `JSON.stringify([config, modelTargetIds])`，并继续冻结用户当时看见的模型标签/ID。配置对象使用后台既有遮蔽投影，不把真实密钥放入 UI。
2. 数据快照更新后，只要配置与目标指纹相同，保留本地草稿、倒计时和画框结果；不因 sources/candidates/todos/reminder 的 revision 变化要求重新校准。
3. 点击保存时通过已有 `activity.state` 读取最新后台快照。将新快照的 `[config, runtime.model_target_ids]` 与基线比较；配置或目标已变则保留草稿、提示收起重开，不发写请求。
4. 指纹仍相同时，以这次读取的 `revision` 发送 patch，同时保留既有 `expected_model_target`。不要把表单打开时或最近一次 20 秒轮询的 revision 当作最新值，也不把 fresh read 自动视为保存成功。
5. 后台原 `expected_revision` 同步、原子校验保持；读取与提交之间如再发生来源或其它状态写入，仍返回 REVISION_CONFLICT。UI 保留未保存的校准和草稿，提示刷新/再保存；不自动重试写入、不静默覆盖。
6. 全程不新增 config_revision、迁移或队列框架，不暂停采集、不改 live config，也不放宽图片授权或 ROI 资格。提交前读取遵守既有连接/组件生命周期取消约束。

## 目标 ID 覆盖的既有边界

探针还用真实 `activityModelTarget` 检查了“模型/鉴权变化均可由 modelTargetIds 发现”的范围，结果如下：

```text
EXISTING_TARGET_ID_COVERAGE
ocrMainChangeDetected=false
standaloneVisionAuthChangeDetected=false
```

这是当前 helper 的已有行为：OCR 目标 ID 固定为 `ocr`；独立视觉的 `auth_style/extra_headers` 没有进入摘要，只有复用主模型时的相关 auth 字段进入摘要。当前 C 可靠检测配置、视觉 URL/model/protocol/API Key、Qwen 目标以及已纳入摘要的复用鉴权变化，不能据此声称覆盖全部主对话/独立视觉鉴权设置。

建议 GLM-Claude 明确选择：本次 C 若承诺“所有模型与鉴权变化都要求重开”，在现有 model-config 中将 OCR 主目标及独立视觉实际鉴权字段纳入现有摘要，再复用相同 ID 机制即可；无需另造版本号。若该承诺只指现有图片授权目标，应在验收中明确范围，不把已有 legacy OCR 行为当作 C 新增的保证。此点不改变已复现的核心草稿冲突修复方向。

## 实施回归要求

保留探针中的六个 UI/真实服务场景，另加入：后台状态读失败时不提交、提示保留草稿；模型目标摘要覆盖按 GLM 批准范围测试。真实 Windows 倒计时/画框后保存仍需在最终构建上核对；本轮 CPU/UI harness 证据不冒充 Windows 原生校准验收。

VERDICT: APPROVE_WITH_NITS
