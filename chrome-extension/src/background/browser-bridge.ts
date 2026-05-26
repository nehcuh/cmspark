// Browser Bridge — executes tool calls via Chrome APIs and CDP

interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

export class BrowserBridge {
  private attachedTabs: Set<number> = new Set()

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

  // Execute JS via chrome.scripting. ISOLATED world first (CSP-safe),
  // then MAIN world if ISOLATED had injection errors (some SPAs block ISOLATED).
  private async scriptingExecute(tabId: number, code: string): Promise<any> {
    // Detect simple read-only expressions — use direct DOM funcs, no new Function()
    const bodyTextExpr = code === "document.body?.innerText || ''"
    const bodyHtmlExpr = code.startsWith("document.querySelector('html')")

    // Strategy 1: ISOLATED world
    try {
      let results: chrome.scripting.InjectionResult<any>[] | undefined
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
      let results: chrome.scripting.InjectionResult<any>[] | undefined
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

    const result = await this.sendCdp(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
    })

    const tab = await chrome.tabs.get(tabId)
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
    return { success: true, data: { text: result.result?.value || "" } }
  }

  private async getPageHTML(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    const selector = params.selector ? `.querySelector('${params.selector}')` : ""
    const expression = `document.querySelector('html')${selector}?.outerHTML?.substring(0, 500000) || ''`
    const result = await this.safeEvaluate(tabId, expression)
    const html = result.result?.value || ""
    const truncated = html.length >= 500000
    return { success: true, data: { html, truncated, length: html.length } }
  }

  private async getElementInfo(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.selector) throw new Error("selector is required")
    const expression = `
      (() => {
        const el = document.querySelector('${params.selector}');
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
    try {
      const coords = await this.getElementCenter(tabId, params.selector)
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount,
      })
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount,
      })
    } catch {
      // Fallback: direct DOM click when CDP debugger not available
      if (params.selector) {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.querySelector('${params.selector.replace(/'/g, "\\'")}');if(el){el.focus();el.click();for(let i=1;i<${clickCount};i++)el.click();return true}return false})()`)
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
      // Fallback: set value via DOM scripting
      const escaped = params.value.replace(/'/g, "\\'")
      if (params.selector) {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.querySelector('${params.selector.replace(/'/g, "\\'")}');if(el){el.value='${escaped}';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true}return false})()`)
      } else {
        await this.scriptingExecute(tabId,
          `(()=>{const el=document.activeElement;if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')){el.value='${escaped}';el.dispatchEvent(new Event('input',{bubbles:true}));return true}return false})()`)
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
          `(()=>{const el=document.querySelector('${params.selector.replace(/'/g, "\\'")}');if(el){el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return true}return false})()`)
      }
    }
    return { success: true }
  }

  private async selectOption(params: Record<string, any>): Promise<ToolResult> {
    const tabId = this.getTabId(params)
    if (!params.selector || params.value === undefined) throw new Error("selector and value are required")
    await this.sendCdp(tabId, "Runtime.evaluate", {
      expression: `
        (() => {
          const el = document.querySelector('${params.selector}');
          if (!el) throw new Error('Select not found');
          el.value = '${params.value}';
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

    await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 })
    // Move in steps for smooth drag
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * (i / steps)
      const y = from.y + (to.y - from.y) * (i / steps)
      await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left" })
      await new Promise(r => setTimeout(r, 30))
    }
    await this.sendCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 })
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
            expression: `!!document.querySelector('${selector}')`,
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

    const dangerousApis = [
      "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage",
      "document.cookie", "window.open", "navigator.sendBeacon",
    ]
    const matches = dangerousApis.filter(api => params.code.includes(api))

    const result = await this.safeEvaluate(tabId, params.code)

    return {
      success: true,
      data: {
        result: result.result?.value,
        type: result.result?.type,
        has_dangerous_apis: matches.length > 0,
        dangerous_apis_found: matches.length > 0 ? matches : undefined,
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
    await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
      files: [params.filePath],
      nodeId: 0, // Will need to resolve selector to nodeId in production
    })
    return { success: true }
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

  private async getElementCenter(tabId: number, selector?: string): Promise<{ x: number; y: number }> {
    if (!selector) return { x: 300, y: 300 }
    const expression = `(()=>{const el=document.querySelector('${selector.replace(/'/g, "\\'")}');if(!el)return null;const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`

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
