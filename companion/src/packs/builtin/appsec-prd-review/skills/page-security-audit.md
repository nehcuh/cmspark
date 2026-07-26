---
name: page-security-audit
description: 已打开页面的被动安全 checklist
type: prompt_template
---

# 页面安全审计（被动）

在用户已打开的页面上做**只读**检查（get_page_html / get_page_text / screenshot）：

1. **敏感信息**：页面内嵌密钥、token、PII、调试堆栈
2. **前端风险**：明显的 DOM XSS sink、未转义注入点、危险 postMessage 来源
3. **传输与 Cookie 线索**：混合内容、明显 insecure cookie 标志（若可见）
4. **权限 UI**：管理功能是否暴露给未授权角色（基于可见控件）
5. **第三方脚本**：可疑外链脚本域

## 输出

- Findings：严重度 / 证据摘录 / 建议
- 明确标注「未做主动扫描 / 未验证可利用性」

不要请求端口扫描或 osascript；不要声称已完成动态 exploit。
