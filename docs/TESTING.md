# TESTING

## 测试架构

| 端 | 测试框架 | 测试目录 | 运行命令 |
|----|---------|---------|---------|
| Companion | `node:test` (内置) | `companion/tests/` | `npm --prefix companion test` |
| Extension | `node:test` (内置) | `chrome-extension/tests/` | `npm --prefix chrome-extension test` |

Companion 测试编译配置：`companion/tsconfig.test.json`（rootDir: `.`，outDir: `.test-dist`）

## 运行测试

```bash
# Companion（全部）
npm --prefix companion test

# Companion（单个文件）
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/adapter.test.js

# Extension
npm --prefix chrome-extension test
```

## 测试结构

```
companion/tests/
├── security-thread.test.ts   # 安全策略 + 线程状态 + 日志（17 用例）
├── adapter.test.ts           # LLM 适配器 context 构建 + tool result 链接（10 用例）
├── skill-engine.test.ts      # 技能加载/激活/导入/导出（21 用例）
└── server.test.ts            # 消息路由 + 安全预检 + 辅助函数（15 用例）

chrome-extension/tests/
└── sidepanel-state.test.ts   # Reducer + 初始化请求 + 未知 action（6 用例）
```

## 新增测试

### Companion

1. 在 `companion/tests/` 创建 `your-module.test.ts`
2. 使用 `node:test` 的 `test()` 和 `node:assert/strict` 的 `assert`
3. 如果需要临时目录，参考 `adapter.test.ts` 的 `fs.mkdtempSync` 模式
4. 通过 `await import("../src/your-module")` 动态导入源码
5. `before` 中设置 `process.env.HOME = tempHome`，`after` 中 `fs.rmSync(tempHome)`

### Extension

1. 在 `chrome-extension/tests/` 创建测试文件
2. 测试纯函数（reducer、工具函数），不测试 React 组件
3. 如需测试 store，导入 `agentStore` 的 reducer 和 initialState

## 测试原则

- **纯函数优先**：优先测试可独立调用的函数（如 `classifyError`、`createToolResultMessage`）
- **边界覆盖**：happy-path + 空输入 + 非法输入 + 边界值
- **不测 UI**：React 组件不在此处测试，通过 QA 技能手动验证
- **不测外部 API**：LLM 调用通过 mock 或跳过

---

*Phase 1 测试补全于 2026-05-29。*
