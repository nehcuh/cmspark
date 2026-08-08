# 会议 Mtg3 — 自动说话人标签（本地聚类）设计 SoT

> **日期**: 2026-08-08  
> **状态**: **LOCKED for Mtg3.0 implementation**  
> **父 SoT**: [会议纪要](./2026-08-07-meeting-minutes-design.md) §6.3 / §13  
> **对抗依据**: R1 合成要求 Mtg3「另开对抗」— 本文件吸收 floors，**拒绝**飞书/Otter 级身份 SLA  

---

## 0. 一句话

**在已有转写行上，用本机音频片段的轻量声学特征做 k-means 聚类，自动打上「发言人1…K」匿名标签；用户可改名。不识别真实身份，不调用云 diarize，不默认开启。**

---

## 1. 成功 / 非成功

| | |
|--|--|
| **成功 Mtg3.0** | 上传音频或本机会分段录制后，一点「自动标说话人」→ 多数行有 `发言人N`；可手动改；生成纪要时沿用已有标签 |
| **非成功** | 识别「张三/李四」真名；单麦 100% 准确；系统混音；静默后台；Pack autoStart |
| **诚实副标题** | 「实验 · 匿名标签 · 非身份识别」 |

---

## 2. 方法锁定

| 项 | 锁定 |
|----|------|
| 引擎 | **本机 pure TS**：段级特征 + k-means（K=2..4，默认 2） |
| 特征 | log-energy · zero-crossing rate · 粗 spectral centroid（Float32 mono 16k） |
| 粒度 | **一条转写行 / 一段 STT 窗口** 一个向量（非词级） |
| 标签 | `发言人1` … `发言人K` 固定中文前缀；**禁止**模型编造真名 |
| 纯文本 | **不**声称 diarize：仅可选「按静音切交替弱标」（单独 mode，UI 明示弱） |
| 云 API | **禁止** Mtg3.0 |
| 默认 | **off**；显式按钮；可勾选「导入音频后自动跑」默认 false |

---

## 3. Trust / 协议

- 复用 `meeting_privacy_ack_v1`（产物本地）；不新增 ack 版本（聚类不上传）  
- `meeting.auto_diarize`：chrome-extension origin；`mode: audio_cluster | text_gap`  
- 客户端算特征时可只上传 **特征矩阵**（小）+ line indices；音频不二次落盘  
- meta：`diarize: { method, k, at, experimental: true }`  

---

## 4. 与 Mtg2 关系

- 手动标 / bulk / `姓名:` 解析仍优先；自动结果可被覆盖  
- 静音切仍用于文本分段；聚类在**已有行**上贴标签  

---

## 5. 验收

1. 合成双峰特征 → 聚类分离准确（单测）  
2. UI 无「识别与会者姓名」文案  
3. Pack / minutes prompt：可用已有标签，仍禁止臆造真名  
4. 无音频时 `audio_cluster` 失败并提示上传/录制  
5. origin fence + 无 Pack auto  

---

## 6. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-08 | Mtg3.0 LOCKED：本地段特征 k-means；非身份 SLA |
