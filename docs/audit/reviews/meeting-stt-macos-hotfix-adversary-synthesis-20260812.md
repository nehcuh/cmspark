# Meeting STT macOS Hotfix Batch — 四路对抗合成

**Date**: 2026-08-12  
**Scope**: 未提交热修（`main` 工作区）— SW 白名单、macOS whisper 组件、brew 安装、段失败 soft-continue、会议隐私 v2 UI  
**Baseline**: #177 / #178 已合；本批为真机踩坑后补丁  
**Inputs**: Path A Security · Path B Correctness · Path C Packaging · Path D UX  

## 裁决矩阵

| Path | 视角 | Verdict |
|------|------|---------|
| A | Security / Trust | **REJECT** |
| B | Correctness / STT | **REJECT** |
| C | Packaging / macOS | **REJECT** |
| D | UX / Honesty | **REJECT** |

**合成裁决：`REJECT` — 不得按当前热修直接 merge；须吸收 blocking 后再双路/回归。**

> **Absorb status (2026-08-12 后续会话)**：Slice1–3 + 会议 AI 纠错/智能分段已落地到工作区（soft-continue 收窄、install.manifest pin、package dylib fail-closed、双 ack、诚实 soft banner、段末 priorContext refine）。请以当前 diff + 单元测试为准做二次审查，勿按 REJECT 快照直接 merge 旧态。

---

## 已确认有效的修复（保留）

| 项 | 说明 |
|----|------|
| SW 转发 `voice.binary.download/cancel` | 消除「下载组件 → 版本过旧」假报 |
| SW 转发 `voice.stt.partial_request` | 消除近实时 → 版本过旧假报 |
| 会议内 v2 隐私卡 | 可发现性优于纯设置 |
| 段失败 soft 意图 | 方向对，但实现过宽（见 F-B1） |
| 本机实测 large-v3-turbo | brew / 修好的二进制：45s 音频 ≈ **1.1s**，**非**性能瓶颈 |
| 坏二进制 exit 137 | 根因是 dylib/soname/codesign，不是 large 算不动 |

---

## 跨路径共识 Blocking（须吸收）

### F-merge-1 — 用户缓存路径 pin 旁路（A-F1 + C-F5）

`binary-resolve` 对 `…/bin/whisper/…` 路径 pin 失败仍 `ok:true, pinned:false`。  
与 ADR-023 L5「hash 失败则拒用」冲突；任意可写缓存可被替换后执行。

**吸收方向：**

- 安装时写入 **install-manifest**（primary + 各 dylib sha256）  
- resolve 时 **校验 install-manifest**，而不是「路径子串跳过 pin」  
- 或：用户安装成功后更新 pin 记录并 fail-closed

### F-merge-2 — soft-continue 过宽导致 max-1 死循环（B-F1/F2）

对 `resource_conflict` / `session_busy` / `oom` 仅 `continue` **不 abort** 活跃会话 → companion 仍占 max-1 → 后续段永久 conflict。  
坏二进制的 sticky `infer_failed` 也会 soft 到 hard cap 结束。

**吸收方向：**

| 错误码 | 策略 |
|--------|------|
| `infer_failed` / `infer_timeout` / `empty_result`（end 后 dropBound） | soft 可保留，**连续 N 次（建议 2–3）硬停** |
| `resource_conflict` / `session_busy` | **abort 当前 bound 或 backoff 重试 1 次**，失败则 hard stop |
| `oom` | **hard stop**，不 soft |

### F-merge-3 — 流式路径 start 错误仍杀会（B-F3）

`runStreamingContinuous` 在 `pending===null` 时收到 `voice.stt.error` → `onEnd` → 会议 `finalizeCapture`。  
soft 文案对 near-rt 无效。

**吸收：** 与 continuous 对齐：start/end 错误分类 soft/hard；soft 不 `onEnd`。

### F-merge-4 — macOS「下载」名实不符 + 打包 dylib 软失败（C-F1/F3/F4 + D-F2）

- 无 win 式 HTTPS zip；实际是 **brew 本地拷贝**  
- `package.sh` 缺 dylib 仅 WARNING 仍出 DMG  
- 文案写「一键下载」误导无 brew 用户  

