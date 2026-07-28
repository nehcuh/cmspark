# 开发环境搭建

## 前提

- **Node.js ≥ 20**（与 README / CI / TESTING 一致；推荐 `nvm`）
- Chrome 浏览器（Manifest V3）
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
# 全部
make test

# 分端
npm --prefix companion test
npm --prefix chrome-extension test

# Companion 单文件（先 tsc 再 node --test）
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/security-thread.test.js
```

测试地图与领域分组见 **[docs/TESTING.md](docs/TESTING.md)**（含 computer / host-use / orchestrator / board / mcp 等）。

## 项目结构

```
cmspark/
├── chrome-extension/           # Plasmo + React (MV3)
│   ├── src/
│   │   ├── sidepanel/          # Side Panel UI（Chat / Packs / Board / Apps / MCP / NotebookLM…）
│   │   ├── background/         # Service Worker：CDP、WS、NotebookLM 编排、Cockpit 窗
│   │   ├── cockpit/            # Confirm Center 宽窗
│   │   ├── notebooklm/         # NotebookLM 抽取 / RSS / YouTube 等
│   │   ├── tabs/               # cockpit.html 入口
│   │   └── popup/
│   └── tests/
├── companion/                  # cmspark-agent (Node.js + TypeScript)
│   ├── src/
│   │   ├── server.ts           # WS 服务器 + tool 调度
│   │   ├── message-router.ts
│   │   ├── llm/                # 适配器 / 抽取 / vision
│   │   ├── bridge/             # tool-definitions / schemas / tab-resolver
│   │   ├── skills/ · threads/ · history/
│   │   ├── security*.ts        # L2 确认 · 策略 · HMAC token
│   │   ├── mcp/                # MCP client / manager / aggregator
│   │   ├── computer/           # Computer Use（坐标 · session-trust · estop）
│   │   ├── host-use/           # Host 读写 · 平台 adapter（darwin/win/linux）
│   │   ├── apps/               # 应用白名单 · 启动 · 生物识别门
│   │   ├── orchestrator/       # Multi-agent：spawn · tab-lease · fleet
│   │   ├── board/              # Mission Board
│   │   ├── packs/              # Mission Pack 引擎 + builtin
│   │   ├── capability/ · netsec/
│   │   ├── obsidian/ · tray/ · hud/ · daemon.ts
│   │   └── …
│   └── tests/                  # node:test（见 docs/TESTING.md）
└── docs/                       # 文档（导航：docs/README.md）
    ├── README.md
    ├── architecture.md · GOAL.md · DESIGN.md · TESTING.md
    ├── mcp.md · mission-pack-usage.md · confirm-center-user-guide.md
    ├── computer-use-user-guide.md · host-and-apps.md
    ├── notebooklm-user-guide.md · multi-agent-user-guide.md
    ├── adr/                    # 001–018+
    ├── superpowers/            # 进行中 specs/plans
    └── decisions/              # 过程稿（非唯一规范；被代码引用的勿盲删）
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
- **产品版本**以 companion / chrome-extension `package.json` 为准（文档写 0.3.0 时勿回退叙事）

## 文档 Checklist（功能 PR 合并前）

见 [docs-reorg-plan §7](docs/docs-reorg-plan-2026-07-28.md)：

- [ ] **用户可见？** → 根 [README.md](README.md) 能力矩阵或 FAQ 是否需要一行？
- [ ] **有操作步骤？** → 用户指南（`docs/*-user-guide.md` / `mcp.md` / `mission-pack-usage.md` 等）或 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)？
- [ ] **架构边界变了？** → [architecture.md](docs/architecture.md) / 新或改 ADR？
- [ ] **安全模型变了？** → ADR-006/007/010/017/018 等？
- [ ] **新增测试？** → [TESTING.md](docs/TESTING.md) 地图是否点名？
- [ ] **关闭了 RFC/decision？** → 状态戳记 + 计划归档（`docs/archive/`，Phase 4）？
- [ ] **导航？** → [docs/README.md](docs/README.md) 表是否要加一行？

约定：

- 新用户可见能力 → README 矩阵 +1 行 + 用户指南或「见 ADR」。
- 架构决策 → `docs/adr/`；过程对抗评审 → `docs/decisions/`，**禁止**当唯一规范。
- 功能 shipped → 更新 ADR 状态（Proposed → Accepted → Implemented）。

## 安全 Checklist

### 添加新 npm 依赖时

- [ ] 检查依赖的维护状态（最后更新时间、issue 响应速度）
- [ ] 检查是否有已知安全漏洞（`npm audit`）
- [ ] 如果依赖包含预编译二进制（如 `systray2`），评估供应链风险
- [ ] 如果依赖包含预编译二进制，考虑是否需要加入 SHA256 校验流程

### 升级 systray2（含预编译二进制）

systray2 包含跨平台的预编译 Go 二进制文件（`traybin/` 目录），是供应链攻击的高风险点。
**升级时必须执行以下步骤：**

1. 在隔离环境中安装新版本的 systray2
   ```bash
   cd companion
   npm install systray2@新版本
   ```

2. 计算新版本的二进制 SHA256 哈希
   ```bash
   cd companion/node_modules/systray2/traybin
   shasum -a 256 tray_darwin_release tray_linux_release tray_windows_release.exe
   ```

3. 更新 `scripts/systray2-sha256.json`
   - 修改 `version` 字段为新版本号
   - 更新各平台的 `sha256` 值

4. 验证校验脚本通过
   ```bash
   node scripts/verify-systray2.js --strict
   ```

5. 在 PR 中明确标注：
   - 升级的版本号
   - 二进制来源（npm registry 官方包）
   - 哈希值由谁独立验证（推荐至少 2 人验证）

6. **禁止**在单个 PR 中同时升级 systray2 和修改 `systray2-sha256.json` 以外的任何代码。

### 修改 `scripts/systray2-sha256.json` 时的审查要求

此文件是供应链安全的关键防线，任何修改必须经过：
- [ ] 独立验证：至少 1 名审查者亲自计算二进制哈希并比对
- [ ] 来源确认：确认二进制来自 npm registry 官方包（非镜像或手动上传）
- [ ] 版本锁定：确认 `version` 字段与实际安装的 systray2 版本一致

---

更多信息见 **[docs/README.md](docs/README.md)** · 供应链 [docs/supply-chain.md](docs/supply-chain.md)。
