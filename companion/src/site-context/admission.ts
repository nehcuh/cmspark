/** Only server code can set invocation options. Model/WS JSON parameters do
 * not grant access to the internal response shape of list_tabs. */
export function contextReadParams(toolName: string, params: Record<string, any>, internalTabId?: number, requireActive = false): Record<string, any> {
  const { __site_context_tab_id: _untrusted, __site_context_require_active: _untrustedActive, ...clean } = params
  if (toolName === "list_tabs" && Number.isSafeInteger(internalTabId) && internalTabId! >= 0) {
    clean.__site_context_tab_id = internalTabId
    if (requireActive === true) clean.__site_context_require_active = true
  }
  return clean
}
