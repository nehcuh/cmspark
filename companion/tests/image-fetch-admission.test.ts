/**
 * analyze_image IMAGE_FETCH admission (C10 Phase D).
 * Isolates DATA_DIR before config module load.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-image-fetch-adm-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp
process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import { describe, it, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import {
  runImageFetchAdmission,
  type ImageFetchAdmissionCtx,
  type ToolResult,
} from "../src/tool/image-fetch-admission"
import { initDataDir, getConfig, saveConfig } from "../src/config"

/** 1×1 PNG (valid allowlisted raster MIME). */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const TINY_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

function noopLog() {
  /* silence finish log */
}

function mockWs(open = true): WebSocket {
  return {
    readyState: open ? WebSocket.OPEN : WebSocket.CLOSED,
    send: () => {},
  } as unknown as WebSocket
}

function makeCtx(
  overrides: Partial<ImageFetchAdmissionCtx> & {
    toolName: string
    dispatchToExtension?: ImageFetchAdmissionCtx["dispatchToExtension"]
    securityConfirmations?: ImageFetchAdmissionCtx["securityConfirmations"]
  },
): ImageFetchAdmissionCtx {
  return {
    finalParams: {},
    toolCallId: "tc1",
    startedAt: Date.now(),
    ws: mockWs(true),
    logToolFinish: noopLog,
    securityConfirmations: {
      request: async () => ({ approved: false, reason: "denied" }),
    } as any,
    dispatchToExtension: async () => ({ success: false, error: "unexpected dispatch" }),
    ...overrides,
  }
}

before(async () => {
  await initDataDir()
})

beforeEach(() => {
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: {
      ...getConfig().security,
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
  })
})

