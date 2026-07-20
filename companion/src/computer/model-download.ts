// WP5 I1 — TinyClick 模型下载管理器（plan WP5 WI-1.2，§C.2 全项 + M7 stale .part）。
//
// 安全语义（与 model-manifest.ts 共同构成下载门禁）：
//   - 只从 manifest 指定源下载：https only；镜像经 computer.modelMirror 覆盖主机，
//     scheme 白名单禁 file:///UNC（resolveDownloadUrl 强制执行）。
//   - 断点续传：`<name>.part` 分片 + `<name>.part.json` 旁挂 meta（url/revision/
//     sha256/startedAt）；续传用 Range 请求，服务端 200（不支持 Range）则从头重写。
//   - stale .part 清理（M7）：meta 缺失 / url 变更 / revision 变更 / sha256 变更 /
//     超 PART_STALE_MS → 删除重下——防跨 revision 复用旧分片拼出旧哈希文件。
//   - 磁盘预算「下载前」检查（默认 2048MB，computer.modelDiskBudgetMB 可调）：
//     下载后检查会被塞盘 DoS，必须前置（plan 攻击面提示 5）。
//   - 完成后 streaming sha256 全量复验 + 原子 rename（libuv 覆盖式 rename，
//     崩溃不留半成品最终文件）；复验失败删除 .part（不留篡改分片作续传基础）。
//   - 任何失败 → computeruse.model.unavailable {reason} 审计 + ModelDownloadError
//     （永不阻塞 UIA/OCR/云端层，§C.2.4——层不可用状态由调用方状态机维护）。
//   - 永不自动网络更新：本模块仅由用户显式动作触发（computer.model.download /
//     许可证接受后的首次下载）；无定时器、无启动时网络行为。

import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"

import {
  ModelGateError,
  modelDirFor,
  resolveDownloadUrl,
  type ModelManifest,
} from "./model-manifest"

// --- 常量与错误 ---------------------------------------------------------------

/** stale .part 超期阈值（M7）：24h——覆盖「下了一半隔夜续传」场景，超出则重下。 */
export const PART_STALE_MS = 24 * 60 * 60 * 1000

/** 磁盘预算默认值（MB）：hybrid 705MB + int8 432MB 双变体 + 余量。 */
export const DEFAULT_DISK_BUDGET_MB = 2048

/** 下载失败结构化原因（审计事件与错误共用同一词表，fail-closed 契约）。 */
export type ModelUnavailableReason =
  | "model-unknown"
  | "variant-unknown"
  | "mirror-scheme-denied"
  | "disk-budget-exceeded"
  | "disk-full"
  | "http-error"
  | "network-error"
  | "hash-mismatch"
  | "size-mismatch"

export class ModelDownloadError extends Error {
  readonly reason: ModelUnavailableReason
  constructor(reason: ModelUnavailableReason, message: string) {
    super(message)
    this.name = "ModelDownloadError"
    this.reason = reason
  }
}

// --- 依赖注入（测试全 fake） ---------------------------------------------------

export interface ModelDownloadDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  /** 目录所在卷剩余字节；返回 null 表示不可用（跳过 disk-full 检查，预算检查仍在）。 */
  diskFreeBytes?: (dir: string) => Promise<number | null>
  /** 审计钩子：computeruse.model.unavailable（默认 no-op，接线同 locate-chain 惯例）。 */
  log?: (event: string, payload: Record<string, unknown>) => void
  /** 进度钩子：单文件累计已收字节（含续传基线）/ 登记总字节。 */
  onProgress?: (file: string, receivedBytes: number, totalBytes: number) => void
}

export interface DownloadModelArgs {
  manifest: ModelManifest
  modelId: string
  variant: string
  mirror?: string
  diskBudgetMB?: number
  destDir?: string
}

export interface DownloadModelResult {
  destDir: string
  files: string[]
  totalBytes: number
}

// --- .part meta（stale 判定依据） ----------------------------------------------

interface PartMeta {
  url: string
  revision: string
  sha256: string
  size: number
  startedAt: number
}

async function readPartMeta(metaPath: string): Promise<PartMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf-8")) as Partial<PartMeta>
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.revision !== "string" ||
      typeof parsed.sha256 !== "string" ||
      typeof parsed.size !== "number" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null
    }
    return parsed as PartMeta
  } catch {
    return null
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest("hex")
}

