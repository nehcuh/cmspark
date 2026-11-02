# #826：compiler stdio 与 cwd 的有限修正设计

2026-11-03，当前 HEAD64dbdaaf；只读源码及日志，在 `/tmp` 做实际进程控制，未改工作区源码/配置、未 CI。等待 B 独立设计验证与实际 GLM 设计批准后才实施。

## 已知与未知

64db Windows census case37 在 `desktop-mcp-snapshot-825.test.mjs:147` 的 `spawnSync(cl.exe, ..., timeout:20000)` 报 ETIMEDOUT，case27.975s；新主错误保留与 AST case38、generator 已 PASS。当前 compiler 的 stdout/stderr 默认 pipe，cwd 为随后要删除的 owned temp root。此前 native 日志有 root rmdir EBUSY，postjob 留下 vctip/link。

这些不能证明 cl/link 的编译内部耗时、管道持有者或目录锁持有者。native 同 head 的当前进展需按其实际日志判断，不能从 census 复制失败。下面提出的是有受支持调用链和真实控制支撑的候选机制修正，不是历史 MSVC 物理根因认定。

## 官方证据

精确 Node22.23.4 的 `spawn_sync.cc:578–605` 明确处理直接子进程已退出、后代继承 stdio pipe 的情况：超时仍可设置 ETIMEDOUT，并关闭本端 pipe。`OnExit` 只保存退出状态。因此 `error=ETIMEDOUT` 可以与 `status=0` 并存；不等于原直接子进程一直在编译。[Node22.23.4 实际源码](https://raw.githubusercontent.com/nodejs/node/v22.23.4/src/spawn_sync.cc)

对应版本文档说明 spawnSync 等待 fully closed，close 晚于 exit，原因包括多个进程共享 stdio；stdio 数字 fd 会共享已有文件描述符。该证据支持采用 regular file fd，不能据 status0 推断所有后代已结束。[Node22.23.4 文档](https://raw.githubusercontent.com/nodejs/node/v22.23.4/doc/api/child_process.md)

Windows 默认可继承 cwd，执行中的进程 cwd 被锁定，不能删除/移动/改名；pipe 的全部写 handle 关闭后，读端才见结束。这支持 owned cwd 与后代持 pipe 的具体可达路径。[Windows inheritance](https://learn.microsoft.com/en-us/windows/win32/procthread/inheritance)、[SetCurrentDirectory](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setcurrentdirectory)、[pipe inheritance](https://learn.microsoft.com/en-us/windows/win32/ipc/pipe-handle-inheritance)

Node22.23.4 随附 libuv 的 Windows 普通 open 使用 FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE；这与执行中的 cwd 锁不同。文件 fd 方案仍应在实际 Windows 门验证删除行为，不能拿本机结果冒充 Windows 文件系统证明。[固定版本 libuv fs.c:431–444](https://raw.githubusercontent.com/nodejs/node/v22.23.4/deps/uv/src/win/fs.c)

MSVC 默认把 obj 写入 cwd，故 cwd 改为稳定仓库后必须显式 `/Fo` 指向 owned obj；`/Fd` 指定编译 PDB/idb 的 owned 位置。现有 cpp 与 `/OUT` 仍用绝对 owned 路径。[MSVC /Fo](https://learn.microsoft.com/en-us/cpp/build/reference/fo-object-file-name)、[MSVC /Fd](https://learn.microsoft.com/en-us/cpp/build/reference/fd-program-database-file-name)

## 两个真实进程实验

Node22.23.4，macOS。不是 Windows/MSVC 运行证据；所有进程只读写自身 `/tmp` owned 目录，无凭据。后代定时自然完成；独立实验最后等待它们完成再删除，不把该等待引入拟修产品测试。

1. `/tmp/cmspark-826-inherited-stdio-probe.mjs`，日志同名 `.log`：真实直接父进程 exit0，后代继承 stdout/stderr 并存活2秒。默认 pipe 的 spawnSync 在503ms报 ETIMEDOUT，**status0/signalnull**，父 exit marker 已存在、后代实际 alive。owned file fd 则36ms成功返回，后代尚未完成。之后两个后代都自然完成。
2. `/tmp/cmspark-826-inherit-runner-probe.mjs`，日志同名 `.log`：同父/后代放入真实 `node --test`。compiler 用 inherit 时，内层18.8ms status0、case已 PASS，外层 runner 却803ms ETIMEDOUT；后代仍持有外层捕获流。file fd 时内层18.8ms、外层69ms完整 PASS，后代尚未结束。故 inherit 会把 EOF 等待移到当前受支持的 runner 调用链，选择 file fd。

命令：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node /tmp/cmspark-826-inherited-stdio-probe.mjs
node /tmp/cmspark-826-inherit-runner-probe.mjs
```

## 最小实施范围与验收

只改新 CPU 测试单文件 `companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs` 的 compiler 调用与对应控制：

- compiler stdout/stderr 各一个固定 owned regular 文件，以 `wx+`/0600 打开；stdio 为 `['ignore',outFd,errFd]`，不新建 compiler pipe，也不继承外层 runner 流。
- compiler cwd 使用已知稳定 companion 仓库 root；cpp、Windows `/Fo` obj、`/Fd` PDB/idb、既有 `/OUT` exe 均明确位于本 case owned 目录。clang 单源的既有绝对 `-o` 保持。
- 原 `built.error===undefined`、`built.status===0` 守卫照常；不能用 binary 存在替代。失败断言才各读取最多64KiB现有日志字节，不等待 EOF/追加、不重试；读取诊断失败不能替换原 compiler 错误。
- 两个本端 fd 局部 finally 关闭，初次/第二次 open、spawn、断言失败也尝试关闭所有已开 fd。保留已有 primary 优先级；无主失败时关闭或删除失败照常失败。沿用原 outer cleanup 尝试，不新增清理等待、重试或进程树/PID 扫描。
- 原用例30秒、compiler20秒、exe6秒、原生MCP20秒、业务/权限/SDK次数、真实 worker/reader/BOOT/BigInt 控制不改；status0只描述直接编译命令返回，不宣称后代被回收。
- 固化同一真实父退出/后代持流实验，验证 file fd 不延后到后代 EOF；通过实际 callback/调用源码控制核 cwd、显式产物路径、fd close、失败有限日志与原 error/status 守卫。原 actual AST timeout+cleanup 保主错与 cleanup-only fail 继续通过；真实 CPU producer/reader 的所有原控制继续通过。

这是测试编译 I/O 与工作目录的局部修正。B → 实际 GLM 设计批准后才落源，落源机器验证后仍需 B source → GLM 门；之后 Windows 原门再证。如果同20秒仍失败，按新实际 error/status/有限日志继续定位，不加时、不 skip、不认旧原因已知。

### B 补充验收（已纳入实际 GLM 设计批准）

Windows CPU 门必须真实运行 live-descendant 的完整 owned 目录删除与 late-write 控制，不能只引用 share-delete 文档。实施采用原30秒 case 内的实际自有 Node 后代：IPC ready 确认 cwd 在稳定仓库且两个 inherited file fd 已写入，case 实际 rmSync 整个 owned 日志目录后，才发送 late-write 指令；后代回写并自然关闭后，通过仍开的 fd 校验 READY/LATE 字节。该控制无平台 skip、轮询、延时等待或额外时限；失败只终止手中自有 ChildProcess 并关闭 fd。

Root 另核固定 libuv `fs.c:1080–1138` 的 FileDispositionInformationEx/POSIX 删除路径，支持当前 Windowslatest/NTFS 有限设计；这不代替上述实际 Windows 控制，也不扩成旧 Windows/SMB 保证。设计批准记录 `/tmp/cmspark-826-stdio-scope-glm-design.md` 与 `.json`。
