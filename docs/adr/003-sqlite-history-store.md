# ADR-003: SQLite 操作历史存储

**日期**: 2026-05-24 | **状态**: 已确认 (修订: 2026-06-08)

## 背景

CMspark 需要记录每次 tool call 的执行详情（工具名、参数、结果、耗时、时间戳），支持按线程分组、全文搜索、JSON 导出、可配置保留天数。

## 决策

采用 **SQLite (sql.js)** 作为操作历史存储引擎，数据文件位于 `~/.cmspark-agent/history.db`。

sql.js 是 SQLite 的 Emscripten → WASM 编译版本，纯 JavaScript 运行，无需 native 编译。

## 权衡

### 优势

- **零配置**：无需安装数据库服务，文件即数据库
- **查询能力**：SQL 支持复杂过滤、聚合、按时间/线程/工具名查询
- **跨平台**：纯 WASM 实现，无需 native 编译，在所有 Node.js 平台（包括 ARM、Windows、Docker）开箱即用
- **可移植**：单文件，备份和迁移简单

### 劣势

- **异步初始化**：需要 `await` 数据库加载，不像 native 同步 API 那样即开即用
- **手动持久化**：需显式调用 `db.export()` + `fs.writeFileSync()` 写回磁盘
- **无复制**：单机部署，不支持多进程共享
- **Schema 变更**：需要手动迁移，无自动化

## 替代方案

**better-sqlite3**：同步 native C++ API，性能最优。被否决原因：需要 native 编译，在 ARM Mac、Windows、CI 环境下频繁出现兼容问题，增加部署复杂度。

**JSON 文件**：简单但查询能力弱，大文件读写性能差。被否决。

**PostgreSQL/Supabase**：远程数据库方案，适合多机同步，但当前 MVP 阶段过度设计。

## 后果

- 无 native 编译依赖，CI/CD 和跨平台部署简单
- 需在启动时异步初始化数据库，在 server 启动前完成
- 保留策略（`history_retention_days`）需要定时清理任务（当前未实现）
