/** Only server code can set invocation options. Model/WS JSON parameters do
 * not grant access to the internal response shape of list_tabs. */
export function contextReadParams(toolName: string, params: Record<string, any>, internalTabId?: number): Record<string, any> {
  const { __site_context_tab_id: _untrusted, ...clean } = params
  if (toolName === "list_tabs" && Number.isSafeInteger(internalTabId) && internalTabId! >= 0) {
    clean.__site_context_tab_id = internalTabId
  }
  return clean
}
