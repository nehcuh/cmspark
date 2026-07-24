// 测试环境隔离（WP5-I4）：config.ts 的 DATA_DIR 在模块加载时定型
// （const DATA_DIR = process.env.CMSPARK_DATA_DIR || ...），必须先于任何
// src import 设置——本模块以 side-effect import 置于测试文件首行。
// node --test 每测试文件独立进程，互不影响。

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-model-handlers-test-"))
