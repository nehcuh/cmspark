# #825 MCP 诊断 CPU 消费者 CRLF 边界修复

仅修改 `companion/tests/desktop-acceptance-diagnostics.test.ts`；未修改产品、生成器、协议、原生断言、时限或清理，未 stage/commit/push。

根因：MCP raw wchar_t emit 的消费者以 `indexOf('}\n')` 查结束；fixture 为 CRLF 时越过真实 `}\r\n`，把后续 C++ method 放进 VM。B 原复现及本轮新增直接调用实际 `actualBootstrapProducer773` 的四组合控制均证实这个路径。

修复：两层 MCP emit 按唯一实际签名开始，扫描配对花括号提取完整 body，跳过原 C++ 注释、字符/字符串和转义；不归一化生产或编译源码。缺少、歧义或未闭合 method 拒绝。原 #480 分支与所有 recorder/formatter 行为不变。

新增控制仅在派生输入上生成 host LF/CRLF × fixture LF/CRLF，直接调用真实消费者，核实际输出四行完全一致；同时核重复/越界记录拒绝、缺失/重复 raw method 拒绝、原发送失败仍不重试。没有复制“修正版消费者”进测试。

在 companion、Node 22.23.4 下执行：

```sh
./node_modules/.bin/tsc -p tsconfig.test.json
node scripts/run-tests.mjs .test-dist/tests/desktop-acceptance-diagnostics.test.js .test-dist/tests/desktop-native-phases-480.test.js .test-dist/tests/desktop-native-receipts-476.test.js
```

修前新增四组均 RED：CRLF fixture 两组为 SyntaxError；LF fixture 两组正例输出成功，但“重复 method 必须拒绝”的负例暴露旧消费者也不拒绝歧义。修后完整 tsc exit 0，相关 **23 pass / 0 fail / 0 skip**，git diff --check 无错误。

证据：`/tmp/cmspark-825-mcp-crlf-red.log`、`/tmp/cmspark-825-mcp-crlf-types.log`、`/tmp/cmspark-825-mcp-crlf-green.log`。当前状态 MACHINE PASS，待 B 非作者/GLM 复审；不以此预测仍在运行的 Windows 原生结果。
