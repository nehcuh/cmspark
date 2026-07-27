---
name: owasp-baseline
description: OWASP 基础检查参考（精简）
type: domain_knowledge
---

# OWASP 应用安全基线（精简参考）

## 认证与会话
- 无弱默认口令；会话 ID 旋转；登出失效服务端会话

## 访问控制
- 服务端强制授权；防 IDOR；最小权限

## 注入
- 参数化查询；输出编码；命令注入防护

## 配置与加密
- 关闭目录列表；HTTPS；敏感配置不进前端

## 安全头（参考）
- CSP、X-Content-Type-Options、Frame 保护、HSTS（视部署）

## 日志与监控
- 安全事件可审计；避免日志中的密钥

本知识库用于审查时对照，不替代完整 ASVS。
