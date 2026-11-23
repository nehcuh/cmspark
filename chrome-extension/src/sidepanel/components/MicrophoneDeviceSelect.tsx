import { useEffect, useRef, useState } from "react"
import { MICROPHONE_DEVICE_KEY } from "../voice/microphone-device"

export function MicrophoneDeviceSelect() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const selectionRevision = useRef(0)
  const changedWhileSaving = useRef<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    const media = navigator.mediaDevices
    const refresh = async () => {
      const revision = selectionRevision.current
      try {
        const [all, stored] = await Promise.all([
          media.enumerateDevices(), chrome.storage.local.get(MICROPHONE_DEVICE_KEY),
        ])
        if (!active) return
        setDevices(all.filter(device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"))
        if (revision === selectionRevision.current && !savingRef.current) {
          setSelected(typeof stored[MICROPHONE_DEVICE_KEY] === "string" ? stored[MICROPHONE_DEVICE_KEY] : "")
        }
        setError("")
      } catch {
        if (active) setError("无法读取麦克风设备，请检查浏览器权限。")
      }
    }
    if (media?.enumerateDevices) {
      void refresh()
      media.addEventListener?.("devicechange", refresh)
    } else setError("当前浏览器无法列出麦克风。")
    return () => { active = false; media?.removeEventListener?.("devicechange", refresh) }
  }, [])

  useEffect(() => {
    const changes = chrome.storage?.onChanged
    if (!changes) return
    const onChanged = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !items[MICROPHONE_DEVICE_KEY]) return
      const value = items[MICROPHONE_DEVICE_KEY]?.newValue
      const next = typeof value === "string" ? value : ""
      selectionRevision.current += 1
      if (savingRef.current) changedWhileSaving.current = next
      else setSelected(next)
    }
    changes.addListener(onChanged)
    return () => changes.removeListener(onChanged)
  }, [])

  const change = async (value: string) => {
    if (savingRef.current) return
    savingRef.current = true
    changedWhileSaving.current = undefined
    selectionRevision.current += 1
    setSaving(true)
    try {
      await chrome.storage.local.set({ [MICROPHONE_DEVICE_KEY]: value })
      const stored = await chrome.storage.local.get(MICROPHONE_DEVICE_KEY)
      setSelected(typeof stored[MICROPHONE_DEVICE_KEY] === "string" ? stored[MICROPHONE_DEVICE_KEY] : "")
      setError("")
    } catch {
      setError("麦克风选择未保存，请重试。")
    } finally {
      selectionRevision.current += 1
      savingRef.current = false
      if (changedWhileSaving.current !== undefined) setSelected(changedWhileSaving.current)
      changedWhileSaving.current = undefined
      setSaving(false)
    }
  }

  return <div style={{ display: "grid", gap: 4, marginTop: 12 }}>
    <label htmlFor="voice-microphone-device">麦克风</label>
      <select id="voice-microphone-device" value={selected} disabled={saving} onChange={event => void change(event.target.value)} style={{ display: "block", width: "100%" }}>
        <option value="">跟随 Chrome 默认麦克风</option>
        {selected && !devices.some(device => device.deviceId === selected) && <option value={selected}>所选麦克风不可用</option>}
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
      </select>
    <span>用于本机、系统和外部转写；浏览器听写使用 Chrome 的麦克风设置。设备名称需要浏览器麦克风权限。</span>
    {error && <span role="alert">{error}</span>}
  </div>
}
