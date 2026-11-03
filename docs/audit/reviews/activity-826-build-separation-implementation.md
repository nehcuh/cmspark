# #826 Windows CPU 构建/运行分离：实施交接

2026-11-03，base0666fc8d066ec6a0941c5edec865063a30692cf9。按 root 透明预算裁决、B 独立设计和实际 GLM 设计 APPROVE 实施。未 stage/commit/push/CI。Windows单位12文件已冻结，逐文件SHA/字节及11项输入hash见 `/tmp/cmspark-826-build-separation-source-manifest.json`。Mac修改/host-integrity本地pin/root文档均不属于此单位，未编辑。

## 预算与最终行为

Windows 新 CPU driver 编译从原30秒case里的20000ms调用，迁入既有 testFixtures build 的 `checked()` 120000ms契约；后置case30000ms只测runtime。**旧总/E2E边界确实扩大，不能称旧端到端时限不变。** Mac/Linux原case内20000ms编译与30000ms case保留；每exe6000ms、原MCP20000ms和所有原业务/权限/close/cleanup断言保留。

1. 新 `desktop-mcp-snapshot-cpu-driver-825.mjs` 是唯一pure generator：无test注册、无compiler/config import或顶层执行。真实旧driver的整个C++构造被移动，worker/header/record/flush/emit/send与受控OS叶不改；builder/runtime读取同一生成器。当前输出16851字节，SHA256 `64074f5ffd6d6ce4288dd9449b985c88c967ed0b33fe23e9487580b283b67ce8`。
2. 新 `desktop-mcp-snapshot-cpu-artifact-825.mjs` 只管理一个固定私有Windows夹具。`buildDesktopWindows` 的 testFixtures块直接调用一次；普通release build不调用。编译原flags及owned Fo/Fd/OUT/file-fd、稳定root cwd保留；不传timeout override，仍由原checked检查error与status、默认120000ms。
3. 在新编译前撤销旧manifest/binary；仅checked成功、两日志fd都关闭、实际输出regular/stable验证后，写固定 `acceptance/mcp-snapshot-cpu-825/probe.exe` 与manifest。编译error、nonzero、timeout或本端fd close失败均无有效manifest发布。
4. manifest由真实producer生成，绑定schema1、win32/x64/Node22.23.4、当前生成C++及11项固定输入hash、实际binary digest。输入包括实际C++/form/header/posix、各实际生成器及pure/编译参数模块/builder本身。consumer不信任manifest路径；只读固定目录/名字，严格字段/target/hash校验。文件普通/非link/single-link/限尺寸；named/fd两侧dev/ino/birthtimeNs/ctimeNs/mtimeNs/size/nlink全BigInt稳定复核；目录也用完整身份。hash与复制使用同一次打开读出的binary字节。missing/stale/partial/foreign/corrupt/identity不符都fail，不重新编译。
5. 新 `desktop-mcp-snapshot-cpu-runtime-825.mjs` 承载原完整case。Windows先消费验证产物，Mac/Linux仍编译；原9排程/same-wire/UNKNOWN/publication/BigInt/live-fd目录删除与latewrite全部保持。Windows分支无现场编译或fallback。
6. 早期helper继续pure/EOL/AST/交接负控；Mac/Linux原真实CPU case也继续在此执行。新TS `desktop-mcp-snapshot-cpu-825.test.ts` 在Windows明确注册非skip的30000ms真实runtime，亦由全census自动发现。现bootstrap/process测试命令只追加该compiled operand，原三个operand/顺序及build→TS→consumer条件保持，两Windows lane都执行。
7. 760在投影旧历史前，精确验证整个新命令及唯一新增operand；只在已验证后按原命令合成旧projection。750caller及760的missing/duplicate/substituted/wrong-lane/no-fixtures/先失败/顺序负控覆盖。未改任何旧sealed fixture/hash。

## 精确文件

修改 `.github/workflows/ci.yml`、`companion/scripts/build-desktop-windows.mjs`、`companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs`、`scripts/tests/native-ci-stages-760-contract.mjs`、`native-ci-stages-760.test.mjs`、`windows-ci-feedback-750.test.mjs`。

新增 companion 下 `scripts/desktop-mcp-snapshot-cpu-{driver,artifact,runtime}-825.mjs`、`scripts/tests/desktop-mcp-snapshot-cpu-build-826.test.mjs`、`scripts/tests/fixtures/mcp-snapshot-cpu-0666.json`、`tests/desktop-mcp-snapshot-cpu-825.test.ts`。0666 JSON为原真实method/cppDriver源的捕获基线，独立固定LF/CRLF两个字节hash，仅供源恒等对照，不是第二份实现或SDK返回。

## 当前机器证据

Node22.23.4，macOS：

```sh
# companion/
node --test scripts/tests/desktop-build-windows-480.test.mjs
npx tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --strict --skipLibCheck --types node tests/desktop-mcp-snapshot-cpu-825.test.ts
# repo root/
node --test scripts/tests/windows-ci-feedback-750.test.mjs scripts/tests/native-ci-stages-760.test.mjs
```

- 原480完整入口 **182 PASS / 0 FAIL / 0 SKIP**：`/tmp/cmspark-826-build-separation-480-final.log`。
- 750/760实际整段workflow消费者 **119 PASS / 0 FAIL**：`/tmp/cmspark-826-build-separation-workflow-final.log`。
- 新TS入口独立严格noEmit类型检查 PASS：`/tmp/cmspark-826-build-separation-entry-types.log`。未争用共享 `.test-dist`；按root要求，全Companion TSC等Mac单位freeze后合批一次，不在此冒称已做。
- `git diff --check` PASS。

原480入口中的新控制：

- pure输出与真实0666捕获producer在host/原fixture/header八种EOL组合下逐字相同；只有testFixtures块内一个build调用。
- 用实际checked函数及实际artifact producer/consumer，编译实际共享TU（本机clang叶）、消费真实产物；source drift/target OS/arch/Node/digest/partial/missing/hardlink/manifest link拒收。正向相同大inode允许读取；两个Number会折叠的不同大inode在binary read前拒绝。所有拒收用新空runtime目录，避免EEXIST伪通过。
- 实际producer分别经first/second open、spawn、nonzero、error+status0(timeout)、diagnostic read、close+primary、close-only负控；断言实际checked到达次数、全部fd尝试关闭、失败日志读取上限和manifest不发布。原non-Windows callback的主失败/cleanup-only控制保留。
- 本机将实际Windows runtime分支经受控process/platform与实际本机编译exe叶执行：完整9排程/BigInt/live-fd等原断言全部运行，compiler调用口主动拒绝任何编译；missing artifact经实际runtime传播ENOENT，不fallback。
- 新TS入口的真实源码注册/回调由端口执行，Windows恰一case/30000ms/无skip，其他平台保原MJS route；workflow两Windowslane命令完整通过及全部相反变体拒绝。

Windows早期artifact交接控制刻意使用受控compiler叶（复制固定系统exe字节且不执行它），避免在构建之前重复MSVC编译；本机则真正编译共享TU。这不冒充Windows C++成功。真正Windows C++由之后testFixtures构建、显式runtime及完整census实际验证；两lane修后结果仍未取得。

## 剩余门与范围

已发root/B冻结manifest，待合批TSC、B非作者source与实际GLMsource门。之后目的明确的新head两Windowslane仍须过实际build/runtime/native/census。当前事实不解释历史MSVC内部根因；若120秒build仍失败，保留失败继续定位，不自动扩时/skip。没有新泛缓存/框架/权限/CI入口、源目录obj产物、GLM调用、merge或release主张。
