import { useEffect, useMemo, useState } from "react"
import { matchSite } from "../../shared/skills/site-matcher"

/** The panel belongs to one Chrome window even when another window has focus. */
export function watchCurrentTabHostname(publish: (hostname: string) => void) {
  let generation = 0
  const refresh = () => {
    const request = ++generation
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const url = chrome.runtime.lastError ? undefined : tabs[0]?.url
      if (request !== generation) return
      let hostname = ""
      try {
        if (url) hostname = new URL(url).hostname
      } catch { /* A tab without a usable URL has no matching group. */ }
      publish(hostname)
    })
  }
  const updated = (_id: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (tab.active && (change.url !== undefined || change.status === "complete")) refresh()
  }
  chrome.tabs.onActivated.addListener(refresh)
  chrome.tabs.onUpdated.addListener(updated)
  refresh()
  return () => {
    generation++
    chrome.tabs.onActivated.removeListener(refresh)
    chrome.tabs.onUpdated.removeListener(updated)
  }
}

export function groupBySite<T extends { site?: string }>(items: readonly T[], hostname: string): [string, T[]][] {
  const global: T[] = []
  const sites = new Map<string, T[]>()
  for (const item of items) {
    if (item.site) {
      const group = sites.get(item.site)
      if (group) group.push(item)
      else sites.set(item.site, [item])
    } else {
      global.push(item)
    }
  }
  const sorted = [...sites.entries()].sort(([a], [b]) =>
    Number(matchSite(b, hostname)) - Number(matchSite(a, hostname)) || a.localeCompare(b),
  )
  if (global.length) sorted.unshift(["全局", global])
  return sorted
}

export function useSiteGroups<T extends { site?: string }>(items: readonly T[]) {
  const [hostname, setHostname] = useState("")
  useEffect(() => watchCurrentTabHostname(setHostname), [])
  return useMemo(() => groupBySite(items, hostname), [items, hostname])
}
