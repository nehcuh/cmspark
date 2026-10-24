# #758 最新主线整合

此前功能head `81057e01` / run39698906267：Windows #758原生实际1PASS/0SKIP（19,482ms），Linux X11专项PASS，build/Ubuntu/macOS/ACP restart全部PASS；Windows census仍运行，原有#723门失败。有限回执绑定旧controller SHA256 `0746936eac4d8b54e0a2a0f7af2e1c5982a0851bcdabd38cb400af18bd4eebd7`，site54 / line220 / `AWAIT_REFUSED` 对应读取service-worker `chrome.runtime.id`；不是registrar原因证明，原失败保留，禁止改成成功或猜修。

远端main随后新增且仅新增 `ab61257e377e24662c883ee934585f6b2667e195`（PR755 squash）。独立查询GitHub确认上游精确head `e76f20415a9104fc82ff17a707fb76acef7ae2d0` 的[CI39695825956](https://github.com/nehcuh/cmspark/actions/runs/39695825956)六项全部SUCCESS，包含Windows native及census。它包含已明确批准的同次build120 / runtime-cleanup45拆分、同次产物交接、有限phase观察和registrar六处固定Get-Item模块绑定；不把上游的因果结论套到本分支旧site54拒绝。

对功能分支执行正常 `merge --no-ff --no-commit origin/main`，唯一冲突为CHANGELOG两边新增条目，完整保留双方。工作流、精确工作流契约和其负控自动合并后仍保留#755 prepared-handoff测试参数与#758 Windows原生/Linux job/通知资源测试。原#758生产目录与Windows夹具/原生case相对81057e01字节未变；上游registrar/controller/gate/prepared-build相对ab61257e字节未变。没有新增猜修、重试、权限、skip或预算。

Node22.23.2、清洁provider环境：正式Companion build PASS；完整测试编译PASS；组合后的真实脚本契约/准备交接/phase/通知资源控制 **194PASS/0FAIL/0SKIP**；活动、平台、观察、认证锁步及两个#723实际源码消费者 **117PASS/0FAIL/0SKIP**。`git diff --cached --check` PASS。两端已有字节不变的构建/UI及原生证据保留；新组合仍须精确CI，不能把上游绿冒当前分支绿。

T3原产品能力声明不变。源码审查复用未变组件，只对主线整合后的组合边界做独立对抗→Pi增量复核；当前未合并PR、未安装或开启用户采集。


整合增量独立对抗APPROVE；Pi APPROVE_WITH_NITS，独立正式build、194项脚本和150项核心/认证/源码回归全部通过，并以git merge-tree证明除CHANGELOG并集和本审计文档外为确定性自动合并。冻结incoming差量SHA256 `8ef3327265c38a485b65152c7713781ca64ac1f8dc148d417ac2d9b4edac004d`，对新main完整PR差量 `ea9347165f07aff2449d8d40b989db98b7bdd2bd2367e93fe72441b29543305b`。之后只补本结果和两份报告，无生产/工作流/测试再修改。

后续实际查询确认81057e01的Windows census也SUCCESS，整run因#723失败而FAILURE。Pi报告CN2对未来红灯的预测不作验收或归责依据：无论新run红或绿，都读取新的实际回执；不把未验证的同因说法套入整合结果。原已跟踪nits仍在#756；原生8MiB和导入6MiB不同预算不因此放宽。新整合head必须全部CI成功，当前PR仍未合并、未安装。
