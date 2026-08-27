## Summary

<!-- 用完整句子说明改了什么、为什么。 -->

## 关联 Issue

<!-- 需求设计 / 新行为必须有票：Closes #N 或 Refs #N。没有票先去建，模板 .github/ISSUE_TEMPLATE/design.md。纯 typo/bugfix 可写 n/a。 -->

- Closes / Refs #

## 能力声明（ADR-020）

> 规范：[docs/adr/020-capability-model-three-axes.md](../docs/adr/020-capability-model-three-axes.md)  
> 仅文档/测试/纯重构且无行为变更时可写 `Surface: n/a` 并在 Notes 说明。

```text
Surface:      L0 | L1 | L2 | n/a
L2-classes:   host_computer | host_read | host_write | host_app | shell | netsec | (none)
Compose:      skill | knowledge | mcp-server | pack | user-env | none
Autonomy:     single | multi-worker | board | n/a
Trust:        <none | domain | L2 | session-trust | biometric/nonce | enterprise-session | …>
Channel:      community | enterprise | n/a
```

**Notes（可选）**: <!-- 场景坐标、为何不是 Pack、为何需要新 UI/确认方言 -->

### 反模式自检

- [ ] 未新增 Side Panel **一级**常驻入口（或已说明为何 Pack /「更多」不够）
- [ ] 未新增确认方言（或已说明现有 L2 / 域 / CU 门不足）
- [ ] 未发明新 Agent runtime（或已有 ADR）
- [ ] 未把实验定位器当作写路径成功依赖
- [ ] 架构/文档未裸写「中层 Agent」（应写组合面 / Composition）

## 测试

- [ ] `npm --prefix companion test`（或相关子集）
- [ ] `npm --prefix chrome-extension test`（若改扩展）
- [ ] 新增/更新回归测（若修安全或协议）

## 文档

见 [CONTRIBUTING.md](../CONTRIBUTING.md) checklist：

- [ ] 用户可见 → README 矩阵 / FAQ
- [ ] 操作步骤 → 用户指南或 TROUBLESHOOTING
- [ ] 架构/安全边界 → architecture / ADR
- [ ] 测试地图 → TESTING.md（若新领域）
- [ ] 导航 → docs/README.md（若新用户文档）

## 风险与回滚

<!-- 安全、数据、兼容性；如何回滚 -->

## Review

- [ ] 需要 dual-review（安全 / L2 / god-mode / shell / MCP 确认绑定 / 协议）时已跑或计划 `scripts/dual-external-review.sh`
