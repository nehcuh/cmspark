// WP5 I1 — TinyClick 模型 manifest 与下载门禁核心（plan WP5 WI-1.1 + W3 证据包 §5）。
//
// 信任根基，四条纪律（docs/decisions/coordinate-computer-use-wp5-model-provenance.md）：
//   1. manifest 三要素：每文件 {源 URL, commit revision, sha256, size}；manifest 入库、
//      只随发版更新，运行时永不接受网络来源的 manifest（防「更新 manifest」偷换哈希叙事）。
//   2. 镜像可配主机、哈希不可配：computer.modelMirror 只能替换下载 URL 的主机部分；
//      任何经 URL path/query 改变预期哈希的尝试一律忽略并 loud log（fail-closed）。
//   3. 校验即加载、无 TOCTOU 窗口：读入内存 → sha256 复验 → 返回同一 buffer 供建
//      ORT session。禁止「按路径校验、再按路径加载」两段式——校验与加载之间的替换
//      窗口是投毒入口（ONNX 是代码载体，ORT 官方明示恶意模型风险）。每次加载前复验，
//      本模块不提供任何「已校验」缓存，调用方亦不得自建短路。
//   4. 完整性 ≠ 来源（W3 §3 诚实声明）：sha256 钉死证明下载字节 == 登记字节，
//      不证明镜像字节 == Samsung 原始权重；残余风险靠 L2 人审闸门 + golden 回归兜底。
//
// URL 占位说明：manifest 内 url 主机为 models.cmspark.invalid（RFC 2606 保留 TLD，
// 永不解析）——自托管发布链 host 待 owner 决策（plan WP5 风险条 / M4），决策前默认禁网。

import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { DATA_DIR } from "../config"

// --- 错误类型 ---------------------------------------------------------------

/** 下载门禁结构化错误。code 供上层审计/测试断言（fail-closed 契约），message 仅供人读。 */
export class ModelGateError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ModelGateError"
    this.code = code
  }
}

// --- schema -----------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/
const sha256Schema = z.string().regex(SHA256_RE, "sha256 必须是 64 位小写 hex")

const fileEntrySchema = z
  .object({
    name: z.string().min(1),
    // 三要素之一「源 URL」：仅 https（file:///UNC 等本地替换面在 schema 层关闭）
    url: z.string().refine((u) => u.startsWith("https://"), {
      message: "模型文件 url 必须是 https://",
    }),
    sha256: sha256Schema,
    size: z.number().int().positive(),
  })
  .strict()

const variantSchema = z.object({ files: z.array(fileEntrySchema).min(1) }).strict()

const modelEntrySchema = z
  .object({
    repo: z.string().min(1),
    // 三要素之二「commit revision」：HF git commit 全值（40 hex）
    revision: z.string().regex(/^[0-9a-f]{40}$/, "revision 必须是 40 位小写 hex commit"),
    license: z.string().min(1),
    licenseCopyright: z.string().min(1),
    baseModelNotice: z
      .object({ repo: z.string().min(1), license: z.string().min(1) })
      .strict(),
    provenance: z
      .object({
        sourceFile: z.string().min(1),
        sourceSha256: sha256Schema,
        exportVendor: z
          .object({
            configuration: sha256Schema,
            modeling: sha256Schema,
            processing: sha256Schema,
          })
          .strict(),
        exportedAt: z.string().min(1),
      })
      .strict(),
    // 变体齐全性：至少交付默认变体 hybrid（int8 可选）
    variants: z
      .record(variantSchema)
      .refine((v) => v.hybrid !== undefined, { message: "variants 必须包含默认变体 hybrid" }),
  })
  .strict()

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.record(modelEntrySchema),
  })
  .strict()

export type ModelManifest = z.infer<typeof manifestSchema>
export type ModelEntry = z.infer<typeof modelEntrySchema>
export type ModelFileEntry = z.infer<typeof fileEntrySchema>

// --- manifest 读取（纪律 1：拒绝任何网络源） ---------------------------------

// 网络/非本地源特征：URL scheme（http/https/file/ftp 等）与 UNC 路径（\\host 或 //host）。
// manifest 只允许来自 exe 旁/仓库内的本地文件路径——「运行时网络更新 manifest」是
// 哈希叙事的第一偷换面，必须在入口关闭。
const REMOTE_SOURCE_RE = /^([a-z][a-z0-9+.-]*:\/\/|\\\\|\/\/)/i

