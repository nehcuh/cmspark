# #321 PR-3 · 截图证据（rail / 断连 / 菜单 / toast）

> Reproduce：`chrome-extension/scripts/render-pr3-shots.mjs`（esbuild bundle 真实组件 →
> `.shot-out/pr3-*.html`）→ 本地 http 服务 + headless Chrome 截图。见脚本头注释。

| 截图 | 场景 | 验收点 |
|---|---|---|
| `pr3-empty.png` | 空态 idle（connected） | rail 品牌点 `CompanionMark 16` 常驻；rail 高度 48px；对话区上方干净 |
| `pr3-disconnected.png` | 断连 | rail 断连态 = 被动 `role=status` pill（无跳设置第二 CTA）；唯一主入口 = 底部「Companion 未连接 / 重新连接 + 查看日志」横幅 |
| `pr3-menu.png` | ⋯ 菜单展开 | 菜单按 会话 / 能力 / 诊断 三组；「导出为 Markdown / NotebookLM 导入 / 离线导出当前页」同屏可见（NB 已改中文名） |
| `pr3-toast.png` | toast 连发 3 条 | 单队列纵向排布（info / warning / error 三类底色），互不叠罗汉；位置在 rail 下方（非 `top:52` 固定） |

## before/after 结构说明

| 面 | before（main） | after（本 PR） |
|---|---|---|
| rail 品牌 | 「CMspark」字标（maxWidth 96，巡航/断连时整个消失） | `CompanionMark size=16` 品牌点**常驻**（巡航/断连不藏）；rail 高度不变 48px，宽度缩减 |
| ⋯ 菜单 | 8 项平铺 + 分栏线；「导出当前页 (NB)」英文缩写 | 会话/能力/诊断 三组头；NB 项改「离线导出当前页」；日志并入诊断组 |
| 断连 | rail 药丸按钮（跳连接设置）+ 底部横幅双主入口 | rail 被动状态 + 底部横幅唯一主 CTA（消双喊）；connecting 仍留药丸进设置 |
| toast | 单条 `top:52` 硬编码定位，无类型 | 单队列组件（info/warning/error 样式）；位置锚 rail 下方零高槽位，与 rail 高度解耦 |

## 像素实测（worst-case 巡航+断连，320px 宽）

```
rail min-height（CSS 未变）= 48px
BEFORE rail 渲染高度 48px · overflow no · 字标约 60px
AFTER  rail 渲染高度 48px · overflow no · CompanionMark 16px
toast = absolute overlay，锚 rail 下方，不进 rail 度量面
```