async function dirOccupiedBytes(dir: string): Promise<number> {
  try {
    let total = 0
    for (const name of await readdir(dir)) {
      try {
        const s = await stat(path.join(dir, name))
        if (s.isFile()) total += s.size
      } catch {
        /* 竞态删除忽略 */
      }
    }
    return total
  } catch {
    return 0 // 目录尚不存在
  }
}

// --- 主流程 -------------------------------------------------------------------

/**
 * 下载指定变体的全部模型文件。任一文件失败即整体失败（部分完成的 .part 残留
 * 供下次续传；校验失败的 .part 已删除）。成功返回目录与文件清单。
 */
export async function downloadModelVariant(
  args: DownloadModelArgs,
  deps: ModelDownloadDeps = {},
): Promise<DownloadModelResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const modelId = args.modelId
  const variant = args.variant

  const fail = (reason: ModelUnavailableReason, message: string, extra?: Record<string, unknown>): never => {
    log("computeruse.model.unavailable", { modelId, variant, reason, ...extra })
    throw new ModelDownloadError(reason, message)
  }

  const model = args.manifest.models[modelId]
  if (!model) return fail("model-unknown", `manifest 中不存在模型: ${modelId}`)
  const files = model.variants[variant]?.files
  if (!files || files.length === 0) {
    return fail("variant-unknown", `模型 ${modelId} 无变体: ${variant}`)
  }

  const destDir = args.destDir ?? modelDirFor(variant)
  await mkdir(destDir, { recursive: true })
  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  // 磁盘预算——下载前检查（保守上界：目录当前全部占用 + 本次总量，旧文件抵扣不
  // 重复计算；方向 fail-closed，宁误拒不误放）。
  const budgetMB = args.diskBudgetMB ?? DEFAULT_DISK_BUDGET_MB
  const occupied = await dirOccupiedBytes(destDir)
  const projected = occupied + totalSize
  if (projected > budgetMB * 1024 * 1024) {
    return fail(
      "disk-budget-exceeded",
      `磁盘预算超限：目录占用 ${occupied} + 本次 ${totalSize} = ${projected} 字节 > 预算 ${budgetMB}MB`,
      { budgetMB, occupiedBytes: occupied, requiredBytes: totalSize },
    )
  }

  // 卷剩余空间（可得时）：不足则拒下。statfs 不可用时跳过本项（预算检查是主防线）。
  const diskFree = deps.diskFreeBytes ?? defaultDiskFreeBytes
  const freeBytes = await diskFree(destDir)
  if (freeBytes !== null && freeBytes < totalSize) {
    return fail("disk-full", `卷剩余空间不足：${freeBytes} 字节 < 所需 ${totalSize} 字节`, {
      freeBytes,
      requiredBytes: totalSize,
    })
  }

  for (const f of files) {
    let url: string
    try {
      url = resolveDownloadUrl(f.url, args.mirror)
    } catch (err) {
      if (err instanceof ModelGateError) {
        return fail(err.code as ModelUnavailableReason, err.message)
      }
      throw err
    }

    const destPath = path.join(destDir, f.name)
    const partPath = `${destPath}.part`
    const metaPath = `${partPath}.json`

    // stale .part 判定（M7）：meta 缺失/损坏、url 或 revision 或 sha256 漂移、超期 →
    // 删除重下；跨 revision 复用旧分片可拼出旧哈希文件，此检查是下载链路的防混面。
    let resumeFrom = 0
    const meta = await readPartMeta(metaPath)
    const metaValid =
      meta !== null &&
      meta.url === url &&
      meta.revision === model.revision &&
      meta.sha256 === f.sha256 &&
      now() - meta.startedAt <= PART_STALE_MS
    if (metaValid && meta) {
      try {
        const s = await stat(partPath)
        if (s.size > 0 && s.size <= f.size) {
          resumeFrom = s.size
        } else {
          await rm(partPath, { force: true }) // 分片比登记还大或为空——损坏，重下
        }
      } catch {
        resumeFrom = 0 // .part 不存在（meta 孤儿）
      }
    } else {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
    }
    if (resumeFrom === 0) {
      // 新下载尝试：写 meta。续传保留原 meta 与原 startedAt——stale 计时不被续传刷新。
      const freshMeta: PartMeta = { url, revision: model.revision, sha256: f.sha256, size: f.size, startedAt: now() }
      await writeFile(metaPath, JSON.stringify(freshMeta), "utf-8")
    }
    if (resumeFrom < f.size) {
      try {
        await downloadOne(fetchImpl, url, partPath, resumeFrom, f.size, deps.onProgress, f.name)
      } catch (err) {
        // downloadOne 的结构化失败统一经 fail() 审计——下载失败必须留下
        // computeruse.model.unavailable 事件（层不可用叙事，§C.2.4）
        if (err instanceof ModelDownloadError) {
          return fail(err.reason, err.message, { file: f.name })
        }
        throw err
      }
    }
    // else：分片已齐但未 rename（上次崩在复验前）——直接进入复验段

    // 全量复验（streaming sha256）+ 原子 rename。复验失败删除分片——被篡改的
    // 分片不得留作下次续传基础（分片级篡改拼接防线，plan 攻击面提示 5）。
    const partStat = await stat(partPath)
    if (partStat.size !== f.size) {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
      return fail("size-mismatch", `${f.name} 下载后大小不符（期望 ${f.size}，实际 ${partStat.size}）`, {
        file: f.name,
      })
    }
    const digest = await sha256File(partPath)
    if (digest !== f.sha256) {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
      return fail("hash-mismatch", `${f.name} 下载后 sha256 不符（期望 ${f.sha256}，实际 ${digest}）`, {
        file: f.name,
      })
    }
    await rename(partPath, destPath) // libuv 覆盖式 rename：同卷原子，崩溃不留半成品
    await rm(metaPath, { force: true })
  }

  return { destDir, files: files.map((f) => f.name), totalBytes: totalSize }
}