**吸收方向：**

1. UI：`下载本机听写组件（macOS：需 Homebrew whisper-cpp，或使用安装包内置）`  
2. `package.sh`：darwin 打包 **0 dylib → hard fail**  
3. `build-cmspark-whisper.sh`：`otool -L` 不得残留 `/opt/homebrew|Cellar`（fail-closed）  
4. 后端错误文案已部分改进；与 UI 对齐

### F-merge-5 — 错误分类误导（B-F4 + D-F1）

- SIGKILL/exit 137 → 映射 `timeout` →「识别超时」  
- soft 文案 + 默认 **删音频** → 用户以为可重试，实际本段字与音频都丢  

**吸收：**

- runner：`SIGKILL` / dyld 文案 → 独立码 `spawn_error` / `binary_broken`  
- soft banner：`本段转写已丢失（不可恢复）；后续段继续；结束会议默认仍删音频`

### F-merge-6 — 诚实/可操作性（D-F3）

开始录制应 **双 ack 就绪** 才可点（v2 + meeting v1）；标题去掉 raw key 名。

---

## 分路径摘要

### A Security — REJECT

| ID | 摘要 |
|----|------|
| F1 | 用户 install 路径 pin 旁路 |
| F2 | brew/`which`/`CMSPARK_WHISPER_SRC` 无哈希信任 |
| F3 | DYLD_FALLBACK 含 Homebrew 目录（且 hardened runtime 下常无效） |
| N1 | MeetingPanel `source:"settings"` 双门语义稀释 |

### B Correctness — REJECT

| ID | 摘要 |
|----|------|
| F1 | soft + conflict 死循环 |
| F2 | sticky infer_failed soft 到 hard cap |
| F3 | stream start 错误 hard kill 会议 |
| F4 | 137/dyld 误标 timeout |

### C Packaging — REJECT

| ID | 摘要 |
|----|------|
| F1 | install_name 无门禁，绝对路径可出货 |
| F2 | metal/cpu soname 不全 |
| F3 | 下载非下载 |
| F4 | 0 dylib 仍打包 |
| F5 | pin 随 brew 漂移 |

### D UX — REJECT

| ID | 摘要 |
|----|------|
| F1 | soft 文案隐瞒不可恢复损失 |
| F2 | 一键下载 overclaim |
| F3 | 双隐私卡 + 后置 gate |

---

## 建议吸收顺序（最小可合并切片）

### Slice 1 — 正确性止血（阻塞上线）

1. 收窄 soft-continue 错误集 + conflict 时 abort/backoff  
2. 连续失败 N 次 hard stop  
3. stream 路径 start 错误不杀会（与 continuous 对齐）  
4. SIGKILL/dyld 错误码与文案  

### Slice 2 — 信任与打包门禁

1. 去掉路径子串 pin 旁路；安装 digest 复验  
2. package/build fail-closed on missing dylib / absolute otool paths  
3. UI 诚实：macOS 组件安装前置条件  

### Slice 3 — UX 与测试

1. 双 ack 门控开始录制  
2. soft banner 写清「本段字丢失」  
3. 测试：SW whitelist、soft-continue 不 onEnd、brew install smoke（有 brew CI 节点）

---

## 本机实测（合成时纳入）

| 配置 | 结果 |
|------|------|
| brew `whisper-cli` + large-v3-turbo + 45s | wall ≈ **1.1–1.2s** |
| 修好的 cmspark-whisper + large + 45s | wall ≈ **1.1s** |
| 坏二进制（缺 soname） | exit **137**，0 输出 |

→ **不得**再把「识别超时」默认归因于 large 性能。

---

## Ship bar

- [ ] Slice 1 合入并过 companion/extension 相关单测  
- [ ] Slice 2 package dry-run：`otool` 无 homebrew 路径  
- [ ] Slice 3 文案 + 双 ack  
- [ ] 真机：medium 或 large，会议 ≥3 min，soft 失败不杀会、conflict 不空转  
- [ ] 真机：无 brew 机器看到诚实失败文案（非「版本过旧」）

**Synthesis**: `REJECT` → absorb F-merge-1..6 before claim merge-ready.
