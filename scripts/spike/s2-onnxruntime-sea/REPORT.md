# S-2 门禁裁决报告 — onnxruntime-node 在 SEA 布局下可加载

> **结论：PASS**（一次通过，无需排障轮次）
> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 执行者：WP5 spike subagent

## 验证问题（plan §J）

onnxruntime-node 原生绑定在「SEA exe + esbuild external + 旁置 node_modules」布局下能否 require 并跑通 dummy session。

**裁决：能。** 原生 `onnxruntime.dll` 在 SEA 进程内加载成功，`InferenceSession` 创建并推理结果正确（`[1,2,3] + 1 → [2,3,4]`），exit code 0。

## 环境（实测）

| 项 | 值 |
|---|---|
| OS | Windows 11 x64 (MINGW64/Git Bash) |
| Node | v24.15.0（`C:\Users\HuChen\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node.exe`，与 cmspark 打包同一 runtime） |
| onnxruntime-node | 1.27.0（npm 官方 registry，`npm install` 19s 完成） |
| 原生库 | `bin/napi-v6/win32/x64/onnxruntime.dll` 25 MB（N-API v6 预编译，跨 Node 版本 ABI 稳定） |
| esbuild | 0.28.1（复用 `companion/node_modules/@esbuild/win32-x64/esbuild.exe`） |
| postject | 1.0.0-alpha.6（npx 拉取，与 build-windows-exe.ps1 同版本） |
| dummy 模型 | `dummy_add.onnx` 129 B，opset 17 / IR 8，`y = x + [1,1,1]`（`uv run --with onnx python make_dummy_model.py` 生成） |

## 打包管线（复刻 build-windows-exe.ps1 第 4 段）

```bash
export PATH="/c/Users/HuChen/AppData/Local/Programs/kimi-desktop/resources/resources/runtime:$PATH"

# 1. 依赖 + dummy 模型 + dev 健全性检查
npm.cmd install onnxruntime-node --no-audit --no-fund     # added 17 packages in 19s
uv run --with onnx python make_dummy_model.py             # saved dummy_add.onnx
node index.js                                             # dev 模式 PASS（见下）

# 2. esbuild bundle（external onnxruntime-node，与 companion 同参数风格）
esbuild.exe index.js --bundle --platform=node --target=node22 \
  --external:onnxruntime-node --outfile=dist/bundle.js    # 2.2 kb

# 3. SEA blob
node --experimental-sea-config sea-config.json            # sea-prep.blob 6590 B

# 4. 复制 node.exe + postject 注入
cp <runtime>/node.exe dist-app/s2-ort-sea.exe
npx.cmd --yes postject@1.0.0-alpha.6 dist-app/s2-ort-sea.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
#   -> "Start injection... warning: The signature seems corrupted! 💉 Injection done!"
#   （签名警告与 repo 管线无 signtool 时行为一致，良性）

# 5. 旁置 node_modules + 模型（与 exe 同目录）
cp -r node_modules dist-app/node_modules
cp dummy_add.onnx dist-app/

# 6. 运行
./dist-app/s2-ort-sea.exe
```

## 关键输出（原文摘录）

dev 模式（`node index.js`，exit 0）：

```
[s2] isSea: false
[s2] bare require('onnxruntime-node'): OK
[s2] onnxruntime-node version: 1.27.0
[s2] session created. inputNames: [ 'x' ] outputNames: [ 'y' ]
[s2] output y: [ 2, 3, 4 ]
[s2] RESULT: PASS (expected [2,3,4])
```

SEA 模式（`dist-app/s2-ort-sea.exe`，exit 0）：

```
[s2] node: v24.15.0 platform: win32 arch: x64
[s2] isSea: true
[s2] execPath: C:\...\dist-app\s2-ort-sea.exe
[s2] bare require('onnxruntime-node'): FAIL -> ERR_UNKNOWN_BUILTIN_MODULE
[s2] Module.createRequire(process.execPath)('onnxruntime-node'): OK
[s2] onnxruntime-node version: 1.27.0 at C:\...\dist-app\node_modules\onnxruntime-node
[s2] modelPath: C:\...\dist-app\dummy_add.onnx exists: true
[s2] session created. inputNames: [ 'x' ] outputNames: [ 'y' ]
[s2] input  x: [ 1, 2, 3 ]
[s2] output y: [ 2, 3, 4 ]
[s2] RESULT: PASS (expected [2,3,4])
```

## 产物哈希（sha256）

| 文件 | sha256 |
|---|---|
| `dist-app/s2-ort-sea.exe` | `15d8671432f7ca106f6f045175f7ab3bd514e5c91e800a1aa9dc0f10357f6984` |
| `dist/bundle.js` | `c4d666e6f6bafb656cddff300c93a092ee5569c01425faf517f315e01dd4796d` |
| `dummy_add.onnx` | `2151ec6b8c0a34be22b73218602e4aaa939e45dbae63b4141bdec5f972a4b4e4` |
| `onnxruntime.dll` (win32/x64) | `273f9ef9cf755c6a0f342226a80448156c10ceb74db2ae8c8370dc98e75af0eb` |

## 实测发现（对 WP5 有约束力的事实）

1. **SEA 主脚本裸 `require()` 无法加载 npm 包**：报 `ERR_UNKNOWN_BUILTIN_MODULE`（SEA 主脚本 require 只解析内建模块）。**必须**走 `Module.createRequire(process.execPath)` —— 与 `companion/src/tray/systray2-bridge.ts:310-320` 既有先例完全一致，E4 先例成立。
2. **ABI 无问题**：onnxruntime-node 1.27.0 预编译绑定是 N-API v6，Node v24.15.0 直接加载成功，无需 recompile。
3. **模型文件按磁盘文件读取**（`fs.existsSync` 可见、`InferenceSession.create(路径)` 成功），不需要 SEA assets 机制 —— WP5 模型放 exe 旁/下载目录即可。
4. **体积事实**：onnxruntime-node 全平台包 259 MB（node_modules 含 linux/mac/win 全架构）；**win32/x64 实际所需仅 4 个 dll 共 ~62 MB**（onnxruntime.dll 25 MB + DirectML.dll 18 MB + dxcompiler.dll 18 MB + dxil.dll 1.5 MB）。WP5 打包必须按架构裁剪。
5. postject 注入时的 "signature seems corrupted" 警告良性（未去 Authenticode 签名直接注入），exe 正常运行；与 repo 管线在 signtool 缺失时的行为一致。

## 对 WP5 的影响

- **E4（SEA + 旁置 node_modules 加载原生模块）先例成立**，onnxruntime-node 可直接纳入 WP5 打包方案。
- WP5 集成代码必须复用 `Module.createRequire(process.execPath)` 模式加载 onnxruntime-node（裸 require 在 SEA 下必败）。
- 建议 WP5 打包脚本裁剪 `bin/napi-v6/win32/x64/` 以外架构，旁置体积从 259 MB 降到 ~62 MB。
- 排障轮次：0（一次通过）。风险登记：无 ABI/路径/ASAR 类阻塞。

## 复现

全部脚本在本目录（`scripts/spike/s2-onnxruntime-sea/`）：`package.json`、`index.js`、`make_dummy_model.py`、`sea-config.json`。二进制（node_modules/dist/dist-app/*.onnx/*.exe/*.blob）已 gitignore。按「打包管线」一节命令原样执行即可复现。
