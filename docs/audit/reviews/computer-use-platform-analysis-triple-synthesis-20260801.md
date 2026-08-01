# 电脑操作平台分析 — 三路复审合成（2026-08-01）

## Verdict

| Reviewer | Verdict | Confidence (self) |
|----------|---------|-------------------|
| Claude | **APPROVE_WITH_NITS** | (see file) |
| Pi | **APPROVE_WITH_NITS** | high |
| Kimi | **APPROVE_WITH_NITS** | 92% |
| Combined | **`both_ok` 三路通过** — 分析可作为后续实现指导 | |

Artifacts:
- `computer-use-platform-analysis-20260801.md`（主报告）
- `computer-use-platform-analysis-claude-20260801-213609.md`
- `computer-use-platform-analysis-pi-20260801-213609.md`
- `computer-use-platform-analysis-kimi-20260801-213609.md`
- Prompt: `computer-use-platform-analysis-triple-review-prompt-20260801.md`

## Agreement（三方一致）

1. **Grok = shell 编码 Agent**，非 CU 产品；用户体感来自 always-approve + 终端 TCC。  
2. **CMspark 产品方向正确**（fail-closed、L2、身份统一）；**交付拓扑未闭环**（CLI 绿 ≠ host_computer 绿）。  
3. **Windows 更好 ≈ 平台无 TCC 墙**，非架构优越。  
4. **estop fail-closed 放大故障** = 根因 #1 级。  
5. **R1–R5 均未触发** — 无误导性「已修好」或「教勾 node」主张。  
6. 业界：云沙箱 / 单一签名身份 / HITL — 对本地产品 **约束有效**，不强制 CMspark 改云。

## Nits to fold（下次改报告或实现时）

| Source | Nit | Action |
|--------|-----|--------|
| Pi | estop 连上后是长驻，非「短命」 | 措辞：daemon **spawn 上下文** ≠ CLI |
| Pi/Kimi | shell_exec+screencapture 仍可走 node TCC | 分析中显式并列第二路径 |
| Claude/Kimi | 根因 #1 拆成「tap 失败」vs「硬门全灭」 | 修订排序表 |
| Kimi | `2c1437f` 合 main 写进路线图 | 执行项 |
| Pi | Developer ID = 商务阻塞 | 标 P1 商务 |
| Claude | Windows 对等安全一句话 | 路线图补一行 |
| All | 输入监控验证 | 路线图显式项 |

## Blocking

**None** for accepting the analysis as strategic SoT.  
**Device** host_computer remains blocked (separate engineering track).

## Next engineering (from analysis + reviews)

1. Instrument Side Panel path: bin + CDHash + stderr  
2. Tray-owned long-lived estop (Companion only connects)  
3. Merge `2c1437f` (+ follow-ups) to main  
4. Developer ID pipeline  
5. Human DoD: Side Panel 批准后非 Chrome 截图成功  
