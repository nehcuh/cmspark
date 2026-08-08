// Experimental model layer license door + THIRD_PARTY_NOTICES (Qwen3-VL).
//
// LICENSE_DOOR_TEXT is shown on first enable; hash binds acceptance to text version.
// THIRD_PARTY_NOTICES_TEXT is the ship notice source of truth (keep companion/THIRD_PARTY_NOTICES in sync).

import { createHash } from "node:crypto"

// --- THIRD_PARTY_NOTICES（随分发包） --------------------------------------------

export const THIRD_PARTY_NOTICES_TEXT = `THIRD_PARTY_NOTICES — CMspark Agent（实验定位模型层）
================================================================================

本分发物支持由用户显式下载以下第三方模型工件（模型文件不随安装包分发，
下载前须经许可证门确认）。

--------------------------------------------------------------------------------
1. Qwen3-VL Instruct（本地实验定位层）
--------------------------------------------------------------------------------
Source:   https://huggingface.co/Qwen
Variants: Qwen3-VL-2B / 4B / 8B Instruct
License:  以各模型卡与 Qwen 许可条款为准（请以 Hugging Face 页面最新 LICENSE 为准）
Notes:    用于「截屏 + 自然语言 → 建议点击坐标」；输出未校准，注入前必经确认台。

--------------------------------------------------------------------------------
2. Cairn (protocol inspiration only — NOT linked, NOT redistributed)
--------------------------------------------------------------------------------
Project:  https://github.com/oritera/Cairn
License:  AGPL-3.0
Status:   NOT a dependency. NOT vendored. NOT copied.

CMspark MissionBoard (ADR-016) is inspired by high-level protocol ideas from
Cairn (Fact/Intent/Hint coordination, structured handback, conditional complete,
stigmergy). Schema types, runtime code, and persistence are reimplemented
independently for CMspark’s Thread / Mission Pack / multi-agent stack.

See: docs/licenses/cairn-inspiration.md
     docs/adr/016-mission-board.md §2.7 / Appendix A G14

FORBIDDEN: copying Cairn source files, pasting schema JSON verbatim, or adding
Cairn as an npm/git dependency.
`

// --- 许可证门弹窗文案（computer.model.license_required 的 licenseText） ---

export const LICENSE_DOOR_TEXT = `【实验功能许可确认】Qwen3-VL 本地视觉定位模型

一、许可证与来源

本实验层默认使用阿里通义开源的 Qwen3-VL Instruct 权重（Hugging Face）：
- Qwen/Qwen3-VL-2B-Instruct（默认）
- Qwen/Qwen3-VL-4B-Instruct
- Qwen/Qwen3-VL-8B-Instruct
权重许可以各模型卡与 Qwen 许可条款为准（通常允许研究与商业使用，
请以 Hugging Face 页面最新 LICENSE 为准）。下载即表示你接受上游许可。

二、能力与限制（诚实披露）

- 本层用于「截屏 + 自然语言 → 建议点击坐标」，支持中文指令。
- 输出未校准：坐标可能完全错误；任何注入前必经确认台人工确认。
- 本机推理依赖 Python 3 + transformers/torch（或兼容后端）；首次下载体积约
  4.5GB（2B）/ 8GB（4B）/ 16GB（8B），并占用相应内存或显存。
- 资源不足时会极慢或 OOM——设置页会提示各变体建议内存/显存。

三、本项目补充条款

- 本层默认关闭；开启后为可选实验层。
- 模型建议点仅作候选；UIA / OCR / 用户框选仍为默认定位路径。
- 拒绝本许可则本实验层跳过；之后可在设置页「实验层」点击「复位许可拒绝」重新打开流程（无需手改 config.json）。
- 启用本层不降低其他安全门（任务级 L2、急停、白名单等）。
- 模型输出仅作为坐标解析候选，任何点击执行前必经 L2 人工确认。

接受后将按当前选择的变体从 Hugging Face 下载模型。
拒绝则本实验层跳过，其余定位层不受影响；之后可在设置页复位。`

/** LICENSE_DOOR_TEXT 的 sha256 前 12 位小写 hex（config normalize 同形状校验）。 */
export const LICENSE_DOOR_TEXT_HASH = createHash("sha256")
  .update(LICENSE_DOOR_TEXT, "utf8")
  .digest("hex")
  .slice(0, 12)
