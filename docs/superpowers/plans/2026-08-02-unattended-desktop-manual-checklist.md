# 无人值守 M3 — 真机清单（微信）

> 在 Pi+Claude 终审通过且本地 build 后执行。不勾满不可对外宣称「微信零确认已交付」。

## 前置

- [ ] Companion / CMspark.app 含 M1 grant 代码  
- [ ] 扩展 `chrome-extension/build/chrome-mv3-prod/` 已 reload（含 M2 UI）  
- [ ] `computer.coordinateEnabled: true`  
- [ ] 微信在 Apps 白名单且 **允许坐标**  
- [ ] 系统权限：CMspark 屏幕录制 + 辅助功能  

## 验收金句（设计 §9）

| # | 步骤 | 预期 |
|---|------|------|
| 1 | 设置 → 运行自主度 → **无人值守** → 双勾选 →「我了解风险」武装 | 顶栏 **值守中 · 桌面** |
| 2 | 对话：在微信输入一段文字（`host_computer` type） | **无** initial L2 确认台 |
| 3 | 切换前台到其它 App 再让 agent 继续 | 仍可能 **foreground_yielded** 确认 |
| 4 | 点顶栏 **解除** | 徽章消失；再 type → **出现** initial L2 |
| 5 | 再武装 → 完全退出 Companion 并重启 → 重连 | 值守 **未** 自动恢复，须重新武装 |
| 6 | 仅开「网页巡航」不值守 | 微信 type 仍要 initial L2 |

## 自动化已覆盖（不必真机）

- unattended predicate / arm phrase / TTL / modelEnabled / coord floors  
- reL2ShouldPrompt PROMPT_ALWAYS  
- extension initial sync + tier chip unit tests  

## 签字

- 操作人：________  日期：________  
- 机型 / OS：________  
