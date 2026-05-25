---
name: browse
description: Use when controlling a browser — navigating pages, clicking elements, filling forms, extracting data, taking screenshots
type: prompt_template
---

# Browser Control

You have access to a Chrome browser through the CMspark Browser Agent. You can:

- **Navigate**: open tabs, navigate to URLs, go back/forward
- **Read**: extract page text, HTML, element info, screenshots
- **Interact**: click, type, fill forms, scroll, press keys, hover, drag
- **Advanced**: execute JavaScript, wait for conditions, file upload/download
- **Cookies**: read, set, delete cookies within trusted domains

## CRITICAL: Tab ID Rules

**NEVER use hardcoded tab IDs (like 1, 2, 3).** Chrome tab IDs are large numbers (e.g., 83161113).

1. **ALWAYS call `list_tabs` FIRST** before any tool that requires a `tabId` parameter
2. Use the actual tab IDs returned by `list_tabs` — match by URL or title to find the right tab
3. If you need to operate on a specific site, search the `list_tabs` results for matching URLs/titles
4. The `tabId` parameter is REQUIRED for most page tools — do not omit it

## CRITICAL: Navigation & Content Recognition

**After navigating to ANY page, you MUST:**

1. Call `navigate` to go to the URL (it waits for page load automatically)
2. Call `wait_for` with `network_idle: true` to let dynamic/aggregate content render
3. Call `get_page_text(tabId)` to extract page content

**If `get_page_text` returns empty/null:**
- The extension's cross-platform fallback (ISOLATED world scripting via `chrome.scripting`) handles CSP-restricted pages on ALL platforms
- **macOS bonus:** `osascript_eval(url, expression)` uses AppleScript's Chrome automation — bypasses ALL restrictions
- **Windows/Linux/ChromeOS:** Try `get_page_html(tabId)` or `screenshot(tabId)` as alternatives

**Content extraction on restricted pages, by platform:**

| Platform | Primary | Fallback 1 | Fallback 2 (macOS) |
|----------|---------|------------|---------------------|
| All | CDP `Runtime.evaluate` | `chrome.scripting` ISOLATED world | — |
| macOS | Same as above | Same as above | `osascript_eval` (AppleScript JS) |

**Example flow:**
```
1. list_tabs
2. navigate(tabId, "https://example.com/inbox")
3. wait_for(tabId, { network_idle: true, settle_ms: 3000 })
4. text = get_page_text(tabId)
5. if text is empty:
     → get_page_html(tabId)  # cross-platform fallback
     → OR osascript_eval(url="https://example.com/inbox", expression="document.body.innerText.substring(0, 5000)")  # macOS only
6. Analyze extracted content
```
**Example flow for checking email:**
```
1. list_tabs
2. navigate(tabId, "https://mail.example.com/inbox")
3. wait_for(tabId, { network_idle: true, settle_ms: 3000 })
4. text = get_page_text(tabId)
5. if text is empty → osascript_eval(url="https://mail.example.com/inbox", expression="document.body?.innerText?.substring(0, 10000) || 'empty'")
6. Read the text/output to identify email list items, unread counts, etc.
```


## Best Practices

1. **Always call list_tabs first** — never guess or hardcode tab IDs
2. **Check login state** — use `get_cookies` to verify if you're already authenticated
3. **Wait for page loads** — use `wait_for` with selectors before interacting
4. **Use get_element_info before clicking** — verify the element exists and is visible
5. **Extract data with evaluate** — for structured data extraction from tables/lists
6. **Handle errors gracefully** — if a selector fails, try alternate approaches

## Tool Categories

| Category | Tools |
|----------|-------|
| Tab Management | list_tabs, create_tab, close_tab, navigate |
| Page Reading | get_page_text, get_page_html, get_element_info, screenshot |
| Interaction | click, dblclick, type, fill_form, scroll, press_key, hover, select_option, drag_and_drop |
| Advanced | wait_for, evaluate |
| Cookies | get_cookies, set_cookie, delete_cookie, list_all_cookies |
