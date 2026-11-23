# 会议画面证据实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development. Track the integration and independent review in this worktree.

**Goal:** 让桌面会议引用本地录屏中的文字、代码与图表，同时保留独立的语音及画面来源。

**Architecture:** 浏览器保留同一显示轨道上的变化帧。Companion 在用户确认后提取事实并持久化带时间戳的证据。文字纪要核对各自来源，会议页负责预览、选择、取消和回看。

**Tech Stack:** Chrome MediaStream、Canvas、IndexedDB、React、TypeScript、Companion WebSocket、现有图像模型和文字模型客户端。

**Spec:** [已批准设计](../specs/meeting-visual-evidence.md)

## Global Constraints

500 ms 检查、1000 ms 稳定、自动帧间隔至少 5 秒、60 秒兜底去重。每场 240 帧／32 MiB，每帧 1600 px／512 KiB，每批最多 12 帧／9 MiB，整批 150 秒、单帧 30 秒。原始转写、会议笔记和画面证据分别保存。接收方、配置修订、有序哈希与相邻转写绑定一次性确认。沿用原生跨平台测试时限与所有断言。

### 本地采样与留存

- [x] 在 `desktop-meeting-media.ts`、`workbench-screen-capture.ts` 与 `workbench-recording-store.ts` 接入默认关闭的采样，使用录制起点、单在途写入、事务性上限和按录制删除。公开 `listMeetingFrames(meetingId)`，提供 frameId、meetingId、recordingId、timeMs、width、height、mime、sha256、blob。
- [x] 先用静态页、数字变化、滚动、噪声、慢写与取消样本验证去重和覆盖，再用原录制测试验证收尾与轨道所有权。

### 接收方与图像识别

- [x] 在 `model-center.ts`、设置面板中支持显式选择现有 profile 或已配置的视觉服务。Companion 负责解析凭据。拒绝空、截断、无依据和过大响应。
- [x] 独立 `meeting-visual-handlers.ts` 对接扩展专属 prepare、execute、cancel、list、remove。prepare 接收元数据，execute 检查会议／录制身份、当前转写及图片字节哈希。保留成功帧并立即停止后续发送。独立文件记录证据，删除和断线使在途任务失效。
- [x] 以假端点计数核验确认前发送量、换图／换模型拒绝、超时与断线，使用本地真实视觉服务核验数字、代码、状态及不确定性。

### 纪要生成与引用

- [x] 在 `meeting-minutes.ts`、`minutes-evidence.ts`、`meeting-store.ts` 及原有 prepare/generate 路径构造视觉材料、保留空材料旧指纹、核对引用并更新 stale。逐字稿原文仍须逐条匹配，提案不能单凭截图生成决议。
- [x] 使用完全相同的逐字稿对比有图／无图输出，覆盖提案、冲突、移除证据、引用失配及旧录制。

### 交互与发布

- [x] `MeetingPanel.tsx` 接入采样开关、标记、缩略图、时间、接收方预览、确认、取消、逐帧状态和引用回看。默认分散选择最多 12 张，变更会议或卸载废弃旧结果。
- [x] 以受控 PPT／表格和代码／软件会议走通实际浏览器录制、存储、选图、真实识别与纪要回查，记录遗漏、时延和字节数。回归纯音频、旧数据库、删除及来源撤销。
- [ ] 两端类型检查、完整测试和生产构建后独立评审。按发布手册完成版本同步、PR、同树发布预演、主分支检查、标签、发行资产与校验和复验。
