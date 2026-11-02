# #826 compiler file-fd/stable-cwd：实施交接

2026-11-03。base64dbdaafda240f06cac21955e2a4a8ee163c8740。B 独立设计与实际 GLM5.3/Claude2.1.153 设计门 APPROVE 后实施，批准记录 `/tmp/cmspark-826-stdio-scope-glm-design.md` / `.json`。本报告是作者交接，待 B source 与 GLM source 门，不是 Windows 成功认定。

## 精确差量

只修改 `companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs`，62+/11-。冻结 SHA256：`2984a8c1cd5487e26de9d30e519d991d61ed1e6da04854e62e7be7470c4911d6`。

- Compiler stdout/stderr 使用本 case 下两个固定 `wx+`/0600 文件 fd，stdio 为 ignore/out/err。cwd 改稳定 companion root；Windows `/Fo` obj 与 `/Fd` PDB/idb 明确指向 owned 目录；原 cpp 与 `/OUT` exe、clang `-o` 均保持 owned 绝对位置。
- `built.error===undefined` 与 `built.status===0` 仍须通过，不用二进制存在替代。仅失败时每流一次读取至多64KiB已有字节，诊断读取错误不替换主错，不等后代 EOF。
- 已开 fd 在局部 finally 全部尝试关闭，首/次 open、spawn、断言失败皆覆盖。保留原主体优先级；无主体失败的 close/rm 失败照常失败。原 outer cleanup 仍执行。
- 在原30秒 CPU case 内增加一个真实自有 Node 后代控制：继承两个 regular file fd、稳定 cwd，经 IPC ready 确认已写 READY，父实际删除整个 owned 日志目录，随后发送 late-write 指令；后代写 LATE、回执并自然 close；父从仍开的 fd 验证完整 READY/LATE 字节。无平台 skip，Windows 通过同一路径必须实际执行；事件驱动、不 poll、不用延时等待、不增加时限。失败只终止手中自有 ChildProcess、等待其 close 并关闭 fd，沿用原 case signal/budget。
- 扩充真实 callback AST 控制的 fsPort，显式覆盖 open/close/read，防提前 TypeError 伪通过。当前平台及 Windows 编译分支各核：first/second open、spawn、timeout、nonzero、diagnostic-read、close+primary、close-only；核实际到达 compiler、stdio 数字 fd、cwd、原20000ms、Windows/Fo/Fd、全部 fd-close 列表及64KiB读取上限。原 timeout+outer cleanup 保主错、cleanup-only 仍失败继续有效。

原 compiler20秒、CPU case30秒、exe6秒、原生MCP20秒未变；没有改 worker/header/reader/真实wire/BigInt控制、scope、生产、配置、权限、SDK/COM次数或CI入口。其他工作区差量归root/scope作者，不属于此单位。

## 机器结果

Node22.23.4，macOS，在 `companion/`：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node --test scripts/tests/desktop-mcp-snapshot-825.test.mjs
node --test scripts/tests/desktop-build-windows-480.test.mjs
```

- 定向3 PASS / 0 FAIL：`/tmp/cmspark-826-compiler-stdio-final.log`。
- 原480构建契约入口178 PASS / 0 FAIL：`/tmp/cmspark-826-compiler-stdio-integration.log`。
- `git diff --check` PASS。此单位仅MJS，未重复不相关TS编译或benchmark。
- 上述真实主case通过包含 live 后代持fd期间实际整目录删除、删除后写入、自然进程关闭与fd字节核对。Windows修后尚未运行；本机不冒充NTFS证明，也不扩为旧Windows/SMB保证。

此前只读设计实验证明的是候选机制可达：直接父exit0/后代持pipe可使spawnSync仍ETIMEDOUT，inherit可把等待转移到实际node--test外层，filefd避免该EOF依赖。它们没有认定历史cl/link/vctip物理根因。status0也只描述直接命令状态，不证明所有后代已回收。若原Windows20秒门仍失败，保留实际失败继续定位，不加时、不skip。

源码已冻结并交 B 增量复审。未 stage、commit、push 或运行CI。
