# 会议说话人分离升级：speaker embedding + 可靠自动人数

> GitHub: #260
> 日期: 2026-09-04 | 状态: Locked
> 相关: [MTG3 diarize 设计 SoT](./2026-08-08-meeting-mtg3-diarize-design.md)（pyannote 级方案是非目标 :70）· 现状 `companion/src/meeting/auto-diarize.ts`

---

## 1. 一句话

说话人分离从「3 维手工声学特征 + k-means」升级为「ONNX speaker embedding + 确定性聚类」，自动人数估计在真实多说话人音频上达到默认可信（摘掉 `experimental` 标注的升级条件见 §5 评测门）。**只分「发言人N」，不认是谁**（非声纹身份识别，issue NEVER）。

## 2. 现状与缺口

- 特征 `[logEnergy, zcr, spectralCentroidNorm]`（auto-diarize.ts:13）+ 确定性 k-means（K 2–4，silhouette 自动选 K）；同音量同性别说话人区分度差。
- **特征提取双实现**：扩展 `meeting-audio-import.ts:45/192` 与 companion `auto-diarize.ts:282-307` 同一公式两处维护——本票把特征提取收拢到 companion 单实现（扩展改发原始 PCM 段），顺手消除漂移面。
- 结果永远 `experimental: true`；K 上限 4 是产品决策。

## 3. 设计

### 3.1 模型与运行时

- 运行时：**onnxruntime-node**（预编译 per-platform 二进制，无 Python——issue NEVER 禁 pyannote/Python）。
- 模型：**WeSpeaker ECAPA-TDNN ONNX**（192 维 embedding，~26MB；respeaker/voxceleb 公开模型）。manifest 驱动下载：复用 whisper-download.ts 全套管线（https-only / .part 流式 / sha256 pin / 原子 rename / 预算预检查 fail-closed）。
- 磁盘预算裁决：whisper 预算当前只计 whisper 根目录（4096MB）。本票把预算作用域扩为 `voice-models/` 公共根（whisper 子树 + diarize 子树共用 4096MB 总额），预算 UI 披露合计占用——**不静默放宽总量**。

### 3.2 管线

```
扩展：会议音频导入 → 按既有分段切 16kHz mono PCM 段（不再提特征）
  → meeting.auto_diarize 带 PCM 段（base64 chunk，复用 #282 chunked 编码模式）
companion：PCM 段 → onnxruntime 跑 ECAPA → 192 维 embedding 逐段
  → 确定性聚类（嵌入余弦距离 + 层次凝聚，阈值常数）→ silhouette 自动 K（K 2–6，见 §3.3）
  → 贴 发言人N 标签（preserveManual 保护既有手工标签，不变）
```

- 模型未下载：`meeting.auto_diarize` 回 `embedding_model_required` + 引导到模型管理下载（不静默回退 3 维特征——用户要准的就是新路径；旧路径仍可从设置显式选回，见 §3.4）。
- 段级 embedding 计算量：1 小时会议 ≈ 3600 段（按 1s 段）× ECAPA 前向，onnxruntime CPU 可承受；加进度事件 `meeting.diarize.progress`（复用 voice.model.progress 广播模式）。

### 3.3 自动人数升级条件（诚实门）

- K 范围从 2–4 扩到 **2–6**（`DIARIZE_K_MAX` 6；embedding 区分度高，silhouette 在大 K 上不再退化）。
- 「默认可信」的升级条件 = **评测门**：仓库新增 `scripts/diarize-eval.mjs` + 小型合成评测集（3/5 段已知人数的多说话人拼接音频，含同性别同音量对抗样本），指标 = 人数估计正确率 + 段级标签纯度；embedding 路径必须**显著优于** 3 维 baseline 才允许把 `experimental: true` 摘掉。评测结果写进 PR；未过门则功能可用但仍标实验。
- `experimental` 摘除是单独一行 diff + 评测输出引用（与 ADR-027 开闸同款纪律）。

### 3.4 设置与回退

- 会议设置新增「说话人分离引擎」：embedding（默认，模型就绪时）/ legacy 3 维（显式可选回退，标注「旧版·区分度低」）。模型管理体系复用 whisper 模型卡片模式（下载/删除/状态）。

## 4. 常数表

| 常数 | 值 | 含义 |
|------|----|------|
| `DIARIZE_K_MIN / DIARIZE_K_MAX` | 2 / 6 | K 范围（K_MAX 从 4 升 6） |
| `DIARIZE_EMBEDDING_DIM` | 192 | ECAPA-TDNN 输出维 |
| `DIARIZE_CLUSTER_THRESHOLD` | 实现期校准 | 嵌入余弦凝聚阈值（评测集上校准，写进 PR） |
| `VOICE_MODELS_DISK_BUDGET_MB` | 4096（既有值，作用域扩大） | whisper + diarize 共用 |

## 5. 未完成时禁止假装

- 3 维特征现状不算完成；embedding 路径未过评测门不得摘 `experimental`。
- 标签是匿名聚类：文案只说「发言人N」，禁止任何「识别出是谁」的暗示。
- 模型未就绪必须显式引导下载，不静默落回旧引擎。
- 音频不出本机（onnxruntime 本地推理）；不引入云端 diarization。

## 6. 测试

- embedding 管线单测（合成 PCM → 确定性输出；同输入两次同标签）。
- 聚类：已知 K 的合成嵌入集 → 自动 K 命中；preserveManual 不变。
- 下载管线：复用 whisper-download 测例模式（sha256/预算/断点）。
- 评测脚本可重复跑，输出格式与 knowledge-route-eval 同款分栏。
- 双实现消除：meeting-audio-import 不再含特征公式（source pin）。

## 7. Blast（沿用票面 T3）

新模型依赖 + 磁盘预算作用域变化 + 下载管线复用；Surface: companion meeting + 模型管理；Trust: 音频不出本机；Channel: 既有 WS。onnxruntime-node 的预编译二进制供应链风险在 PR 里披露（npm 官方包，lockfile pin）。

## 8. 不在本票

- 声纹身份识别（只分发言人N）；pyannote/Python 运行时；云端 diarization
- 实时分离（会议是录后处理，现状如此）
