import { useCallback, useEffect, useRef, useState } from "react"
import { MICROPHONE_DEVICE_KEY } from "../voice/microphone-device"

type MicrophoneFooter = { dirty: boolean; busy: boolean; save: () => Promise<boolean>; error?: string }

export function MicrophoneDeviceSelect({ onFooterSave }: { onFooterSave: (control: MicrophoneFooter | null) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState("")
  const [hasDraft, setHasDraft] = useState(false)
  const draftRef = useRef(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const values = useRef({ selected: "", stored: "" })
  const selectionRevision = useRef(0)

  const applyStored = useCallback((value: unknown) => {
    const next = typeof value === "string" ? value : ""
    const previous = values.current
    const selectedNext = !savingRef.current && !draftRef.current ? next : previous.selected
    values.current = { selected: selectedNext, stored: next }
    setSelected(selectedNext)
    selectionRevision.current += 1
  }, [])

  useEffect(() => {
    let active = true
    const media = navigator.mediaDevices
    const refresh = async () => {
      const revision = selectionRevision.current
      try {
        const [all, saved] = await Promise.all([
          media.enumerateDevices(), chrome.storage.local.get(MICROPHONE_DEVICE_KEY),
        ])
        if (!active) return
        setDevices(all.filter(device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"))
        if (revision === selectionRevision.current && !savingRef.current) applyStored(saved[MICROPHONE_DEVICE_KEY])
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
  }, [applyStored])

  useEffect(() => {
    const changes = chrome.storage?.onChanged
    if (!changes) return
    const onChanged = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !items[MICROPHONE_DEVICE_KEY]) return
      applyStored(items[MICROPHONE_DEVICE_KEY]?.newValue)
    }
    changes.addListener(onChanged)
    return () => changes.removeListener(onChanged)
  }, [applyStored])

  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false
    const submitted = values.current.selected
    if (!draftRef.current) return true
    savingRef.current = true
    setSaving(true)
    setError("")
    try {
      await chrome.storage.local.set({ [MICROPHONE_DEVICE_KEY]: submitted })
      const saved = await chrome.storage.local.get(MICROPHONE_DEVICE_KEY)
      const next = typeof saved[MICROPHONE_DEVICE_KEY] === "string" ? saved[MICROPHONE_DEVICE_KEY] : ""
      applyStored(next)
      if (next !== submitted) throw new Error("麦克风设置已在其他窗口更改，请核对后重试。")
      if (values.current.selected === submitted) {
        draftRef.current = false
        setHasDraft(false)
        setSelected(submitted)
      }
      return true
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("其他窗口") ? cause.message : "麦克风选择未保存，请重试。")
      return false
    } finally {
      selectionRevision.current += 1
      savingRef.current = false
      setSaving(false)
    }
  }, [applyStored])

  useEffect(() => {
    onFooterSave({ dirty: hasDraft, busy: saving, save, error: error || undefined })
  }, [onFooterSave, hasDraft, saving, save, error])
  useEffect(() => () => onFooterSave(null), [onFooterSave])

  return <div style={{ display: "grid", gap: 4, marginTop: 12 }}>
    <label htmlFor="voice-microphone-device">麦克风</label>
    <select id="voice-microphone-device" value={selected} disabled={saving} onChange={event => {
      const next = event.target.value
      values.current = { ...values.current, selected: next }
      draftRef.current = next !== values.current.stored
      setHasDraft(draftRef.current)
      selectionRevision.current += 1
      setSelected(next)
      setError("")
    }} style={{ display: "block", width: "100%" }}>
      <option value="">跟随 Chrome 默认麦克风</option>
      {selected && !devices.some(device => device.deviceId === selected) && <option value={selected}>所选麦克风不可用</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
    </select>
    <span>用于本机、系统和外部转写；浏览器听写使用 Chrome 的麦克风设置。设备名称需要浏览器麦克风权限。</span>
    {error && <span role="alert">{error}</span>}
  </div>
}
