# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-10-02 S121 · 网易云 computer use · 站点知识 · 焦点 · 确认

- **站点知识**：`rw70ik` 四次 `record_experience` 都写成 `name: music-163-com`，文件是 `music-163-com.md` 与 `-2/-3/-4.md`。注入按 name 只取一份。挂载键是浏览器标签 hostname，不是 `mac.app.neteasemusic`。无 `site-op-memory`+`auto`，不进操作记忆。`j2l9u7` 只看到 173 字，仍点「顶部搜索框」→ `ocr:not-found`。
- **焦点**：截图不 `activate`。点击走 `preferForeground` + `cuActivatePid`。`invokeAx` 未接线。台账 §4 macOS 仍是 Gap。cua 后台是部分动作的真后台，失败码 `background_unavailable`，不抢焦点冒充。
- **确认**：无「本对话全部免点」。无人值守可免已开坐标 App 的 `host_computer`（8h、默认 30 步/预算，含中途再确认）。`host_app` 与默认 `evaluate` 仍可能问。网易云 `coordinateAllowed: true`。
- **Next**：未改代码。若修：合并同名站点经验；computer use 按 App 取知识；macOS 后台点击接到执行器。重载扩展。不要提交 `host-integrity.ts`。#568 > #567 > #563。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、裸 `node --test` 打本机数据目录、把截图不抢焦点说成点击也不抢、把无人值守说成所有弹窗都免。

### 2026-10-02 S120 · 拉取 0.6.11 · 三处 P1 · 本机换装

- **拉取**：`8e74b77b` → `6e0dec82`（84 提交，产品 0.6.11）。五路对抗 + Claude/Kimi 双路 `APPROVE_WITH_NITS`。
- **已改未提交的行为**：缺标签先分类再拼标题，登记 `TAB_NOT_FOUND`；Windows 后台左键只认 UIA Invoke；`chatCreate` 用 run epoch 写 `last_run_terminal`，领号在第一个 `await` 之前。Pi 要求的双跑行为测试已补。
- **换装**：`dist-package/CMspark-v0.6.11-macOS.dmg`。`/Applications/CMspark.app` CDHash `167c71c0c34fbfeda80490385f04e199ae09182a`，plist 0.6.11，daemon `127.0.0.1:23401`。无 bak。`host-integrity.ts` 不提交。
- **CLEARED**：线程 `t569rp` / `w-569-rp` 是裸 `node --test` 写进 `~/.cmspark-agent` 的残留，`run_progress` 为 sticky `null`。用户在这条上让插件播网易云，提案被拒并整轮停止。换新对话。
- **Next**：重载 `chrome-extension/build/chrome-mv3-prod/`。#568 > #567 > #563 后续。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后紧跟 `--output-format`、裸 `node --test` 打到本机数据目录、`cp` 不带 `/bin/cp -f` 去还原 CHANGELOG。

<!-- handoff:end -->
