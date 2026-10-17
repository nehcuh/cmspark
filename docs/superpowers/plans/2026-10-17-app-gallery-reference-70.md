# #70 Gallery 有限实施计划（已批准有限实施）

GitHub: #70 — https://github.com/nehcuh/cmspark/issues/70

root 已审定合同并授权有限实施；已有 GitHub #70，不创建重复子票。

1. **固定证据与最小数据表。** 采用 evidence-candidates.json 两个产品。NPP复用既有官方8.9.8.1 portable x64 package/EXE pins；VS Code使用本次真实官方 metadata 返回的 stable x64 1.142.0不可变URL/packageSHA。latest API只用于本次选样，绝不作为运行时catalog，也不在执行时自动漂移到新版。
2. **一次明确的 hostedWindows 只读采样实现。** root批准后用独立固定 collector 验证下载包 SHA/大小边界→安全解包到owned目录→确认实际EXE相对路径/版本/架构→计算EXE SHA→Get-AuthenticodeSignature→leaf.RawData DER SHA256/Subject/status。只读取公有发行包，不安装、不执行EXE/目标CLI、不启动GUI、不修改证书库/注册表/信任。复用既有 WinPS runner/有限预算；不把 Authenticode 的系统链检查与应用启动混淆。此准备阶段无任何 binary download 或采样。
3. **root采纳真实数据再填bundled值。** 回执含官方来源/下载URL、实际package bytes/SHA、EXE相对路径/bytes/SHA、真实status、DER SHA、Subject、采样UTC、OS/PS版本、natural exit与完整有限原始输出。DER哈希只在有真实证书对象时计算；非Valid/没有证书/collector失败不填成功值。包pin不符直接保留失败，不换镜像/版本/证书，不安装根证书取巧。数据空缺继续有限修复/采集，不伪造mock。
4. **仅接现有列表与展示。** presets.ts扩两条和小型只读 reference/advice；现有PresetStatus、前端对应类型/状态消费和AppsPanel透传展示。**不改 apps-signer.ps1 默认wire、probeSigner、AppEntry、授权/launch逻辑，不新增实时检查。** 保留用户已有条目及停用状态，引用版本是发行版证书参考，不是本机匹配结果。
5. **有限测试与标准门禁。** 使用实际list producer与真实采样响应生成fixture，验证两条检测/未检测/既有条目/并发stale，以及UI纯文本/未知状态/不能误称匹配。必要focused families/TSC/build、真正非作者复审与所需模型门禁，实际head/main CI按root安排；不重跑旧CLI/native链充当新证据。真实hosted metadata见证仍是完成指纹数据的条件。

预计产品变更限 presets.ts、既有PresetStatus前端对应类型/消费、AppsPanel及focused测试；collector/evidence为本批有限验收资产，不做通用catalog、安装器或信任框架。当前main785是资料绑定基线，未来合并时必须重核真正已交付父树，不把未交付Apps union当main。

root一次需审定：上述两个产品/候选路径、参考而非实时核验语义、DER SHA定义、只读采样/不改signer默认协议和既有权限。审定前不编码、不发CI、不对spec自批。