/** 解析并校验 manifest JSON 文本。schema 失败 → ModelGateError("manifest-invalid")。 */
export function parseModelManifest(rawJson: string): ModelManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new ModelGateError(
      "manifest-invalid",
      `models.manifest.json 不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new ModelGateError("manifest-invalid", `models.manifest.json schema 校验失败: ${issues}`)
  }
  return result.data
}

/**
 * 从本地路径读取 manifest。sourcePath 必须是本地文件路径；任何形式 URL/UNC
 * 一律拒绝（manifest-source-remote）——manifest 永不运行时网络更新。
 */
export async function loadModelManifest(sourcePath: string): Promise<ModelManifest> {
  if (REMOTE_SOURCE_RE.test(sourcePath)) {
    throw new ModelGateError(
      "manifest-source-remote",
      `manifest 源必须是本地文件路径，拒绝网络/UNC 源: ${sourcePath}`,
    )
  }
  const raw = await readFile(sourcePath, "utf-8")
  return parseModelManifest(raw)
}

// --- 镜像解析（纪律 2：主机可配、哈希不可配） ---------------------------------

/**
 * 解析某个模型文件的实际下载 URL。
 * - mirror 缺省 → 返回 manifest 登记 url（占位主机，owner 定 host 前默认禁网）。
 * - mirror 仅允许 https origin；非 https（http/file/UNC/畸形）→ mirror-scheme-denied。
 * - mirror 携带 path/query/fragment → 仅取 origin，其余忽略并 loud log：
 *   「镜像可配主机、哈希不可配」——URL 参数绝不能影响预期哈希（W3 §5.2 与首轮对抗修订）。
 * - 返回 URL 只保留 manifest url 的 pathname（登记 url 自身的 query/fragment 同样丢弃，
 *   防止 manifest 侧参数注入）。
 */
export function resolveDownloadUrl(fileUrl: string, mirror?: string): string {
  if (mirror === undefined || mirror === "") return fileUrl
  let mirrorUrl: URL
  try {
    mirrorUrl = new URL(mirror)
  } catch {
    throw new ModelGateError("mirror-scheme-denied", `computer.modelMirror 无法解析: ${mirror}`)
  }
  if (mirrorUrl.protocol !== "https:") {
    throw new ModelGateError(
      "mirror-scheme-denied",
      `computer.modelMirror 仅允许 https scheme，收到 ${mirrorUrl.protocol}// —— file:///UNC 本地替换面已关闭`,
    )
  }
  if (mirrorUrl.pathname !== "/" || mirrorUrl.search !== "" || mirrorUrl.hash !== "") {
    console.error(
      `[cmspark-agent] computer.modelMirror 仅主机部分生效，path/query/fragment 已忽略（哈希不可配）: ${mirror}`,
    )
  }
  const file = new URL(fileUrl)
  return `${mirrorUrl.origin}${file.pathname}`
}

// --- 校验即加载（纪律 3：同 buffer、无 TOCTOU、每次复验） ---------------------

/**
 * 读取模型文件并复验后返回同一 buffer。调用方必须把返回的 buffer 直接交给
 * ORT 建 session（onnxruntime-node 支持 Uint8Array 入参），不得再按路径加载。
 *
 * 内存说明：readFile 一次读入与 ORT session 加载本身的字节量级相同（hybrid 单图
 * 最大 366MB，session 常驻远大于此），不引入额外峰值；哈希在同一 buffer 上计算，
 * 字节级保证「校验的字节 == 建 session 的字节」。
 *
 * stat-first 预检（I1 对抗 M2）：先 stat 核 size 再 readFile——路径上被放置超大
 * 文件时干净拒绝，而非全量读入内存后才拒（内存耗尽会先于干净拒绝）。同 buffer
 * 契约不动：stat→read 之间存在替换窗口，故 buffer 上仍复比 size + sha256。
 *
 * 无缓存：每次调用都重新读盘复验——「已校验」标记是 TOCTOU 投毒窗口。
 */
export async function loadVerifiedFileBytes(
  filePath: string,
  expected: { sha256: string; size: number },
): Promise<Buffer> {
  let fileSize: number
  try {
    fileSize = (await stat(filePath)).size
  } catch (err) {
    // 三态之一「缺文件」结构化：未下载/已删除/路径错误统一 model-file-missing，
    // 与错哈希（model-hash-mismatch）/断网（network-error，下载侧）供 UI 区分呈现
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new ModelGateError(
        "model-file-missing",
        `模型文件不存在（未下载或已删除）: ${filePath}`,
      )
    }
    throw err
  }
  if (fileSize !== expected.size) {
    throw new ModelGateError(
      "model-size-mismatch",
      `模型文件大小不符（期望 ${expected.size} 字节，实际 ${fileSize}）: ${filePath}`,
    )
  }
  let buf: Buffer
  try {
    buf = await readFile(filePath)
  } catch (err) {
    // stat→read 之间文件被删，同样归一为缺文件态
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new ModelGateError(
        "model-file-missing",
        `模型文件不存在（未下载或已删除）: ${filePath}`,
      )
    }
    throw err
  }
  if (buf.byteLength !== expected.size) {
    throw new ModelGateError(
      "model-size-mismatch",
      `模型文件大小不符（期望 ${expected.size} 字节，实际 ${buf.byteLength}）: ${filePath}`,
    )
  }
  const digest = createHash("sha256").update(buf).digest("hex")
  if (digest !== expected.sha256) {
    throw new ModelGateError(
      "model-hash-mismatch",
      `模型文件 sha256 不符（期望 ${expected.sha256}，实际 ${digest}）: ${filePath} —— 拒绝加载被篡改/损坏的模型`,
    )
  }
  return buf
}

// --- 模型目录约定 -------------------------------------------------------------

/**
 * 模型下载目标目录：<DATA_DIR>/models/tinyclick-<variant>/（plan §C.2；
 * 对照 evidence.ts 的 DATA_DIR 解析惯例）。模型文件不进安装包、不进 git。
 */
export function modelDirFor(variant: string, baseDir?: string): string {
  return path.join(baseDir ?? DATA_DIR, "models", `tinyclick-${variant}`)
}