describe("runImageFetchAdmission", () => {
  it("non-analyze tools → null (caller continues)", async () => {
    const r = await runImageFetchAdmission(
      makeCtx({ toolName: "navigate", finalParams: { url: "https://example.com" } }),
    )
    assert.equal(r, null)
  })

  it("direct analyze_image_fetch → blocked result", async () => {
    let finished: ToolResult | undefined
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image_fetch",
        finalParams: { candidate_url: "https://evil.com/x.png" },
        logToolFinish: (_id, _name, _t, result) => {
          finished = result
        },
      }),
    )
    assert.ok(r)
    assert.equal(r!.success, false)
    assert.match(r!.error || "", /internal tool and cannot be called directly/)
    assert.deepEqual(finished, r)
  })

  it("analyze_image phase1 canvas path → returns phase1 without confirm", async () => {
    const canvasResult: ToolResult = {
      success: true,
      data: { type: "canvas", image_base64: "abc", width: 10, height: 10 },
    }
    const dispatches: Array<{ id: string; name: string }> = []
    let confirmCalls = 0
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        finalParams: { selector: ".hero" },
        dispatchToExtension: async (id, name) => {
          dispatches.push({ id, name })
          return canvasResult
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.deepEqual(r, canvasResult)
    assert.equal(dispatches.length, 1)
    assert.equal(dispatches[0].name, "analyze_image")
    assert.equal(confirmCalls, 0)
  })

  it("fetch_required + auto_approved domain → phase2 called, no confirm", async () => {
    saveConfig({ auto_approved_domains: ["cdn.example.com"] })
    const dispatches: Array<{ id: string; name: string; params: any }> = []
    let confirmCalls = 0
    const phase2: ToolResult = {
      success: true,
      data: { type: "canvas", image_base64: "fetched", width: 1, height: 1 },
    }
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        toolCallId: "tc_auto",
        finalParams: { selector: "img.x", tabId: 7 },
        dispatchToExtension: async (id, name, params) => {
          dispatches.push({ id, name, params })
          if (name === "analyze_image") {
            return {
              success: true,
              data: {
                type: "fetch_required",
                candidate_url: "https://cdn.example.com/a.png",
              },
            }
          }
          return phase2
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.deepEqual(r, phase2)
    assert.equal(confirmCalls, 0)
    assert.equal(dispatches.length, 2)
    assert.equal(dispatches[0].name, "analyze_image")
    assert.equal(dispatches[1].name, "analyze_image_fetch")
    assert.equal(dispatches[1].id, "tc_auto__image_fetch")
    assert.equal(dispatches[1].params.candidate_url, "https://cdn.example.com/a.png")
    assert.equal(dispatches[1].params.tabId, 7)
    assert.equal(dispatches[1].params.selector, "img.x")
  })

  it("fetch_required + untrusted → confirm denied → fail", async () => {
    const dispatches: Array<{ id: string; name: string }> = []
    let confirmCalls = 0
    let confirmOpts: any = "unset"
    const ws = mockWs(true)
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        finalParams: { selector: "img.x" },
        ws,
        dispatchToExtension: async (id, name) => {
          dispatches.push({ id, name })
          return {
            success: true,
            data: {
              type: "fetch_required",
              candidate_url: "https://untrusted.example/i.png",
            },
          }
        },
        securityConfirmations: {
          request: async (_send: any, _d: any, opts?: any) => {
            confirmCalls++
            confirmOpts = opts
            return { approved: false, reason: "denied" }
          },
        } as any,
      }),
    )
    assert.ok(r)
    assert.equal(r!.success, false)
    assert.match(r!.error || "", /denied by user/)
    assert.equal(confirmCalls, 1)
    assert.deepEqual(confirmOpts, { originWs: ws }, "image-fetch confirm must bind originWs")
    assert.equal(dispatches.length, 1, "phase2 must not run after deny")
    assert.equal(dispatches[0].name, "analyze_image")
  })

  it("single-flag god-mode alone does NOT skip IMAGE_FETCH confirm", async () => {
    saveConfig({
      trusted_domains: ["evil.example"],
      auto_approved_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: true, // protocol unlock only
      },
    } as any)
    let confirmCalls = 0
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          if (name === "analyze_image") {
            return {
              success: true,
              data: {
                type: "fetch_required",
                candidate_url: "https://evil.example/x.png",
              },
            }
          }
          return { success: true, data: { type: "canvas", image_base64: "x" } }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.equal(confirmCalls, 1, "protocol unlock alone must not waive IMAGE_FETCH confirm")
    assert.ok(r?.success === true)
  })

  it("three-flag cruise skips IMAGE_FETCH confirm (risk accepted)", async () => {
    saveConfig({
      auto_approved_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
    } as any)
    let confirmCalls = 0
    const dispatches: string[] = []
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          dispatches.push(name)
          if (name === "analyze_image") {
            return {
              success: true,
              data: {
                type: "fetch_required",
                candidate_url: "https://evil.example/x.png",
              },
            }
          }
          return { success: true, data: { type: "canvas", image_base64: "x" } }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.equal(confirmCalls, 0, "full-autonomy cruise must waive IMAGE_FETCH confirm")
    assert.ok(r?.success === true)
    assert.deepEqual(dispatches, ["analyze_image", "analyze_image_fetch"])
  })

  it("file:// without cruise hard-blocks; with cruise allows phase2", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: false,
      },
    } as any)
    const fileUrl = "file:///Users/huchen/CMspark-projects/demo/slide.png"
    let confirmCalls = 0
    const blocked = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          if (name === "analyze_image") {
            return {
              success: true,
              data: { type: "fetch_required", candidate_url: fileUrl },
            }
          }
          return { success: true, data: { type: "canvas", image_base64: "x" } }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.equal(blocked?.success, false)
    assert.match(blocked?.error || "", /file_requires_cruise|三旗|file:/i)
    assert.equal(confirmCalls, 0, "file: refusal is not a confirm dialog")

    saveConfig({
      security: {
        ...getConfig().security,
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
    } as any)
    confirmCalls = 0
    const dispatches: string[] = []
    const ok = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          dispatches.push(name)
          if (name === "analyze_image") {
            return {
              success: true,
              data: { type: "fetch_required", candidate_url: fileUrl },
            }
          }
          return { success: true, data: { type: "canvas", image_base64: "local" } }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.equal(confirmCalls, 0)
    assert.ok(ok?.success === true)
    assert.deepEqual(dispatches, ["analyze_image", "analyze_image_fetch"])
  })

  it("three-flag cruise still hard-blocks cloud metadata SSRF", async () => {
    saveConfig({
      security: {
        ...getConfig().security,
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
    } as any)
    let confirmCalls = 0
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          if (name === "analyze_image") {
            return {
              success: true,
              data: {
                type: "fetch_required",
                candidate_url: "http://169.254.169.254/latest/meta-data/",
              },
            }
          }
          return { success: true, data: {} }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.equal(r?.success, false)
    assert.match(r?.error || "", /metadata|SSRF/i)
    assert.equal(confirmCalls, 0)
  })

  it("cookie trusted_domains alone do NOT auto-approve image fetch", async () => {
    saveConfig({
      trusted_domains: ["cdn.only-cookie.example"],
      auto_approved_domains: [],
      security: {
        ...getConfig().security,
        auto_approve_dangerous: false,
        allow_all_schemes: false,
      },
    } as any)
    let confirmCalls = 0
    await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        dispatchToExtension: async (_id, name) => {
          if (name === "analyze_image") {
            return {
              success: true,
              data: {
                type: "fetch_required",
                candidate_url: "https://cdn.only-cookie.example/a.png",
              },
            }
          }
          return { success: true, data: {} }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: false, reason: "denied" }
          },
        } as any,
      }),
    )
    assert.equal(confirmCalls, 1, "ADR-007: cookie trust must not skip image fetch confirm")
  })

  it("fetch_required + cloud metadata IP → hard block", async () => {
    const dispatches: Array<{ id: string; name: string }> = []
    let confirmCalls = 0
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        finalParams: { selector: "img.x" },
        dispatchToExtension: async (id, name) => {
          dispatches.push({ id, name })
          return {
            success: true,
            data: {
              type: "fetch_required",
              candidate_url: "http://169.254.169.254/latest/meta-data/",
            },
          }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.ok(r)
    assert.equal(r!.success, false)
    assert.match(r!.error || "", /cloud metadata|SSRF/i)
    assert.equal(confirmCalls, 0)
    assert.equal(dispatches.length, 1, "phase2 must not run for metadata IP")
  })

  it("data: URL residual → local decode path (no phase2)", async () => {
    const dispatches: Array<{ id: string; name: string }> = []
    let confirmCalls = 0
    const r = await runImageFetchAdmission(
      makeCtx({
        toolName: "analyze_image",
        finalParams: { selector: "img.inline" },
        dispatchToExtension: async (id, name) => {
          dispatches.push({ id, name })
          return {
            success: true,
            data: {
              type: "fetch_required",
              candidate_url: TINY_DATA_URL,
              width: 1,
              height: 1,
              title: "t",
              alt_text: "a",
            },
          }
        },
        securityConfirmations: {
          request: async () => {
            confirmCalls++
            return { approved: true, reason: "approved" }
          },
        } as any,
      }),
    )
    assert.ok(r)
    assert.equal(r!.success, true)
    assert.equal(r!.data?.type, "canvas")
    assert.equal(r!.data?.image_base64, TINY_PNG_B64)
    assert.equal(r!.data?.width, 1)
    assert.equal(r!.data?.height, 1)
    assert.equal(r!.data?.selector, "img.inline")
    assert.match(String(r!.data?.url || ""), /^data:image\/png;base64/)
    assert.equal(confirmCalls, 0)
    assert.equal(dispatches.length, 1, "no analyze_image_fetch for data: residual")
    assert.equal(dispatches[0].name, "analyze_image")
  })
})
