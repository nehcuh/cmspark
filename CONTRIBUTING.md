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

更多信息见 `docs/`。
