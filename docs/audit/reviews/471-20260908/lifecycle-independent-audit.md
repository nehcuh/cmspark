# 隐藏状态专项只读审计

独立子代理 settings_ia_audit；源码与测试覆盖检查，未独立重跑浏览器。

先前语音 P2 已关闭，未发现新的可复现阻塞项。SettingsIntentBar 折叠、许可覆盖或卸载时递增 generation 并 abort，迟到 result/error/end 被拦截；HotkeyCaptureField 离开语音分类或许可覆盖时取消捕获并移除 window 监听；设置主体 inert，许可 Modal 位于其外；许可期间延后设置深链，关闭后恢复之前焦点，待处理深链优先；许可拒绝、接受和 Escape 沿用原处理，无隐式接受。

该审计仅补充生命周期检查，不替代 Grok + DeepSeek 最终复审。
