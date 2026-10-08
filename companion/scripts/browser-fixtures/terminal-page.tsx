// Controlled loopback fixture only. Real TerminalApp + xterm + WSClient + terminal relay.
import React from "react"
import { createRoot } from "react-dom/client"
import { TerminalApp } from "../../../chrome-extension/src/terminal/TerminalApp"
import { WSClient } from "../../../chrome-extension/src/background/ws-client"
import { attachTerminalPort, type TerminalRelay } from "../../../chrome-extension/src/background/terminal"

declare global { interface Window { fixture: { port: number; secret: string } } }
const config = window.fixture
let relay: TerminalRelay | null = null
let client: WSClient
const events = <T,>() => { const listeners: Array<(value: T) => void> = []; return { addListener(fn: (value: T) => void) { listeners.push(fn) }, fire(value: T) { listeners.forEach(fn => fn(value)) } } }
const alarms = new Map<string, ReturnType<typeof setTimeout>>()
const onAlarm = events<{ name: string }>()
;(window as any).chrome = {
  runtime: { id: "fixture", getURL: () => "chrome-extension://fixture/tabs/embedded-terminal.html",
    connect() {
      const toTab = events<unknown>(), toRelay = events<unknown>(), disconnected = events<void>()
      const backgroundPort = { sender: { id: "fixture", url: "chrome-extension://fixture/tabs/embedded-terminal.html", frameId: 0 },
        postMessage: (frame: unknown) => toTab.fire(frame), onMessage: toRelay, onDisconnect: disconnected }
      relay = attachTerminalPort(backgroundPort as never, frame => client.send(frame), () => {})
      return { postMessage: (frame: unknown) => toRelay.fire(frame), onMessage: toTab, onDisconnect: events<void>(), disconnect() { disconnected.fire() } }
    } },
  storage: { local: { get: async () => ({ wsSharedSecret: config.secret }) } },
  alarms: { onAlarm, clear: (name: string) => { clearTimeout(alarms.get(name)); return Promise.resolve(true) },
    create: (name: string, options: { delayInMinutes: number }) => {
      clearTimeout(alarms.get(name)); alarms.set(name, setTimeout(() => onAlarm.fire({ name }), options.delayInMinutes * 60000))
    } },
}
client = new WSClient({ url: `ws://127.0.0.1:${config.port}`,
  onMessage: frame => {
    if (frame.type === "fixture.confirm") {
      document.getElementById("confirmation")!.textContent = frame.code
      document.getElementById("approve")!.removeAttribute("disabled")
    } else relay?.handleWsFrame(frame)
  }, onConnectionLost: () => relay?.handleConnectionLost(), onStateChange: state => {
    document.getElementById("transport")!.textContent = `WS: ${state}`
    if (state === "connected") relay?.handleConnectionRestored()
  } })
onAlarm.addListener(() => client.connect())
document.getElementById("approve")!.onclick = () => { client.send({ type: "fixture.approve" }); document.getElementById("approve")!.setAttribute("disabled", "") }
document.getElementById("drop")!.onclick = () => client.send({ type: "fixture.drop" })
document.getElementById("narrow")!.onclick = () => { document.getElementById("root")!.style.width = "650px" }
document.getElementById("start")!.onclick = () => { createRoot(document.getElementById("root")!).render(<TerminalApp />); document.getElementById("start")!.setAttribute("disabled", "") }
client.connect()
