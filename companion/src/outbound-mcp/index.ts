/** Outbound MCP public surface (ADR-022 Phase 0c). */

export {
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_EXFIL_CLASS,
  OUTBOUND_DISCLOSURE_ZH,
  isOutboundAllowed,
  isOutboundForbidden,
  outboundToInternalName,
} from "./profile"
export { gateOutboundCall, listOutboundTools } from "./facade"
export type { OutboundCallRequest, OutboundCallResult } from "./facade"
export {
  acceptOutboundDisclosure,
  hasOutboundDisclosure,
  revokeOutboundDisclosure,
  clearAllOutboundDisclosureSessions,
} from "./disclosure-session"
export {
  invokeOutboundTool,
  setOutboundDispatcher,
  getOutboundDispatcher,
} from "./bridge"
export type {
  OutboundDispatcher,
  OutboundDispatchRequest,
  OutboundDispatchResult,
  InvokeOutboundResult,
} from "./bridge"
export { makeOutboundMcpOrigin } from "./origin"
export type { OutboundMcpOrigin } from "./origin"
export {
  createOutboundMcpServer,
  runOutboundMcpStdioServer,
} from "./stdio-server"
