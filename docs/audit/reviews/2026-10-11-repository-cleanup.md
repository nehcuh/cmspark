# 仓库整理记录

日期：2026-10-11。整理基准：origin/main 9429ec61597a651a99ccb53cb59921197901e730。

## 保全与清理

整理前已创建并验证外部 Git bundle，包含当时所有本地/远程引用及当前 stash；另外保存两份 stash 的完整 patch、引用清单、实验 worktree 未追踪文件与本地记录。备份目录：`/Users/huchen/Projects/cmspark-cleanup-backup-20261011`，仅当前用户可访问。

- 主工作区 main 从 763fc891 快进到 9429ec61，随后从该基线创建 codex/cooperation-reliability。
- 清除 8 条指向不存在目录的 worktree 记录；备份后移除 .experiment/worktree，只剩主工作区。
- 删除 33 个旧本地分支、38 个旧远程分支。祖先关系可证已合并的直接清理；squash 分支逐个比较对应合并提交的所有改动路径；其余逐项核对内容并归档。
- 两个 stash 经内容比较确认不需回灌：第一份被主线更完整的协作/保护实现覆盖；第二份的 ignore 已合入，host hash 为过期本机产物。备份后删除。
- 本地工具目录、个人素材未删除，不将这些未追踪文件打入产品提交。

可用 `git bundle list-heads /Users/huchen/Projects/cmspark-cleanup-backup-20261011/repository.bundle` 查看旧引用，再按原引用名 fetch 到新分支恢复。stash patch 与本地记录压缩包保存在同目录。

## 未合并工作处置

- `experiment/cooperation-runtime-20261007`：核心实现已在主线；旧实现不能覆盖后续修复。历史评审保存在 bundle/实验记录备份。
- `codex/desktop-identity`：未接线且未通过独立评审的原型，归档；#480 保留后续需求。
- `feat/tab-read-write-lease`：本地多出提交仅旧交接笔记，归档；不覆盖当前上下文。
- `fix/528-529-site-op-osascript`：#528/#529 已由其他 PR 合入。抽取选目录错误分类、持久错误提示、返回主对话入口与快捷键平台文档。旧 debugger 恢复方案需要按当前生命周期重做，由现有 #567 跟踪，未冒充已交付。
- `codex/windows-artifact-review`：抽取 ACP/WS peer 隔离、握手取消与子进程回收，并修复验证中发现的 timeline 数组别名错误。Windows 平台和终端入口已有更新版本，不回退。独立的本地代码下载/执行评审产品和额外 PTY 恢复原型保存在 bundle；本次不引入新执行授权面。

## 结论边界

整理完成指引用与 worktree 已核对、需要的修复已抽取、其他工作可恢复；不表示历史所有开放 Issue 都已解决。新增协作可靠性设计和验收见 #590、同日 spec 与 validation 报告。
