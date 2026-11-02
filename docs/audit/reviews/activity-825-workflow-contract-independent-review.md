# #825 CI 命令契约修复独立复核

2026-11-03。只审当前未 stage 的 `scripts/tests/windows-ci-feedback-750-contract.mjs` 与 `scripts/tests/windows-ci-feedback-750.test.mjs`；未修改产品、commit 或 push。

未发现缺陷。修复从 sealed #758 nativeStep clone 后，仅扩展 run 中的两个 #825 参数；完整对象 deepEqual 仍保留原 Windows native lane、shell、CMSPARK_ACTIVITY_NATIVE_758 环境和失败属性，且仍要求紧跟共享测试编译。原 #758 文件仍为第一个测试参数，新 apps、scope 参数有固定顺序。三个逐一删除原/新测试文件的负例均被拒绝。

实际验证（Node 22.23.4）均 exit 0：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node /tmp/cmspark-825-workflow-contract-independent.mjs
node --test scripts/tests/windows-ci-feedback-750.test.mjs scripts/tests/native-ci-stages-760.test.mjs
```

独立 probe 从 git HEAD 取修前 contract，在内存装载后证实：当前真实 workflow 被原 exact #758 native command 断言拒绝；仅移除两个 #825 参数后原 contract 通过。新 contract 接受当前 workflow，拒绝移除两参数的旧命令。没有改工作流来获得通过。

两套相关测试共 **115 pass，0 fail，0 skip**。完整日志：`/tmp/cmspark-825-workflow-contract-independent.log`、`/tmp/cmspark-825-workflow-contract-independent-tests.log`。

原 sealed `activity-platform-758-workflow.json` 字节与 git HEAD 一致，文件 SHA256 为 `edf6520197bcf1d8005d49e9f4cc8c2bf3791f3dfea32406f4c94c83a04aec00`；contract 中原 canonical hash 校验未变。独立比较去掉 run 的实际/原 sealed step，所有属性相同；位置仍为 compile + 1。未放宽 lane、环境、失败处理或顺序。

VERDICT: APPROVE
