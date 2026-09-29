diag: pi=/c/nvm4w/nodejs/pi
核实完毕（含突变验证）。工作区已还原干净（`git status` 对 `chrome-extension`/`companion` 为空，临时 worktree 已删）。

## 1. 出口闭合 — (a)(b)(c) 全部复现，但「既无盲区、也不假红」是 over-claim

基线：`companion` 该文件 12/12、extension `safe-evaluate-page-text` 25/25。

**逐点复现**（我自己的突变，各自还原后复测）：

| 突变 | 结果 | 判定 |
|---|---|---|
| (a) `IMAGE_FAMILY_ERROR_CODES.has(...)` → 7 个 `\|\|`（**保留导出**） | 12/12 绿 | ✅ 假红已消除 |
| (b) 新文件 `chrome-extension/src/background/tmp-mutant-image.ts` 发 `IMAGE_PIXEL_LOST` | 守卫红 | ✅ |
| (b') 同码放进 `src/sidepanel/utils/tmp-mutant.ts` | 守卫红 | ✅ 全树（`.ts`）成立 |
| (c) 从导出集合里删掉 `IMAGE_EXTRACT_FAILED` | 3 例红（2 行为 + 守卫） | ✅ |
| 附加：保留导出但删掉 classifyError 里的分支 | 行为例红（守卫仍绿） | ✅ 无语义空洞 |

(a) 的机制是结构性的：守卫现在只断言「导出集合 ⊇ extension 产出的码」，不再看 classifyError 形态。

**但盲区没消除干净，我复现了两处 green：**

- **`.tsx` 是盲区**：`chrome-extension/src` 下有 **77 个 `.tsx`**，walk 只收 `.ts`。把 `export const f = () => "IMAGE_PIXEL_LOST"` 放进 `src/sidepanel/TmpMutant.tsx` → **12/12 全绿**（守卫静默通过）。修法一行：`/\.tsx?$/`。
- **码名形状盲区**：正则 `"(IMAGE_[A-Z_]+|INVALID_DATA_URL|BLOB_URL_UNSUPPORTED)"` 漏掉不带 `IMAGE_` 前缀的同族新码。`.ts` 文件发 `"CANVAS_TAINTED"` / `"DATA_URL_TOO_LONG"` → **12/12 全绿**。这与被你修掉的「硬编码两文件」是同一类漂移（换名字就能绕过）。

**假红方向反而变宽了（可复现）**：在 `chrome-extension/src/background/tmp-comment-only.ts` 里只写一行**注释** `// TODO(#999): 未来也许该发 "IMAGE_PIXEL_LOST"`（完全不产出）→ **守卫红**。测试里那段注释自己点明了这个风险（「去注释：否则…会被误判成产出该码」），但代码没做任何剥注释；紧接着那句「无需先剥注释」是用**今天的树**证明一个**不变量**——扫描面从 2 文件扩到 156 文件后，这条假红通道是变宽而不是变窄。

**另有一条形态耦合（低危，附证据）**：把同一个 7 码集合的导出形态从 `ReadonlySet` 改成 `readonly string[]` + `.includes`（行为等价）→ 测试 **编译失败** `TS2339: Property 'has' does not exist`。修法：`Array.from(IMAGE_FAMILY_ERROR_CODES).includes(c)`（Set/数组都吃）。

## 2. `IMAGE_FAMILY_ERROR_CODES` 导出 — 未发现新问题

- 全仓无 `import * as security`；`companion/src` 10 个 importer 全是具名导入。
- `security.ts` **没有新增 import** → 不引入新环；新集合在模块初始化时建好，`classifyError` 只在调用期读，无 TDZ 面。唯一新 importer 是守卫测试。
- 打包：companion 走 `dist/index.js` + esbuild（`scripts/run-esbuild-bundle.mjs`），该模块本来就在图内，7 字面量 Set 的 tree-shaking/体积影响可忽略；`companion/dist` 未被 git 跟踪（打包时重建），所以发布产物自动带上。两侧 `tsc --noEmit` 均 exit 0。
- 唯一可说的：`ReadonlySet` 只是类型层只读，运行时是共享可变 Set——具名导出反而让它成为「进程级可变真相源」。现实里只有测试 import，不构成问题。

## 3. `TAB_ID_REQUIRED` 显式分支 — 有一条**未被声明**的窄路径变化

- 5 个产出站点（`browser-bridge :741/:747/:805/:808`、`tool-pregate:233`、`dual-entry:75`、`tab-lease:377`）的文案都不含 `Security Block`/`blocked by user`/`user denied` → **没有仓库内可达的 security 场景被翻掉**。理论上「带码 + security 文案」现在会判 recoverable（分支在 security 门之前），但这是 8 条既有码分支的共同性质，且今天不可达。
- **但真有一条判定变化**（用 base 编译产物 A/B 实测）：`tab-lease.ts:377` 的 `"tabId is required and must be a number"` —— 文案里**没有** `tab_id_required` 子串（下划线 vs 空格），base = `non_recoverable`，现在 = `recoverable`。可达性只在 `!Number.isFinite(tabId)`（调用点都先过 `typeof === "number"`，JSON 参数给不出 NaN），基本是防御性兜底。
- 结论：不是缺陷，但是**与第 6 条同构的未声明副作用**（你为 `SELECTOR_OR_TEXT_REQUIRED` 补了声明，这条没补）。建议 PR body 加一句，或写明「NaN-only 兜底」。

## 4. `"data:,"` 拒绝 — 不误杀，你的判断成立

- 4 条注入路径（IMG/CANVAS/VIDEO/SVG）全部 `.replace(/^data:image\/\w+;base64,/, "")` 剥前缀；退化画布 `"data:,"` 不命中正则 → 正是要拦的那个值。
- base64 字母表不含 `:`，所以**任何**合法剥离后的 payload 都不可能以 `data:` 开头 → 零误杀。
- fetch 侧（`analyzeImageFetch`）走 `fetchImageAsBase64`/`decodeDataUrlImage`/`bytesToBase64`，返回裸 base64，且**不经过**这段校验（`if (data.fetchSrc)` 分支提前 return）。
- 仅 P4 可选：`toLowerCase().startsWith("data:")` 可挡住页面自造的 `DATA:,`（`toDataURL` 只会小写，故非必需）。

## 5. 回归 — 数字全部对上

- extension `npm test`：**1498/1498，fail 0**（9.4s）；`npx tsc --noEmit` exit 0。
- companion 全量：675 例，**68 个唯一失败名 / 126 处 ✖**（你写 70，差 2 属环境抖动：Windows `symlink EPERM`、daemon 等），**security/classify/image/tab_id/wait_for/recoverable 命中 0**；唯一触及 security 的失败文件是 `config.test`（`H3` 原子写 0o600），我在父提交 worktree 上复现同样失败 → 预存在。
- 门禁 `bash scripts/tests/test-package-gates.sh`：**Results: 156 passed, 0 failed**。

## 7. M5 配对表 — 措辞对得上，但两格仍**没被走到**（第 7 条的完成度不足）

两条新措辞与生产逐字一致（`browser-bridge :798`、`:1062`）。但**没有任何测试对这两条路径调用 `hostImageFailure()`**——那两个用例（缺 selector / 缺 candidate_url）只断言 `data.error_code`。实证：把那两条措辞从 `HOST_IMAGE_ERROR_LITERALS` 里**再删掉**，extension 该文件仍 **25/25 全绿**。也就是说它们从「走不到」变成「可以走」，但没人走：`SELECTOR_OR_TEXT_REQUIRED` 的（码, 措辞）配对不变量仍然无测试钉住。修法 2 行：给那两个用例各加 `hostImageFailure(r)`。

（旁证第 5 条：base 上 `:744` 抛的是裸 `"No active tab found"`，base 编译产物判 `non_recoverable` → 你声明的「screenshot 无活动标签 从整轮终止变为可恢复」**属实**。旁证第 6 条：`SELECTOR_OR_TEXT_REQUIRED ∈ LOCATOR_MISS_CODES`，pivot 会 `recoverableFailureCounts.set(toolName, 0)`（adapter :2169-2170），阈值 3 → 预算 3→6，**属实**。）

**净结论**：四个实质改动我都独立复现通过、无 BLOCKING；但「既无盲区、也不假红」与「两格走不到已修复」两处仍是 over-claim（各有可复现反例：`.tsx`/非 `IMAGE_` 前缀码静默绿、注释假红、M5 两格仍无覆盖），另有一条未声明的窄路径判定变化。按第二轮同口径不升级、也不无保留 APPROVE。

VERDICT: APPROVE_WITH_NITS
PI3_EXIT=0