/** 单文件下载（Range 续传 → 流式写 .part）。失败抛错由主流程归一为审计原因。 */
async function downloadOne(
  fetchImpl: typeof fetch,
  url: string,
  partPath: string,
  resumeFrom: number,
  expectedSize: number,
  onProgress: ModelDownloadDeps["onProgress"],
  fileName: string,
): Promise<void> {
  const doFetch = async (rangeFrom: number): Promise<Response> => {
    const headers: Record<string, string> = rangeFrom > 0 ? { Range: `bytes=${rangeFrom}-` } : {}
    let res: Response
    try {
      res = await fetchImpl(url, { headers })
    } catch (err) {
      throw new ModelDownloadError(
        "network-error",
        `网络错误（${fileName}）: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return res
  }

  let appendAt = resumeFrom
  let res = await doFetch(resumeFrom)
  if (resumeFrom > 0 && res.status === 416) {
    // 服务端拒绝 Range（分片比服务端文件还大/已变）——删分片从头下（调用方不重试，
    // 这里就地重发无 Range 请求一次；再失败按 http-error 归一）。
    await rm(partPath, { force: true })
    appendAt = 0
    res = await doFetch(0)
  }
  const okStatus = appendAt > 0 ? 206 : 200
  if (res.status !== okStatus) {
    // 续传收到 200（服务端不支持 Range）——从头重写；其余非预期状态 → http-error
    if (appendAt > 0 && res.status === 200) {
      appendAt = 0
    } else {
      throw new ModelDownloadError("http-error", `HTTP ${res.status}（${fileName}）: ${url}`)
    }
  }

  if (!res.body) {
    throw new ModelDownloadError("network-error", `响应无 body（${fileName}）`)
  }
  let received = appendAt
  const source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream)
  // data 监听与 pipeline 共存：pipeline 负责背压，监听只做进度计数
  source.on("data", (chunk: Buffer) => {
    received += chunk.byteLength
    onProgress?.(fileName, received, expectedSize)
  })
  try {
    await pipeline(source, createWriteStream(partPath, { flags: appendAt > 0 ? "a" : "w" }))
  } catch (err) {
    if (err instanceof ModelDownloadError) throw err
    throw new ModelDownloadError(
      "network-error",
      `下载流中断（${fileName}，已收 ${received} 字节）: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 删除指定变体模型目录（「删除模型」一键回收，含 .part/meta）。 */
export async function deleteModelVariant(args: {
  variant: string
  destDir?: string
}): Promise<{ removedBytes: number }> {
  const destDir = args.destDir ?? modelDirFor(args.variant)
  const occupied = await dirOccupiedBytes(destDir)
  await rm(destDir, { recursive: true, force: true })
  return { removedBytes: occupied }
}

/** statfs 默认实现（Node ≥18.15，Windows 可用）；失败返回 null → 跳过 disk-full 检查。 */
async function defaultDiskFreeBytes(dir: string): Promise<number | null> {
  try {
    const { statfs } = await import("node:fs/promises")
    const s = await statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}
