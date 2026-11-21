/** Open a full workspace without reloading a tab that may own a recording. */
export type WorkbenchPage = "today" | "meeting" | "transcribe" | "recording" | "translation"

export async function openWorkbench(page: WorkbenchPage): Promise<boolean> {
  if (window.location.pathname === "/tabs/workspace.html") {
    const event = new CustomEvent("cmspark:workbench-page", { detail: page, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  const base = chrome.runtime.getURL("tabs/workspace.html")
  try {
    await navigator.locks.request("cmspark-open-workbench", async () => {
      const tabs = await chrome.tabs.query({ url: base + "*" })
      const existing = tabs.find(tab => tab.id !== undefined && tab.url?.split(/[?#]/)[0] === base)
      if (existing?.id === undefined) {
        await chrome.tabs.create({ url: base + "#" + page })
      } else {
        const url = new URL(existing.url!)
        // A unique fragment also focuses the selected page after internal navigation.
        url.hash = page + "/" + crypto.randomUUID()
        await chrome.tabs.update(existing.id, { active: true, url: url.href })
        await chrome.windows.update(existing.windowId, { focused: true })
      }
    })
    return true
  } catch {
    window.dispatchEvent(new CustomEvent("cmspark:toast", { detail: "个人工作台未能打开，请重试。" }))
    return false
  }
}
