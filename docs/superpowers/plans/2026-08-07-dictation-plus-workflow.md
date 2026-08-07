# 听写+ 开发 Workflow（含双路复审）

> **日期**: 2026-08-07  
> **方法**: Subagent-Driven Development（任务实现） + **里程碑 Pi + Claude 双路复审**  
> **脚本**: `scripts/dual-external-review.sh <batch-id> <prompt-file> [base-commit]`

---

## 1. 里程碑与复审门

| 里程碑 | 内容 | 复审 |
|--------|------|------|
| **M0 设计** | SoT + ADR-024 + R1/R2 合成 | 可选 Pi（设计已对抗） |
| **M1 D1a 实现** | continuous Mode A + caps + tests | **必做 dual-external** |
| **M2 D1b** | ASR Refiner | **必做 dual-external** |
| **M3 D1c** | local 分段 | **必做 dual-external** |
| **M4 D2 / Mtg*** | 热键 / 会议 | **必做 dual-external** |

确认序（项目锁定）：

1. MACHINE 绿（单测/构建）  
2. 实现自检（非放行门）  
3. **`scripts/dual-external-review.sh`** → Claude + Pi 独立 VERDICT  
4. nits 吸收后再 merge  

---

## 2. D1a 双审 prompt 位置

实现合入前：

```bash
# 从 main 或 merge-base 出 diff，写入 prompt 后：
scripts/dual-external-review.sh dictation-plus-d1a \
  docs/audit/reviews/dictation-plus-d1a-dual-review-prompt.md \
  <base-sha>
```

---

## 3. 分支

- `feat/dictation-plus-d1a` — 本波  
- 后续 `feat/dictation-plus-d1b` 等可叠 PR  
