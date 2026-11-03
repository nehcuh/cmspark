# #826 Windows CPU 编译门与清理首错：有限修正交接

2026-11-03，基于 fc4a2546a09f96c5afb6de3192e3388659a65118。B 已独立验证设计并 APPROVE（`/tmp/cmspark-826-cpu-fix-independent-design-review.md`）；本文为作者实施交接，等待 B 源码复审与 GLM 门。未 stage、commit、push 或发起 CI。

## 事实与修正

fc4a2546 的 Windows census 在真实 `cl.exe` 20000ms 门产生 ETIMEDOUT；Windows native case37 只报告最外 finally 的 EBUSY rmdir。native 的主体原错被遮住，不能从 census 反推同一原错。postjob 的 link/vctip 存活也不能证明目录持有者、继承管道或编译内部原因。

仅改 `companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs`：

1. 去除 CPU 叶子的 fstream/filesystem/iostream/map 四个辅助头。Json 叶子只保存原 wire 所需 id；seed 用 C stdio 读取，短 seed 用 Windows CRT `_chsize_s` / POSIX `ftruncate`，wire 用 fwrite/fputs。真实 snapshot header、worker、record/flush/emit/send 与 Node reader 完全保持。
2. 最外 local catch 保存原主体错误并重抛；finally 仍执行原 rmSync。如果清理也失败，保留原主体失败；如果没有主体失败，清理错误照常使测试失败。没有新增重试、skip、清理预算或生命周期框架。
3. 新增真实 callback AST 回归：以原编译调用口返回 ETIMEDOUT，并让原 cleanup 失败 EBUSY；结果保留原 ERR_ASSERTION，其 actual 仍为同一个 timeout Error，且确认 cleanup 已尝试。执行实际 finally 的无主失败控制仍抛同一个 cleanup Error。

原用例 30000ms、编译 20000ms、程序 6000ms 与原 status/error 断言、所有业务/wire/UNKNOWN/BigInt 控制不变。没有改编译调用、SDK/COM 调用次数、生产文件、配置、权限或 Windows 原生 MCP 20 秒门。同步进程返回/错误只对应原接口所见直接子进程信息，不作为所有 link/vctip 后代已结束或目录已释放的证明。

## 实际验证

Node22.23.4，macOS；在 `companion/`：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node --test scripts/tests/desktop-mcp-snapshot-825.test.mjs
node --test scripts/tests/desktop-build-windows-480.test.mjs
```

- 定向 **3 PASS / 0 FAIL**：`/tmp/cmspark-826-cpu-compile-cleanup-final.log`。
- 原构建契约集成入口 **178 PASS / 0 FAIL**：`/tmp/cmspark-826-cpu-compile-cleanup-integration.log`。
- `git diff --check` PASS。没有 TS 或产品改动，复用其未变的编译证据。
- 设计前 `/tmp` 同源 baseline/slim 两版各 2 PASS；作者单次 clang 编译428→348ms，B 独立408→400ms。只据此确认辅助头依赖减少与控制语义相同，不把本机时长视为 MSVC 根因或性能保证。
- 主错遮蔽的旧/新实际 callback AST 控制：`/tmp/cmspark-826-primary-mask-probe.mjs`、`.log`，旧报告 EBUSY，新保留实际 ERR_ASSERTION(ETIMEDOUT)，两者均真实尝试清理。

Windows 修后尚未验证；如果其原门仍失败，必须保留失败继续定位，不放宽、skip、或凭本机结果认通过。当前冻结这一个源文件，待 B source → GLM → root 提交及一次有目的的 Windows 门。
