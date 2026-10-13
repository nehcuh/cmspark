import { digest, deny, ENTERPRISE_TOOLS } from "./enterprise-policy"

/** JSON/WS flags are never authority. Only a branded object travels in invokeOpts. */
export type EnterprisePermit = Readonly<{
  tool: string; params_digest: string; guard: Readonly<Record<string, unknown>>; peer: object; peer_epoch: string
  recheck: () => void
}>
const permits = new WeakSet<object>()
const dispatched = new WeakSet<object>()
function argumentsDigest(params: Record<string, unknown>): string {
  const { __enterprise_guard: _guard, __thread_id: _thread, __outbound_mcp: _outbound, __outbound_caller_id: _caller, ...args } = params
  return digest(args)
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}
export function mintEnterprisePermit(tool: string, params: Record<string, unknown>, guard: Record<string, unknown>, peer: object, peer_epoch: string, recheck: () => void): EnterprisePermit {
  if (![...ENTERPRISE_TOOLS, "list_tabs"].includes(tool as any)) deny("ENTERPRISE_TOOL_FORBIDDEN")
  recheck()
  const permit = Object.freeze({ tool, params_digest: argumentsDigest(params), guard: freeze(JSON.parse(JSON.stringify(guard))), peer, peer_epoch, recheck })
  permits.add(permit)
  return permit
}
export function checkEnterprisePermit(value: unknown, tool: string, params: Record<string, unknown>, peer?: object): value is EnterprisePermit {
  if (!value || typeof value !== "object" || !permits.has(value)) return false
  const permit = value as EnterprisePermit
  if (dispatched.has(value) || permit.tool !== tool || permit.params_digest !== argumentsDigest(params) || (peer && permit.peer !== peer)) deny("PERMIT_MISMATCH")
  permit.recheck()
  return true
}
export function claimEnterpriseDispatch(value: EnterprisePermit, tool: string, params: Record<string, unknown>, peer: object): void {
  if (!checkEnterprisePermit(value, tool, params, peer)) deny("PERMIT_INVALID")
  dispatched.add(value)
}
