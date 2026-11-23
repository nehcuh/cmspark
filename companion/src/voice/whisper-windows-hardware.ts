import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

export type WindowsWhisperAdapter = {
  name: string
  vendor: "nvidia" | "amd" | "intel" | "other"
  kind: "physical" | "virtual" | "unknown"
  driverVersion?: string
  driverIssue?: true
  vramMB?: number
}

export type WindowsWhisperHardware = {
  adapters: WindowsWhisperAdapter[]
  cudaDriver: boolean
  vulkanLoader: boolean
  inventoryAvailable: boolean
}

const VIRTUAL_DISPLAY = /\b(?:virtual|remote display|hyper-v|vmware|virtualbox|parallels|qxl|llvmpipe|swiftshader|software rasterizer|basic render driver)\b|idd(?:sample|driver)/i
const INVENTORY_TTL_MS = 30_000
const MIB = 1024 * 1024

export function isVirtualDisplayDevice(name: string): boolean {
  return VIRTUAL_DISPLAY.test(name)
}

export function adapterLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 160) : ""
}

function vendorOf(pnpId: string, name: string): WindowsWhisperAdapter["vendor"] {
  const pciVendor = /^PCI\\VEN_([\da-f]{4})\b/i.exec(pnpId)?.[1]?.toLowerCase()
  if (pciVendor === "10de") return "nvidia"
  if (pciVendor === "1002") return "amd"
  if (pciVendor === "8086") return "intel"
  if (/\bNVIDIA\b/i.test(name)) return "nvidia"
  if (/\b(?:AMD|Radeon)\b/i.test(name)) return "amd"
  if (/\bIntel\b/i.test(name)) return "intel"
  return "other"
}

type CimAdapter = Record<string, unknown>

function parseCimRows(stdout: string): CimAdapter[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""))
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.filter((row): row is CimAdapter => !!row && typeof row === "object")
  } catch {
    return null
  }
}

/** Win32_VideoController.AdapterRAM is uint32 and cannot represent large NVIDIA cards. */
export function parseWindowsWhisperAdapters(cimJson: string, nvidiaSmi = ""): WindowsWhisperAdapter[] {
  const adapters = (parseCimRows(cimJson) ?? []).flatMap((row): WindowsWhisperAdapter[] => {
    const name = adapterLabel(row.Name)
    if (!name) return []
    const id = typeof row.PNPDeviceID === "string" ? row.PNPDeviceID : ""
    const kind = isVirtualDisplayDevice(name) || /^(?:ROOT|SWD)\\/i.test(id)
      ? "virtual"
      : /^(?:PCI|ACPI)\\/i.test(id) ? "physical" : "unknown"
    const vendor = vendorOf(id, name)
    const driverVersion = adapterLabel(row.DriverVersion)
    const bytes = typeof row.AdapterRAM === "number" ? row.AdapterRAM : 0
    const vramMB = bytes >= MIB && bytes < 4095 * MIB ? Math.round(bytes / MIB) : undefined
    return [{
      name,
      kind,
      vendor,
      ...(driverVersion ? { driverVersion } : {}),
      ...(row.ConfigManagerErrorCode !== 0 ? { driverIssue: true } : {}),
      ...(vramMB !== undefined ? { vramMB } : {}),
    }]
  })

  const nvidiaMemory = new Map<string, number[]>()
  for (const line of nvidiaSmi.split(/\r?\n/)) {
    const match = /^[\da-f:.]+,\s*(.+),\s*(\d+)\s*$/i.exec(line)
    if (!match) continue
    const name = adapterLabel(match[1]).toLowerCase()
    const vramMB = Number(match[2])
    if (!Number.isSafeInteger(vramMB) || vramMB <= 0) continue
    const values = nvidiaMemory.get(name) ?? []
    values.push(vramMB)
    nvidiaMemory.set(name, values)
  }
  for (const adapter of adapters) {
    if (adapter.vendor !== "nvidia" || adapter.kind !== "physical") continue
    const name = adapter.name.toLowerCase()
    const reported = nvidiaMemory.get(name)
    if (reported?.length === 1 && adapters.filter((a) => a.kind === "physical" && a.name.toLowerCase() === name).length === 1) {
      adapter.vramMB = reported[0]
    }
  }
  return adapters
}

export function windowsSystemDirectory(): string {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32")
}

function captureInventory(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 4_000, maxBuffer: 256 * 1024, windowsHide: true, shell: false },
      (error, stdout) => resolve(error ? "" : stdout))
  })
}

async function detectWindowsWhisperHardware(): Promise<WindowsWhisperHardware> {
  const system = windowsSystemDirectory()
  const powerShell = path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe")
  const nvidiaSmi = [
    path.join(system, "nvidia-smi.exe"),
    path.join(process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files",
      "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
  ].find(existsSync)
  const cimCommand = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$ErrorActionPreference = 'Stop'",
    "$adapters = @(Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,AdapterRAM,DriverVersion,ConfigManagerErrorCode)",
    "ConvertTo-Json -InputObject $adapters -Compress",
  ].join("\n")
  const [cimJson, smiText] = await Promise.all([
    captureInventory(powerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", cimCommand]),
    nvidiaSmi
      ? captureInventory(nvidiaSmi, ["--query-gpu=pci.bus_id,name,memory.total", "--format=csv,noheader,nounits"])
      : "",
  ])
  return {
    adapters: parseWindowsWhisperAdapters(cimJson, smiText),
    cudaDriver: existsSync(path.join(system, "nvcuda.dll")),
    vulkanLoader: existsSync(path.join(system, "vulkan-1.dll")),
    inventoryAvailable: parseCimRows(cimJson) !== null,
  }
}

let cachedInventory: { expires: number; value: Promise<WindowsWhisperHardware> } | undefined

/** Share one bounded CIM/SMI query across settings, prewarm and consecutive utterances. */
export function getWindowsWhisperHardware(): Promise<WindowsWhisperHardware> {
  if (!cachedInventory || Date.now() >= cachedInventory.expires) {
    cachedInventory = { expires: Date.now() + INVENTORY_TTL_MS, value: detectWindowsWhisperHardware() }
  }
  return cachedInventory.value
}
