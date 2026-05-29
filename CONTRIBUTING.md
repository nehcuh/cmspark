# 开发环境搭建

## 前提

- Node.js >= 20
- Chrome 浏览器
- npm

## 快速开始

```bash
# 1. 安装依赖
make install

# 2. 构建并启动 Companion
cd companion && npm run build && npm start

# 3. 启动 Extension 开发服务器
cd chrome-extension && npm run dev

# 4. 加载 Extension 到 Chrome
# chrome://extensions → "加载已解压的扩展程序" → chrome-extension/build/chrome-mv3-prod/
```

或使用一键命令：
```bash
make dev
```

## 运行测试

```bash
make test
```

## 项目结构

```
cmspark/
├── chrome-extension/    # Chrome Extension (Plasmo + React)
│   ├── src/
│   │   ├── sidepanel/   # Side Panel UI
│   │   ├── background/  # Service Worker (CDP, tabs, WebSocket client)
│   │   └── popup/       # 工具栏弹窗
│   └── tests/           # Extension 测试
├── companion/           # Companion CLI (Node.js + TypeScript)
│   ├── src/
│   │   ├── server.ts    # WebSocket 服务器
│   │   ├── llm/         # LLM 适配器
│   │   ├── skills/      # 技能引擎
│   │   ├── threads/     # 线程管理
│   │   ├── bridge/      # 工具定义与调度
│   │   └── history/     # SQLite 操作历史
│   └── tests/           # Companion 测试
└── docs/                # 项目文档
    ├── GOAL.md
    ├── architecture.md
    ├── DESIGN.md
    ├── TESTING.md
    └── adr/             # 架构决策记录
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `make dev` | 一键启动开发环境 |
| `make test` | 运行全部测试 |
| `make build` | 构建所有 |
| `make clean` | 清理构建产物 |
| `npm --prefix companion start` | 启动 Companion |
| `npm --prefix companion test` | Companion 测试 |
| `npm --prefix chrome-extension test` | Extension 测试 |

## 提交规范

- 提交信息用中文描述变更内容
- 功能变更前先补测试
- 重构前确保现有测试通过

---

更多信息见 `docs/`。
