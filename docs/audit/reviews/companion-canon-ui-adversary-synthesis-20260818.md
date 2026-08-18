# Companion-canon UI — 五路独立对抗合成

**Batch**: `companion-canon-ui-20260818`  
**Blast**: T2（L0/L1 呈现 chrome）  
**确认序**: 五路互不见 → 本文件合成 → **用户裁 1–2 叉** → 再实现 → 实现后另开对抗（禁止同会话自 APPROVE）

## Capability declaration

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入）
L2-classes:   (none new)
Compose:      装配 entry chrome only
Autonomy:     none
Trust:        settings 可发现；急停不得埋
Channel:      unchanged
```

## Machine

| Check | Result |
|-------|--------|
| `tsc --noEmit` (chrome-extension) | PASS (0) |
| `npm --prefix chrome-extension test` | PASS 703 |
| Diff scope | Side Panel empty/rail/composer + PRODUCT/DESIGN + 2 tests |

## 五路 VERDICT（互不见）

| 路 | 角色 | VERDICT |
|----|------|---------|
| A | JTBD / 产品工作 | **REJECT** |
| B | 呈现 / 看山工艺 | **REJECT** |
| C | 文案 / IA | **REJECT** |
| D | 密度 / 残留仪器台 | **REJECT** |
| E | 安全 / 发现性 | **REJECT** |

共识：**好看的空态成立；Operate 第一屏不成立。**

## 跨路共识（≥3 路）

1. **`hasMessages` 戏服**（A/D/E）：空态藏 Mode / 连接字 / ⋯ / chips，第一条消息再倾倒。320px 工作栏装不下这套回潮。
2. **`createBlankThread` 毒默认**（A/D/E）：新对话写入 DeepSeek + 空 `api_key` + 空 `trusted_domains`。这是实现 bug，**不是设计叉**，实现轮必修。
3. **装配三门 + 行话**（A/C）：空态句子、输入图标、事后 chips 三处；「装配」无白话 gloss。
4. **第一屏是看山闲聊，不是 Agent**（A/B/C）：`随便聊两句` + L0 也说「操作当前标签」。
5. **设置/配对发现性**（A/C/E）：齿轮无字；gear 进 **模型** 不是连接/配对；未配对无角标。
6. **L1 默认空态仍有 FocusBand 网页条**（B）：看山第一屏是 rail → 角色，中间不该有仪器条。

**急停本身未被埋**（E 确认 FocusBand 优先级仍在）。REJECT 不是急停，是第一屏 Trust/Recover。

## 不提交给用户的实现必修（无分叉）

- `createBlankThread` 继承 `state.config`，禁止硬编码 DeepSeek
- ⋯ / attach 补 `aria-label`
- 修死链文案：`/场景`、`⋯「编排」`
- 空态 gear 应落到连接/配对或带未配对提示，而不是静默打开模型

## 请用户只裁这两叉

### 叉 1 — 空态顶栏策略

- **C′ 看山空态**：空着继续藏 Mode/⋯/chips；接受第一条消息后顶栏变密
- **C″ 一条栏用到底**：空着和工作时同一条栏（设置 + 新对话 + 历史；Mode/连接用极小声，不倾倒）

### 叉 2 — 第一屏在说什么

- **D′ 继续暖**：保留「接下来想做什么 / 随便聊 / 畅所欲问」
- **D″ Agent 诚实**：L0 不说操作标签；L1 才是页任务；拿掉或降级「随便聊」

## 用户裁（2026-08-18）

- **叉 1 → C″** 一条栏用到底  
- **叉 2 → D″** Agent 诚实  

实现轮按此两叉 + 上方「无分叉必修」。实现后另开对抗，禁止本会话自 APPROVE。
