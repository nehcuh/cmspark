Independent design checkpoint for CMspark #492. User reports recording no visible transcript/no minutes, requests audio + Word/MD/TXT notes for correction. Review outcome, trust, data loss, feasibility; do not demand unrequested OCR. Existing overlay allowlist must not expand, local STT privacy gates remain. No tools. Findings only concrete blockers/nits, <=700 words, final VERDICT APPROVE / APPROVE_WITH_NITS / REJECT.

# 会议转写与参考笔记闭环

GitHub: #492

用户确认参考资料主要为 Word / Markdown / 文本笔记。本票不把纸质手写识别混入文字解析。

## 产品与验收

1. 开始前检查真实本机引擎、模型、权限与连接；缺少条件提供操作入口。
2. 录制中的原始识别立即可见，不等待可选 AI 纠错；原始内容保留，纠错作为独立建议。
3. 结束时提供明确主操作“结束并生成纪要”，保留“仅结束录制”；生成使用已确认保存的当前文本，不能拿旧文本冒充。
4. 导入录音入口提升到会议材料区；串行段识别、取消与超时释放资源，已有文本不可出现本地追加但远端覆盖的不一致。
5. 参考笔记独立于转写和输出模板。支持输入及 .docx/.md/.txt 导入，大小受限、解析失败可恢复、原文可查看。
6. 用户显式生成时结合原始转写和参考笔记；纪要保留校正稿、纠错依据、笔记补充与冲突。校正不覆盖原始识别；缺证据的结论/人物/期限不补造。
7. 修改材料后旧纪要可保留查看，但明确“待更新”，不能显示为基于最新材料生成。
8. 窄屏先展示材料、转写和主要动作；模板、导出、分段和说话人功能均保留并合理组织。

## 实现分工与边界

- 后端：会议参考材料解析/持久化；生成输入快照、参考材料提示与校正结果；旧纪要失效标记；生产 handler/store 契约测试。
- 前端：录制就绪、即时原文、明确停止/生成、导入及参考笔记操作；保存 ACK 后生成、错误恢复；音频超时/取消回归。
- 根代理：真实组件浏览器验收、文档、整合回归、Grok + DeepSeek 独立双审、PR/CI/合并与 Mac 换装。

复用既有本地 STT 和文档解析器，不增加依赖；音频不交给云 STT。参考材料仅在显式纪要生成中交给用户配置的现有 LLM，无工具执行能力。原有 overlay 允许列表不扩大；召唤器共用扩展面板通过既有可信通道实现，原生 overlay 未授权文件导入不借此解禁。

## 验证门禁

先重现再修复：引擎状态不一致、慢纠错阻塞出字、保存失败生成旧稿、录音导入覆盖、超时未 abort。真实生产 handler/frame 与浏览器组件测试，隔离数据与 Chrome；不读取用户会议素材。文档解析至少 TXT/MD/DOCX 真文件、损坏/超大负向；参考内容不可替换原始转写、过期纪要标记。相关测试及构建绿后，冻结 diff + 源 + 证据供 Grok 4.6 / DeepSeek V4 Pro 独立审查，逐项亲证裁决，当前 HEAD CI 全绿才合并。


Implementation contract: reference file max10MiB, notes max100k chars, .docx/.md/.txt via existing safe parser. Independent reference_notes/reference_name stored with meeting. Raw live STT appends immediately; optional live correction suggestions separate, never hold original text. Stop-and-generate primary, stop-only secondary; close remains no generation. Generation waits current text and reference save ACK. Explicit generate snapshot wins over stale stored text. Raw transcript source retained if unchanged. LLM without notes retains Markdown protocol. With notes returns JSON minutes_md, corrections[{original,replacement,reference_excerpt,reason}],reference_supplements[{reference_excerpt,reason}],conflicts[{transcript_excerpt,reference_excerpt,reason}]. Original must uniquely match transcript, evidence excerpt must exist in notes, no overlapping replacements; corrected_transcript derived separately; invalid claims rejected. Cannot machine-guarantee semantic truth; UI labels AI draft and references, user verifies. Fingerprint of text+reference marks old/late minutes stale when inputs change. Import audio appends coherently, mismatch PCM invalidates diarization cache. Late/failed writes cannot generate old data. Runtime input capped. No new models/dependencies/cloud ASR, no live-config edits; engine enable is an explicit user action. Tests isolate actual handler/store/UI and document parsing; STT/LLM boundaries synthetic, no real speech accuracy claim.