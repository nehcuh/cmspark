# G7 — W1 后台键盘实验计划（grill Q10=A）

## Pass 标准

**微信**在非 key-window / 非 frontmost 时，合成 type 是否在输入框可见。

- Pass → 保留 Phase 2「后台注入」研究价值  
- Fail → 产品默认坚持 **P1 agent raise + P4 不承诺微信写**

## 方法（人工 lab）

1. 微信打开「文件传输助手」，输入框可编辑  
2. Chrome 侧栏置前（微信失去 frontmost）  
3. 分别测：SkyLight type / HID type / 无 raise  
4. 记录：可见字符？/ 需 raise？  
5. 写入 `docs/decisions/v1.3/computer-use-keyboard-experiment-results-*.md`

**非目标**：本实验不作为 v1 黄金路径通过条件。

## G8 — TinyClick / SkyLight 冻结

2 周内：

- 不将 SkyLight/TinyClick 作为「发消息」成功依赖  
- 不扩大 coordinate 默认路由  
- 崩溃级 hotfix 可独立闸，不进黄金路径 KPI  
