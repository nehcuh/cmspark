// Browser Bridge — executes tool calls via Chrome APIs and CDP

import { PageSanitizer, pageSanitizer } from "./page-sanitizer"
import { fetchImageAsBase64 } from "./image-extract-utils"
import { detectDangerousApis } from "./dangerous-apis"

interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

// chrome.scripting.InjectionResult in @types/chrome omits the runtime `error` field that Chrome
// sets when an injection fails; include it locally so the fallback-on-injection-error logic in
// scriptingExecute type-checks (audit H7 — the build was shipping with these tsc errors).
type ScriptingResult = chrome.scripting.InjectionResult<any> & { error?: string }

export class BrowserBridge {
  private attachedTabs: Set<number> = new Set()
  private sanitizer: PageSanitizer

  constructor(sanitizer?: PageSanitizer) {
    this.sanitizer = sanitizer || pageSanitizer
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) {
        this.attachedTabs.delete(source.tabId)
        console.log(`[BrowserBridge] Tab ${source.tabId} detached externally from debugger.`)
      }
    })
  }

  getConfig() {
    return {
      attachedTabCount: this.attachedTabs.size,
    }
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    try {
      switch (toolName) {
        // Tab tools
        case "list_tabs":
          return await this.listTabs()
        case "create_tab":
          return await this.createTab(params)
        case "close_tab":
          return await this.closeTab(params)
        case "navigate":
          return await this.navigate(params)
        case "screenshot":
          return await this.screenshot(params)
        case "analyze_image":
          return await this.analyzeImage(params)
        case "analyze_image_fetch":
          return await this.analyzeImageFetch(params)

        // Page read tools
        case "get_page_text":
          return await this.getPageText(params)
        case "get_page_html":
          return await this.getPageHTML(params)
        case "get_element_info":
          return await this.getElementInfo(params)

        // Page interaction tools
        case "click":
        case "dblclick":
          return await this.click(params, toolName === "dblclick" ? 2 : 1)
        case "type":
          return await this.typeText(params)
        case "fill_form":
          return await this.fillForm(params)
        case "scroll":
        case "scroll_to":
          return await this.scroll(params)
        case "press_key":
          return await this.pressKey(params)
        case "hover":
          return await this.hover(params)
        case "select_option":
          return await this.selectOption(params)
        case "drag_and_drop":
          return await this.dragAndDrop(params)

        // Advanced tools
        case "wait_for":
          return await this.waitFor(params)
        case "evaluate":
          return await this.evaluate(params)
        case "upload_file":
          return await this.uploadFile(params)
        case "download":
          return await this.download(params)

        // Cookie tools
        case "get_cookies":
          return await this.getCookies(params)
        case "set_cookie":
          return await this.setCookie(params)
        case "delete_cookie":
          return await this.deleteCookie(params)
        case "list_all_cookies":
          return await this.listAllCookies()

        default:
          return { success: false, error: `Unknown tool: ${toolName}` }
      }
    } catch (e: any) {
      return { success: false, error: e.message || String(e) }
    }
  }

  // --- CDP helpers ---

  private async ensureAttached(tabId: number): Promise<void> {
    if (this.attachedTabs.has(tabId)) return

    // Verify tab exists and is accessible
    try {
      // Retry up to 10 times with delay — tab URL may be blank during creation/navigation
      let tab: chrome.tabs.Tab | undefined
      for (let attempt = 0; attempt < 10; attempt++) {
        tab = await chrome.tabs.get(tabId)
        const url = tab.url || ""
        if (url && !url.startsWith("chrome-extension://") && !url.startsWith("chrome://") && url !== "about:blank") break
        if (attempt < 9) await new Promise(r => setTimeout(r, 500))
      }
      if (!tab) throw new Error(`Tab ${tabId} not found`)
      if (tab.url?.startsWith("chrome-extension://")) {
        throw new Error(`Cannot access a chrome-extension:// URL of different extension (tab ${tabId})`)
      }
      if (tab.url?.startsWith("chrome://")) {
        throw new Error(`Cannot access chrome:// URL (tab ${tabId})`)
      }
    } catch (e: any) {
      if (e.message.includes("Cannot access")) throw e
      // Tab might have been closed
      throw new Error(`No tab with given id ${tabId}.`)
    }

    try {
      await chrome.debugger.attach({ tabId }, "1.3")
      this.attachedTabs.add(tabId)
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.enable")
      } catch { /* ignore */ }
    } catch (e: any) {
      // Try scripting API as fallback for page read tools
      throw new Error(`Debugger attach failed for tab ${tabId}: ${e.message}`)
    }
  }

  private async sendCdp(tabId: number, method: string, params?: any): Promise<any> {
    await this.ensureAttached(tabId)
    return chrome.debugger.sendCommand({ tabId }, method, params)
  }

  private async getOuterHTMLViaDom(tabId: number, selector?: string): Promise<string> {
    await this.ensureAttached(tabId)
    try {
      await chrome.debugger.sendCommand({ tabId }, "DOM.enable")
    } catch { /* ignore */ }

    const { root } = await this.sendCdp(tabId, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    })
    if (!root?.nodeId) throw new Error("Could not retrieve DOM root")

    let nodeId = root.nodeId
    if (selector) {
      const result = await this.sendCdp(tabId, "DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      })
      if (!result.nodeId) throw new Error(`Element not found: ${selector}`)
      nodeId = result.nodeId
    }

    const { outerHTML } = await this.sendCdp(tabId, "DOM.getOuterHTML", { nodeId })
    return String(outerHTML || "").substring(0, 500000)
  }

  // Execute JS via chrome.scripting. ISOLATED world first (CSP-safe),
  // then MAIN world if ISOLATED had injection errors (some SPAs block ISOLATED).
  private async scriptingExecute(tabId: number, code: string): Promise<any> {
    // Detect simple read-only expressions — use direct DOM funcs, no new Function()
    const bodyTextExpr = code === "document.body?.innerText || ''"
    const bodyHtmlExpr = code.startsWith("document.querySelector('html')")

    // Strategy 1: ISOLATED world
    try {
      let results: ScriptingResult[] | undefined
      if (bodyTextExpr) {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true,
          func: () => document.body?.innerText || "",
        })
      } else if (bodyHtmlExpr) {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true,
          func: () => document.querySelector("html")?.outerHTML?.substring(0, 500000) || "",
        })
      } else {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true,
          func: (expr: string) => { return new Function(`return (${expr})`)() },
          args: [code],
        })
      }
      // Only fall through if there was an actual injection error (not just empty result)
      if (!results?.[0]?.error) return results?.[0]?.result
    } catch { /* fall through to MAIN world */ }

    // Strategy 2: MAIN world (subject to page CSP)
    try {
      let results: ScriptingResult[] | undefined
      if (bodyTextExpr) {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true, world: "MAIN",
          func: () => document.body?.innerText || "",
        })
      } else if (bodyHtmlExpr) {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true, world: "MAIN",
          func: () => document.querySelector("html")?.outerHTML?.substring(0, 500000) || "",
        })
      } else {
        results = await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true, world: "MAIN",
          func: (expr: string) => eval(expr),
          args: [code],
        })
      }
      if (!results?.[0]?.error) return results?.[0]?.result
    } catch { /* fall through */ }

    throw new Error("Script injection failed in both ISOLATED and MAIN worlds")
  }

  private getTabId(params: Record<string, any>): number {
    if (params.tabId) return params.tabId
    throw new Error("tabId is required")
  }

  // --- Tab tools ---

  private async listTabs(): Promise<ToolResult> {
    const tabs = await chrome.tabs.query({})
    return {
      success: true,
      data: tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        windowId: t.windowId,
        index: t.index,
        pinned: t.pinned,
        status: t.status,
      })),
    }
  }

  private async createTab(params: Record<string, any>): Promise<ToolResult> {
    const tab = await chrome.tabs.create({
      url: params.url || "about:blank",
      active: params.active !== false,
    })
    return { success: true, data: { id: tab.id, url: tab.url, title: tab.title } }
  }

  private async closeTab(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    await chrome.tabs.remove(tabId)
    this.attachedTabs.delete(tabId)
    return { success: true }
  }

  private async navigateWithWait(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.url) throw new Error("url is required")

    const tab = await chrome.tabs.update(tabId, { url: params.url })

    // Wait for page load unless explicitly skipped
    if (params.wait_for_load !== false && tab.id) {
      await this.waitForTabLoad(tab.id)
      const updated = await chrome.tabs.get(tab.id)
      return { success: true, data: { id: updated.id, url: updated.url, title: updated.title } }
    }

    return { success: true, data: { id: tab.id, url: tab.url, title: tab.title } }
  }

  /** Wait for a tab to finish loading */
  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now()
      const maxWait = 30000 // 30s max

      const check = async () => {
        try {
          const tab = await chrome.tabs.get(tabId)
          if (tab.status === "complete") return resolve()
        } catch { return resolve() } // tab closed
        if (Date.now() - start > maxWait) return resolve()
        setTimeout(check, 300)
      }

      // Also listen for onUpdated in case the tab hasn't started loading yet
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)

      // Fallback: poll check
      setTimeout(check, 300)

      // Cleanup listener after maxWait
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }, maxWait)
    })
  }

  private async navigate(params: Record<string, any>): Promise<ToolResult> {
    return this.navigateWithWait(params)
  }

  private async screenshot(params: Record<string, any>): Promise<ToolResult> {
    let tabId = params.tabId
    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!activeTab?.id) throw new Error("No active tab found")
      tabId = activeTab.id
    }

    const tab = await chrome.tabs.get(tabId)

    // Try CDP screenshot first (full page, high quality)
    try {
      const result = await this.sendCdp(tabId, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 80,
      })
      let width = 0, height = 0
      try {
        const metrics = await this.sendCdp(tabId, "Page.getLayoutMetrics")
        width = metrics.cssVisualViewport?.clientWidth || 0
        height = metrics.cssVisualViewport?.clientHeight || 0
      } catch { /* ignore */ }
      return {
        success: true,
        data: { image_base64: result.data, width, height, url: tab.url, title: tab.title },
      }
    } catch {
      // Fallback: captureVisibleTab (no debugger needed, viewport-only)
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 80 })
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "")
      return {
        success: true,
        data: { image_base64: base64, width: tab.width || 0, height: tab.height || 0, url: tab.url, title: tab.title },
      }
    }
  }

  private async analyzeImage(params: Record<string, any>): Promise<ToolResult> {
    let tabId = params.tabId
    const selector = params.selector

    if (!selector) {
      return { success: false, error: "selector is required for analyze_image" }
    }

    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!activeTab?.id) throw new Error("No active tab found")
      tabId = activeTab.id
    }

    const tab = await chrome.tabs.get(tabId)

    // Extract image data from the element via CDP
    // Uses Canvas to handle both same-origin and cross-origin images
    const extractResult = await this.sendCdp(tabId, "Runtime.evaluate", {
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: "Element not found: " + ${JSON.stringify(selector)} };

          // For <img> elements
          if (el.tagName === "IMG") {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = el.naturalWidth || el.width;
              canvas.height = el.naturalHeight || el.height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(el, 0, 0);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
              return {
                base64: dataUrl.replace(/^data:image\\/\\w+;base64,/, ""),
                width: canvas.width,
                height: canvas.height,
                src: el.src || "",
                alt: el.alt || ""
              };
            } catch (e) {
              // Cross-origin image tainted the canvas. Signal the background to
              // fetch the raw bytes directly — host_permissions: <all_urls> lets
              // the service worker bypass page CORS / canvas taint.
              const src = el.currentSrc || el.src || "";
              if (!src) return { error: "Cannot extract image (CORS, no src): " + e.message };
              return {
                fetchSrc: src,
                width: el.naturalWidth || el.width || 0,
                height: el.naturalHeight || el.height || 0,
                alt: el.alt || ""
              };
            }
          }

          // For <canvas> elements
          if (el.tagName === "CANVAS") {
            const dataUrl = el.toDataURL("image/jpeg", 0.8);
            return {
              base64: dataUrl.replace(/^data:image\\/\\w+;base64,/, ""),
              width: el.width,
              height: el.height,
              src: "",
              alt: ""
            };
          }

          // For <video> elements — capture current frame
          if (el.tagName === "VIDEO") {
            const canvas = document.createElement("canvas");
            canvas.width = el.videoWidth || el.width;
            canvas.height = el.videoHeight || el.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(el, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
            return {
              base64: dataUrl.replace(/^data:image\\/\\w+;base64,/, ""),
              width: canvas.width,
              height: canvas.height,
              src: el.src || "",
              alt: ""
            };
          }

          // For SVG or other elements — render to Canvas via foreignObject
          try {
            const rect = el.getBoundingClientRect();
            const canvas = document.createElement("canvas");
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext("2d");
            const svg = new XMLSerializer().serializeToString(el);
            const img = new Image();
            const blob = new Blob([svg], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            return new Promise((resolve) => {
              img.onload = () => {
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
                resolve({
                  base64: dataUrl.replace(/^data:image\\/\\w+;base64,/, ""),
                  width: canvas.width,
                  height: canvas.height,
                  src: "",
                  alt: el.getAttribute("aria-label") || ""
                });
              };
              img.onerror = () => resolve({ error: "Failed to render element" });
              img.src = url;
            });
          } catch (e) {
            return { error: "Cannot render element: " + e.message };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    })

    const data = extractResult?.result?.value
    if (!data) {
      return { success: false, error: "Failed to extract image data" }
    }
    // Cross-origin image: the in-page canvas was tainted. Do NOT fetch here —
    // the companion IMAGE_FETCH_GATE (§6.1) must approve the candidate URL first
    // (it may be an internal/metadata endpoint = SSRF). Return the candidate so
    // the companion can gate, then dispatch analyze_image_fetch for the fetch.
    if (data.fetchSrc) {
      return {
        success: true,
        data: {
          type: "fetch_required",
          candidate_url: data.fetchSrc,
          width: data.width,
          height: data.height,
          title: tab.title,
          alt_text: data.alt || "",
          selector,
        },
      }
    }
    if (data.error) {
      return { success: false, error: data.error }
    }

    // Path A — same-origin canvas (bytes already in the page; screenshot already
    // captures these pixels, so this adds zero exfiltration capability → ungated).
    return {
      success: true,
      data: {
        type: "canvas",
        image_base64: data.base64,
        width: data.width,
        height: data.height,
        url: data.src || tab.url,
        title: tab.title,
        alt_text: data.alt || "",
        selector,
      },
    }
  }

  /** Phase 2 of the analyze_image gate (§6.1.3): the companion has approved the
   *  candidate URL via IMAGE_FETCH_GATE. Fetch the raw bytes from the service
   *  worker (host_permissions bypasses page CORS for the now-approved URL) and
   *  return base64 so the adapter's VISION_TOOLS post-processing can run. */
  private async analyzeImageFetch(params: Record<string, any>): Promise<ToolResult> {
    const candidateUrl = String(params?.candidate_url || "")
    if (!candidateUrl) {
      return { success: false, error: "candidate_url is required for analyze_image_fetch" }
    }
    let title = "fetched image"
    try {
      if (params.tabId != null) {
        const tab = await chrome.tabs.get(Number(params.tabId))
        if (tab?.title) title = tab.title
      }
    } catch {
      /* tab metadata is best-effort only */
    }
    try {
      const { base64 } = await fetchImageAsBase64(candidateUrl)
      return {
        success: true,
        data: {
          type: "canvas",
          image_base64: base64,
          width: Number(params.width) || 0,
          height: Number(params.height) || 0,
          url: candidateUrl,
          title,
          alt_text: String(params.alt_text || ""),
          selector: String(params.selector || ""),
        },
      }
    } catch (e: any) {
      return {
        success: false,
        error: `analyze_image_fetch failed for ${candidateUrl}: ${e?.message || e}`,
      }
    }
  }

  // Safe JS execution: try CDP first, fallback to chrome.scripting
  private async safeEvaluate(tabId: number, expression: string): Promise<any> {
    try {
      return await this.sendCdp(tabId, "Runtime.evaluate", { expression, returnByValue: true })
    } catch {
      // Fallback to chrome.scripting
      const result = await this.scriptingExecute(tabId, expression)
      return { result: { value: result } }
    }
  }

  // --- Page read tools ---

  private async getPageText(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const result = await this.safeEvaluate(tabId, "document.body?.innerText || ''")
    const rawText = result.result?.value || ""
    const sanitized = this.sanitizer.sanitizeText(rawText)
    return {
      success: true,
      data: {
        text: sanitized.sanitized,
        threats_removed: sanitized.threatsRemoved,
      },
    }
  }

  private async getPageHTML(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const selector = params.selector ? `.querySelector('${params.selector}')` : ""
    const expression = `document.querySelector('html')${selector}?.outerHTML?.substring(0, 500000) || ''`
    let html = ""
    let source: "runtime" | "dom" = "runtime"
    try {
      const result = await this.safeEvaluate(tabId, expression)
      html = result.result?.value || ""
    } catch (err: any) {
      try {
        html = await this.getOuterHTMLViaDom(tabId, params.selector)
        source = "dom"
      } catch (domErr: any) {
        throw new Error(`${err.message || String(err)}; DOM fallback failed: ${domErr.message || String(domErr)}`)
      }
    }
    const sanitized = this.sanitizer.sanitize(html)
    const truncated = html.length >= 500000
    return {
      success: true,
      data: {
        html: sanitized.sanitized,
        truncated,
        length: sanitized.sanitized.length,
        source,
        threats_removed: sanitized.threatsRemoved,
      },
    }
  }

  private async getElementInfo(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.selector) throw new Error("selector is required")
    // Safe interpolation: JSON.stringify produces a valid JS string literal.
    const expression = `
      (() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          visible: rect.width > 0 && rect.height > 0,
          text: el.textContent?.substring(0, 500) || '',
          tag: el.tagName?.toLowerCase(),
        };
      })()
    `
    const result = await this.safeEvaluate(tabId, expression)
    if (!result.result?.value) throw new Error(`Element not found: ${params.selector}`)
    return { success: true, data: result.result.value }
  }

  // --- Page interaction tools ---

  private async click(params: Record<string, any>, clickCount = 1): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const selector = params.selector
    try {
      // Wait for element to appear (handles async SPA rendering)
      if (selector) {
        await this.waitForSelector(tabId, selector, 3000)
      }
      const coords = await this.getElementCenter(tabId, selector)
      // Hover/Move mouse first to trigger hover listeners
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseMoved", x: coords.x, y: coords.y,
      })
      await new Promise(r => setTimeout(r, 50)) // Settle hover
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: coords.x, y: coords.y, button: "left", buttons: 1, clickCount,
      })
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: coords.x, y: coords.y, button: "left", buttons: 0, clickCount,
      })
    } catch (err: any) {
      // Fallback: direct DOM click when CDP mouse events fail (e.g. debugger not attached)
      if (selector) {
        // Safe interpolation: JSON.stringify produces a valid JS string literal.
        const found = await this.scriptingExecute(tabId,
          `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.focus();el.click();for(let i=1;i<${clickCount};i++)el.click();return true}return false})()`)
        if (!found) {
          return { success: false, error: `Element not found for selector: ${selector}` }
        }
      } else {
        return { success: false, error: `Click failed and no selector provided: ${err.message}` }
      }
    }
    return { success: true }
  }

  private async typeText(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.value) throw new Error("value is required")

    if (params.selector) {
      await this.click({ tabId, selector: params.selector })
      await new Promise(r => setTimeout(r, 100))
    }

    try {
      await this.sendCdp(tabId, "Input.insertText", { text: params.value })
    } catch {
      // Fallback: set value via DOM scripting.
      // Safe interpolation: JSON.stringify produces a valid JS string literal.
      const valueLit = JSON.stringify(String(params.value))
      if (params.selector) {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.querySelector(${JSON.stringify(params.selector)});if(el){el.value=${valueLit};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true}return false})()`)
      } else {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.activeElement;if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')){el.value=${valueLit};el.dispatchEvent(new Event('input',{bubbles:true}));return true}return false})()`)
      }
    }
    return { success: true }
  }

  private async fillForm(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.fields || !Array.isArray(params.fields)) throw new Error("fields array is required")

    for (const field of params.fields) {
      if (field.clear_first !== false) {
        await this.click({ tabId, selector: field.selector })
        // Select all and delete
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", ctrlKey: true })
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", ctrlKey: true })
        await this.sendCdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete" })
      }
      await this.sendCdp(tabId, "Input.insertText", { text: String(field.value) })
    }
    return { success: true }
  }

  private async scroll(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const deltaX = params.deltaX || 0
    const deltaY = params.deltaY || params.amount || 300
    try {
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel", x: params.x || 300, y: params.y || 300, deltaX, deltaY,
      })
    } catch {
      await this.scriptingExecute(tabId, `window.scrollBy(${deltaX}, ${deltaY})`)
    }
    return { success: true }
  }

  private async pressKey(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.key) throw new Error("key is required")
    const modifiers = params.modifiers || 0
    await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown", key: params.key, code: params.code || `Key${params.key.toUpperCase()}`,
      ctrlKey: !!(modifiers & 2), altKey: !!(modifiers & 1), shiftKey: !!(modifiers & 4), metaKey: !!(modifiers & 8),
    })
    await this.sendCdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp", key: params.key, code: params.code || `Key${params.key.toUpperCase()}`,
      ctrlKey: !!(modifiers & 2), altKey: !!(modifiers & 1), shiftKey: !!(modifiers & 4), metaKey: !!(modifiers & 8),
    })
    return { success: true }
  }

  private async hover(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    try {
      const coords = await this.getElementCenter(tabId, params.selector)
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x, y: coords.y })
    } catch {
      // Fallback: dispatch mouseenter via scripting
      if (params.selector) {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.querySelector(${JSON.stringify(params.selector)});if(el){el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return true}return false})()`)
      }
    }
    return { success: true }
  }

  private async selectOption(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.selector || params.value === undefined) throw new Error("selector and value are required")
    // Safe interpolation: JSON.stringify produces a valid JS string literal (selector AND value).
    await this.sendCdp(tabId, "Runtime.evaluate", {
      expression: `
        (() => {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          if (!el) throw new Error('Select not found');
          el.value = ${JSON.stringify(String(params.value))};
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `,
      returnByValue: true,
    })
    return { success: true }
  }

  private async dragAndDrop(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const from = await this.getElementCenter(tabId, params.from_selector)
    const to = await this.getElementCenter(tabId, params.to_selector)

    await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 })
    // Move in steps for smooth drag
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * (i / steps)
      const y = from.y + (to.y - from.y) * (i / steps)
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 })
      await new Promise(r => setTimeout(r, 30))
    }
    await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 })
    return { success: true }
  }

  // --- Advanced tools ---

  private async waitFor(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const timeout = params.timeout || 15000
    const interval = params.interval || 500
    const selector = params.selector

    if (selector) {
      const expectVisible = params.state !== "hidden"
      const start = Date.now()
      while (Date.now() - start < timeout) {
        try {
          const result = await this.sendCdp(tabId, "Runtime.evaluate", {
            // Safe interpolation: JSON.stringify produces a valid JS string literal.
            expression: `!!document.querySelector(${JSON.stringify(selector)})`,
            returnByValue: true,
          })
          const exists = result.result?.value === true
          if (exists === expectVisible) return { success: true, data: { elapsed_ms: Date.now() - start } }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, interval))
      }
      throw new Error(`Timeout waiting for selector "${selector}" (${expectVisible ? "visible" : "hidden"})`)
    }

    if (params.network_idle) {
      // Wait for page load to complete, then settle period for dynamic content
      await this.waitForTabLoad(tabId)
      // Extra settle time for async content (SPA rendering, lazy loading)
      const settleMs = params.settle_ms || 2000
      await new Promise(r => setTimeout(r, settleMs))
      return { success: true }
      // Wait for network to settle
      await new Promise(r => setTimeout(r, 2000))
      return { success: true }
    }

    throw new Error("selector or network_idle is required")
  }

  private async evaluate(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.code) throw new Error("code is required")

    // Sanitize code before dangerous API detection
    const sanitizedCodeResult = this.sanitizer.sanitizeText(params.code)
    const codeToExecute = sanitizedCodeResult.sanitized

    // ADVISORY ONLY (audit H9): detectDangerousApis annotates the result with
    // statically-matchable risky tokens. It does NOT gate execution — the
    // companion-side SecurityConfirmationManager is the sole authority for
    // whether `evaluate` runs (design decision A4②). The field is named
    // `risk_pattern_matches` (not `has_dangerous_apis`) so an empty result is
    // not mistaken for a safety verdict: regex cannot resolve runtime dispatch
    // like window["ev"+"al"](...), so absence of matches ≠ safe.
    const matches = detectDangerousApis(codeToExecute)

    const result = await this.safeEvaluate(tabId, codeToExecute)

    return {
      success: true,
      data: {
        result: result.result?.value,
        type: result.result?.type,
        risk_pattern_matches: matches.length > 0 ? matches : undefined,
        threats_removed: sanitizedCodeResult.threatsRemoved.length > 0 ? sanitizedCodeResult.threatsRemoved : undefined,
        exception: result.exceptionDetails ? {
          text: result.exceptionDetails.text,
          line: result.exceptionDetails.lineNumber,
        } : undefined,
      },
    }
  }

  private async uploadFile(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.selector || !params.filePath) throw new Error("selector and filePath are required")
    await this.ensureAttached(tabId)
    try {
      const { root } = await this.sendCdp(tabId, "DOM.getDocument", {})
      if (!root?.nodeId) throw new Error("Could not retrieve DOM Document root")

      const { nodeId } = await this.sendCdp(tabId, "DOM.querySelector", {
        nodeId: root.nodeId,
        selector: params.selector,
      })

      if (!nodeId) throw new Error(`Element not found for selector: ${params.selector}`)

      await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
        files: [params.filePath],
        nodeId: nodeId,
      })
      return { success: true }
    } catch (e: any) {
      throw new Error(`Upload failed: ${e.message}`)
    }
  }

  private async download(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    await this.sendCdp(tabId, "Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: params.downloadPath || "",
    })
    return { success: true }
  }

  // --- Cookie tools ---

  private async getCookies(params: Record<string, any>): Promise<ToolResult> {
    if (!params.domain) throw new Error("domain is required")
    const cookies = await chrome.cookies.getAll({ domain: params.domain })
    return { success: true, data: cookies }
  }

  private async setCookie(params: Record<string, any>): Promise<ToolResult> {
    if (!params.url || !params.name || params.value === undefined) {
      throw new Error("url, name, and value are required")
    }
    const cookie = await chrome.cookies.set({
      url: params.url,
      name: params.name,
      value: params.value,
      domain: params.domain,
      path: params.path,
      secure: params.secure,
      httpOnly: params.httpOnly,
      expirationDate: params.expirationDate,
    })
    return { success: true, data: cookie }
  }

  private async deleteCookie(params: Record<string, any>): Promise<ToolResult> {
    if (!params.url || !params.name) throw new Error("url and name are required")
    await chrome.cookies.remove({ url: params.url, name: params.name })
    return { success: true }
  }

  private async listAllCookies(): Promise<ToolResult> {
    const cookies = await chrome.cookies.getAll({})
    return { success: true, data: cookies }
  }

  // --- Geom helpers ---

  private async waitForSelector(tabId: number, selector: string, timeoutMs: number): Promise<void> {
    const escaped = selector.replace(/'/g, "\\'")
    const expression = `!!document.querySelector('${escaped}')`
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.sendCdp(tabId, "Runtime.evaluate", { expression, returnByValue: true })
        if (result.result?.value) return
      } catch {
        const value = await this.scriptingExecute(tabId, expression)
        if (value) return
      }
      await new Promise(r => setTimeout(r, 200))
    }
    // Timeout is not fatal — getElementCenter will give the canonical "not found" error
  }

  private async getElementCenter(tabId: number, selector?: string, scrollIntoView = true): Promise<{ x: number; y: number }> {
    if (!selector) return { x: 300, y: 300 }
    const escapedSelector = selector.replace(/'/g, "\\'")
    const scrollExpr = scrollIntoView
      ? `if(r.bottom<0||r.top>window.innerHeight||r.right<0||r.left>window.innerWidth){el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});r=el.getBoundingClientRect();}`
      : ""
    const expression = `(()=>{const el=document.querySelector('${escapedSelector}');if(!el)return null;let r=el.getBoundingClientRect();${scrollExpr}return{x:r.x+r.width/2,y:r.y+r.height/2}})()`

    // Try CDP first
    try {
      const result = await this.sendCdp(tabId, "Runtime.evaluate", { expression, returnByValue: true })
      if (result.result?.value) return result.result.value
    } catch { /* fall through to scripting */ }

    // Fallback: chrome.scripting (works without debugger attach)
    const value = await this.scriptingExecute(tabId, expression)
    if (!value) throw new Error(`Element not found: ${selector}`)
    return value
  }
}
