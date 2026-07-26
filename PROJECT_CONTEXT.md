# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-26 (session-end S16 — computer-use 点击真生效 + Mail 最新信)
- **用户验收**：模拟点击已成功（#i4x6pm 后）；Exchange/最新 Mail 可读。
- **根因/修**（已热部署到 `/Applications/CMspark.app`，源码本 session commit）：
  1. inject 原点闸 `bestDist<24`（与截图 lockstep）
  2. **SkyLight + HID 双投递** + inject 前 activate；`CMSPARK_HOST_SHA256` 钉住新 host
  3. read-mail 按 date 取最新；session-trust 默认勾选 + actions 地板=max(actions,budget)
  4. forceForeground 同 bundleId 视为成功
- **HEAD 期望 commit**：`fix(computer): dual HID inject + mail newest + session-trust defaults`
- **下次**：
  1. `make package-macos` 正式重打 DMG（整包 node_modules + host + agent，避免长期热补丁漂移）
  2. 可选：收紧 click `verified`（像素噪声假阳性）
  3. session-trust 扩展若仍未默认勾选 → 确认用户加载的是新 build 的 sidepanel
- **勿混入**：`docs/decisions/v1.3/`、`.omx/`、audit `*.patch`/`*.err`、`tmp-wx-live.png`

### 2026-07-25 (session-end S15 — deep diagnosis fanout + P0-A/B/C landed; P0-D mid-flight)
- 诊断 fanout 5.8/C+；P0-A/B/C 已 commit；P0-D 发布 hard-gate 仍开放。
- 双审流程：`p0-batch-fix.rhai` + `scripts/dual-external-review.sh`
<!-- handoff:end -->
