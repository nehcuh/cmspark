/** Private fixed faults; unknown errors are never inspected or reflected. */
export type WorkspaceCode = 'WORKSPACE_INPUT_INVALID'|'WORKSPACE_STALE'|'WORKSPACE_CONFLICT'|'WORKSPACE_BUSY'|'WORKSPACE_ACTIVITY_UNKNOWN'|'WORKSPACE_MODULE_DISABLED'|'WORKSPACE_UNBOUND'|'WORKSPACE_CANCELLED'|'WORKSPACE_DENIED'|'WORKSPACE_MISSING'|'WORKSPACE_UNSUPPORTED'|'WORKSPACE_CHANGED'|'WORKSPACE_UNAVAILABLE'|'WORKSPACE_UNCONFIRMED'
const faults = new WeakMap<object,WorkspaceCode>()
export function workspaceFail(code: WorkspaceCode): never { const error=new Error(code);faults.set(error,code);throw error }
export function workspaceErrorCode(error: unknown): WorkspaceCode { return ((typeof error==='object'&&error!==null)||typeof error==='function') ? faults.get(error as object)||'WORKSPACE_UNAVAILABLE' : 'WORKSPACE_UNAVAILABLE' }
