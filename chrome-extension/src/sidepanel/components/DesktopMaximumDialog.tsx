import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { AUTOPILOT_ARM_PHRASE } from "./autopilot-tier"
import { Modal } from "./ui/Modal"

type Offer = { review_id: string; apps: { token: string; name: string }[]; receiver: { model: string; endpoint: string } | null }

export function DesktopMaximumDialog({ onClose }: { onClose(): void }) {
  const { state } = useAgentStore()
  const [offer, setOffer] = useState<Offer>()
  const [images, setImages] = useState(false)
  const [phrase, setPhrase] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const active = (state.desktopMaximumExpiresAt ?? 0) > Date.now()
  useEffect(() => {
    let mounted = true
    setPhrase(""); setImages(false); setOffer(undefined); setError("")
    const timeout = !active ? setTimeout(() => setError("尚未收到 Companion 的授权范围，请检查连接和版本。"), 8000) : undefined
    const receive = (msg: any, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return
      if (msg.type === "computer.maximum.reviewed") { clearTimeout(timeout); setError(""); setOffer(msg) }
      if (msg.type === "computer.maximum.error") { setPending(false); setOffer(undefined); setError(msg.error) }
      if (msg.type === "computer.maximum.status") setPending(false)
    }
    chrome.runtime.onMessage.addListener(receive)
    if (!active) chrome.runtime.sendMessage({ type: "computer.maximum.review" }).then(r => {
      if (mounted && !r?.ok) { clearTimeout(timeout); setError("请重新加载扩展，并连接支持桌面最大权限的 Companion。") }
    }).catch(() => { if (mounted) setError("无法连接 Companion。") })
    return () => { mounted = false; clearTimeout(timeout); chrome.runtime.onMessage.removeListener(receive) }
  }, [active])
  const submit = async () => {
    setPending(true)
    const request = active ? { type: "computer.maximum.revoke" } :
      { type: "computer.maximum.arm", review_id: offer?.review_id, images, confirmation_phrase: phrase }
    try {
      const reply = await chrome.runtime.sendMessage(request)
      if (!reply?.ok) throw new Error()
    } catch { setPending(false); setError("请求未送达，请重新连接后再试。") }
  }
  return <Modal open onClose={onClose} role="alertdialog" ariaLabel="桌面最大权限" backdropDismiss={false}
    overlayStyle={{ position: "fixed", inset: 0, zIndex: 20000, background: tokens.scrim, display: "grid", alignItems: "center", padding: 12 }}
    panelStyle={{ background: tokens.bgElevated, color: tokens.text, padding: 16, borderRadius: 12, lineHeight: 1.55, maxHeight: "85vh", overflow: "auto", overflowWrap: "anywhere" }}>
    <strong>桌面最大权限</strong>
    {active ? <p role="status">已授权至 {new Date(state.desktopMaximumExpiresAt!).toLocaleTimeString()}。更换模型、接收地址或密钥后，需解除并重新授权才能向新配置发图。解除会停止正在执行的桌面操作。</p> : <>
      <p>允许本次扩展连接下的所有普通对话（包括新建对话）自动启动、查看、点击和键入以下应用。操作可能修改文件或提交表单，执行前不会逐步预览。</p>
      {offer ? (offer.apps.length ? <ul>{offer.apps.map(app => <li key={app.token}>{app.name}（{app.token}）</li>)}</ul>
        : <p>请先在“应用”中开启电脑操控，并授权至少一个应用。</p>) : !error && <p role="status">正在读取已授权应用…</p>}
      {offer?.receiver && <label><input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)} /> 同时允许把目标窗口图发给 {offer.receiver.model}（{offer.receiver.endpoint}），并自动执行模型建议的点击。窗口图可能包含私人内容，模型也可能点错。</label>}
      <p>默认仅使用本机无障碍接口和文字识别。授权最长 8 小时，连接断开或 Companion 重启即失效。点击“急停”可中断任务，也可以随时在此解除。</p>
      <label>输入“{AUTOPILOT_ARM_PHRASE}”确认 <input value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off" /></label>
    </>}
    {error && <p role="alert">{error}</p>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="button" onClick={onClose}>关闭</button>
      <button type="button" disabled={pending || (!active && (!offer?.apps.length || phrase !== AUTOPILOT_ARM_PHRASE))}
        onClick={submit}>{active ? "解除桌面最大权限" : "确认授权"}</button>
    </div>
  </Modal>
}
