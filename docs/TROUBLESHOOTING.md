# TROUBLESHOOTING

常见问题速查。

## Companion 相关

### "config.json corrupted"

```bash
rm ~/.cmspark-agent/config.json
# 重启 companion，会自动生成默认配置
```

### 端口 23401 被占用

```bash
# 查找并杀掉占用进程
lsof -i :23401
kill -9 <PID>

# 或直接杀 companion
pkill -f "dist/index.js"
```

### "No API key configured" 警告

设置环境变量或在 Extension 设置面板配置：
```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### 启动后 Side Panel 连不上

1. 确认 companion 正常：`curl http://127.0.0.1:23401`（应返回 WebSocket 升级响应）
2. 确认 Extension 已加载：`chrome://extensions` 中 CMspark 状态为"已启用"
3. 如果 Side Panel 显示断连提示，点击"重试"按钮

## Extension 相关

### "No tab with id 303" 错误

LLM 产生了幻觉 tabId。这是**可恢复错误**，Agent 会自动调用 `list_tabs` 获取真实 tabId 后重试。如持续出现，手动提示 Agent "请先调用 list_tabs"。

### Extension 加载失败

1. 确认已运行 build：`cd chrome-extension && npm run build`
2. 确认 `chrome-extension/build/chrome-mv3-prod/` 目录存在
3. `chrome://extensions` → "加载已解压的扩展程序" → 选择上述目录

### Extension 开发时热更新不生效

`npm run dev` 启动 plasmo dev server，然后在 `chrome://extensions` 点击刷新按钮。

### svgo 警告（非阻塞）

`npm run build` 时可能看到 svgo 相关警告，这是可选依赖缺失，**不影响功能**。

## Skill 相关

### 导入 Skill 失败

- 确认文件是 `.md` 格式且包含 YAML frontmatter（`---` 包裹）
- frontmatter 必须包含 `name` 字段
- 如果是 zip 导入，确认 zip 内包含 `SKILL.md` 文件

### Skill 激活后不生效

- 检查 Side Panel 的 Skills 面板，确认 skill 已勾选
- 检查 companion 日志（`~/.cmspark-agent/logs/`）中 skill 加载是否成功

## 日志位置

| 类型 | 路径 |
|------|------|
| Companion 日志 | `~/.cmspark-agent/logs/`（JSONL 格式，按日切分） |
| Extension 日志 | Chrome DevTools → Console（Side Panel 上下文） |

## 重置

完全重置 CMspark（清除所有数据）：

```bash
rm -rf ~/.cmspark-agent/
# 重启 companion
```

---

*持续更新，有新问题请补充。*
