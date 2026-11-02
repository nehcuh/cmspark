# #826 activity failure facts — actual GLM source gate

- Verdict **APPROVE**, confirms B independent source approval; no blocker.
- Base `d94d5db5ce30aee7d047baea53c0bc503f766461`; all six hashes in structured receipt.
- Manifest SHA256 `158cfad645881f6a4ec89d381c6d70722955703669c8baf68cb5d61bfd1219a3`; complete sixfile diff SHA256 `830441d10bde4b19d062990ad39dccaf7112024cc2a966fffe513d8072ef10b3`.
- Prompt SHA256 `b315d01dffd453f8c42735a4f10b9227a0e8f232249a33aa1277f589914a008e`; 160747 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `124571ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 41727, "outputTokens": 8690, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.425885, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Evidence is current actual19implementation tests/A+B reports and complete3source inverse against real d94 under LF/CRLF. Old34design model is not implementation proof.
- Original scope12reason/catch/fence, Apps6stages/6positivepoints, fixed gui/headless producer-reader path,10s/90s/180s/business/input/cleanup constraints remain.
- Permission: frozen sixfile commit and next purposeful changed-head canonical Windows run after coordinator gates. No native acceptance, historical cause, extra MCP probe, budget/input/permission expansion, merge or release approved.

## Actual reviewer response (verbatim)

**结论:APPROVE。** 确认B的独立SOURCE APPROVE。批准范围仅限本bounded测试-only诊断单元的六冻结文件提交及协调门后的下一次changed-head真实Windows运行;不构成原生验收、历史成因归因、合并或发布许可。

一、冻结与基线一致性。六文件SHA256与manifest、lineage逐项相符;三个d94基线pin(scope `d92faa28…`、gui `af037de7…`、apps `95835e66…`)与lineage的base_sha256完全相等。测试6对现行全源做精确逆变换后哈希命中该pin,LF/CRLF两剖面字节等价,运行期不spawn Git、不依赖旧对象,浅checkout安全。native业务测试、setup适配器与产品文件均unchanged。

二、Scope fixture。源中恰12条`OWNED_SCOPE825_INPUT_*` throw(含SHORT),与新switch的12个case一一对应,default唯一UNKNOWN;全串精确相等,无前缀/模糊匹配;payload仅追加封闭reason,原聚合type保留;除error.Message的精确枚举选择外无stack/HWND/PID/坐标/HRESULT/lasterror投影(测试断言PRIVATE串永不出现)。bare catch→catch(Exception)不改事件序:INPUT_REFUSED先于best-effort写,写失败仍吞,Shutdown(2)+return顺序在全部reason与UNKNOWN下保持。PRECONDITION/WINDOW/CLIENT等复合谓词仍单条成组不拆;SHORT仅源自`SendInput(3,…)!=3`,无UIPI/OS归因。setupComplete成功栅栏、128组合guard与查询计数、stale popup/resize、0/1/2部分插入与晚到合格事件用例全保留,仅补reason断言;adaptSetup与native helper未动,无input/守卫/native API变化。

三、Apps控制器。仅原`OWNED_APPS_FIXTURE_NOT_READY`追加后缀;六封闭标签恰来自两个真实嵌套调用点:launch按既有gui/headless定界,control传实际固定command;越界串(含PRIVATE)→UNKNOWN,序列id不入错误。单一10_000定时器、到期最终check、failure优先、JSON解析、close、abort理由同一性与watch/close/abort监听清理经focused用例1–3实测保持;90_000/180000注册pin在案。

四、Apps C#。MainThread捕获与首个MAIN_ENTER同语句且先于headless分支;SOURCE_INITIALIZED/LOADED为被动订阅,CONTENT_RENDERED在ready存在性检查之前、READY_WRITTEN在ready Record返回之后,语义正确;RUN_ENTER紧邻app.Run。复用既有Record与固定`apps-initial-`前缀;HashSet once-only,首试失败全吞、不重试、不解读为缺失;headless仅共享MAIN_ENTER。无新增ready/截图/时钟/worker/watcher/重试/输入/框架/API,预算未变。

五、reader与finally。封闭reader仅读六固定名,要求phase精确等于名、sameSta为boolean、恰两键;缺/pending/畸形/外来/额外键/未知名→UNKNOWN,sameSta=false按历史保留;不import产品、不生成观察、非就绪权威。finally顺序kill→closed→双固定目录投影→remove→settled;投影抛错仍保主错并完成清理,前缀D825_APPS_INITIAL经断言。

六、机器证据。A与B两份独立19/19(0 fail/0 skip)日志在案;strict类型检查据attest exit0;diff-check通过;13个scope用例=旧12+新mapper/catch用例,6个focused用例覆盖stage超时、真实receipt与launch/control集成、优先级/解析/close/abort、producer→reader、finally与三源全量逆变换。B另以git show对LF/CRLF比对全源逆结果,与pin一致。两处披露(cross-realm SyntaxError改断言name、B私有脚本arrow变量AST选择)均为测试/检查域修正,非产品缺陷,已透明说明,不构成阻塞。

边界重申:不重开历史未知OS/SDK成因,UNKNOWN即不支持分类;本单元不预设也不阻塞下一次changed-head真实Windows证明;后续不得据此观察添加回退、延长deadline、扩大权限/预算或新增输入。若未来Windows失败,应按新的封闭reason/stage/事件事实继续记录,而非扩大投影面。
