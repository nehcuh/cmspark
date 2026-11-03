# #826 CPU leaf and primary error — actual GLM-Claude source gate

- Verdict: **APPROVE**, no blocker; permits committing the frozen single-file test increment for one purposeful actual Windows gate after coordinator gates.
- Base: `fc4a2546a09f96c5afb6de3192e3388659a65118`.
- Source: `companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs`; SHA256 `56f480a14e259d512c8c4338711e7a728b9939e9101e071d4395d4fefbbf2b7d`.
- Base-relative diff SHA256: `95abe9d47d0d7d69f5c6f1028e71f67607f5d363ab17f10022a4adc9d1d82cd6`.
- Prompt SHA256: `7696f8c75cfe0aca6b9a4f6ea7293056c8410818a834233ec5aa4e08cbd2e174` (96842 bytes).
- Actual CLI `2.1.153`, modelUsage solely `glm-5.3`, provider host `open.bigmodel.cn`, exit `0`, is_error false, one tool-free turn; duration `112979ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 25435, "outputTokens": 8468, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.338875, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Exact approval: “APPROVE,无 blocker,可提交以运行其实际 Windows 门。”
- No Windows/native/CI success, MSVC cause/speed guarantee, merge or release is approved.

## Coordinator factual clarification

The actual census VM reported compiler ETIMEDOUT. The native VM reported cleanup EBUSY; its masked body error remains UNKNOWN. The review's lane attribution must not be read as proof that native had the same body error. Also old `std::filesystem::resize_file` reports failure by exception; both old and new code retain a failure check. These clarify the model's explanatory wording without changing its explicit approval or inventing another API review.

## Actual reviewer response (verbatim)

**结论：APPROVE,无 blocker,可提交以运行其实际 Windows 门。**

逐块核对 diff 与冻结源一致,且仅限该单文件:

**C++ 叶子简化语义等价**。删 fstream/filesystem/iostream/map、增 cstdio 与 _WIN32 下 io.h。旧 JsonObject::Stringify 本就 `fields.at(L"id")` 只序列化 id,map 其余键是只写死数据;新叶子保存同一 id,线输出字节不变(本机 rows 断言实跑通过)。seed 读取由 fread 精确 128 字节并断言 count,与 ifstream gcount 等价;`find_last_of("\\/")+1` 在无分隔符时 npos+1 回绕为空串,与 parent_path 语义一致。mode8 改用 `_chsize_s`/`ftruncate` 且断言返回 0,较旧 resize_file 忽略返回是严格化。wire 改 fwrite/fputs 字节等价。真实 header/worker/emit/send 与 Node reader/copier 四哈希与已审基线一致,业务/wire/UNKNOWN/BigInt 控制未动。header 是否传递依赖被删头,POSIX 分支实编译已排除,Windows 分支由下一门真实验证,非当前可达回归。

**主错优先级修复正确且本地化**。catch 记录并重抛主体错;finally 仍执行原 rmSync;有主错时清理错被吞(不再遮蔽),无主错时清理错照常使测试失败——正是 census lane 中 EBUSY 遮蔽 ETIMEDOUT 缺陷的最小修复。新增 826 用真实 AST 提取该文件中 825 的**实际** callback(非副本),注入编译 ETIMEDOUT+清理 EBUSY,断言结果为 ERR_ASSERTION 且 actual 为同一 timeout 对象、rmSync 已尝试(removed==1);再以真实 finally 体在无主错时要求抛同一 cleanup(removed==2)。注入点在编译断言处,win32 与 POSIX 平台路径均走 mocked toolchain/spawnSync,跨平台确定。30s/20s/6s/native20s 全不变,无重试、skip、权限或预算放宽。

**边界声明**:本地 clang 双通过与 408→400ms 仅证 CPU 依赖减少与语义等价,不构成 MSVC 根因证明或 Windows 20 秒门性能保证;若该门仍 ETIMEDOUT 或 EBUSY,必须保留真实失败继续定位。本批准范围=提交此冻结单文件并运行一次有目的的实际 Windows 门,不含也不声称 Windows 原生/native/CI/merge/release 成功。
