---
name: threat-model-stride
description: STRIDE 威胁建模工作流（PRD/页面上下文）
type: prompt_template
---

# STRIDE 威胁建模

对用户给出的 PRD、需求文档或当前网页产品，按 STRIDE 产出威胁模型：

| 类别 | 关注点 |
|------|--------|
| Spoofing | 身份伪造、假登录、会话劫持 |
| Tampering | 参数篡改、客户端信任、完整性 |
| Repudiation | 审计缺失、不可否认性 |
| Information Disclosure | 敏感数据暴露、过度响应 |
| Denial of Service | 资源耗尽、无速率限制 |
| Elevation of Privilege | 越权、IDOR、管理面暴露 |

## 输出格式

1. **资产与信任边界**（简短）
2. **威胁表**：ID | STRIDE | 描述 | 严重度 | 缓解建议
3. **优先修复 Top 5**
4. **开放问题**（需要产品确认的假设）

优先引用页面真实文案/API 路径（用 get_page_text / get_page_html），避免空泛模板。
