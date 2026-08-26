/** Outbound MCP public surface (ADR-022 Phase 0c). */

export {
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_EXFIL_CLASS,
  OUTBOUND_DISCLOSURE_ZH,
  isOutboundAllowed,
  isOutboundForbidden,
  outboundToInternalName,
} from "./profile"
export { gateOutboundCall, listOutboundTools, denyOutboundExfilIfNeeded } from "./facade"
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
  wireDefaultOutboundHttpDispatcher,
} from "./stdio-server"
export {
  handleOutboundMcpHttp,
  companionInvokeOutbound,
  setOutboundToolRunner,
  authorizeOutboundRequest,
  authorizeOutboundHttp,
  OUTBOUND_INVOKE_PATH,
  OUTBOUND_DISCLOSURE_PATH,
} from "./companion-http"
export {
  issueOutboundGrant,
  verifyOutboundGrantToken,
  revokeOutboundGrant,
  revokeAllOutboundGrants,
  listOutboundGrants,
  resetOutboundGrantsForTests,
  grantAllowsPageExport,
  DEFAULT_GRANT_TTL_MS,
  OUTBOUND_GRANT_TOKEN_PREFIX,
} from "./outbound-grants"
export {
  createHttpOutboundDispatcher,
  companionPostDisclosure,
} from "./http-client"
export {
  gateOutboundTabLease,
  sidePanelWinsReleaseOutboundLease,
  outboundHolderThreadId,
  isOutboundHolder,
  OUTBOUND_MCP_PARAM,
  OUTBOUND_CALLER_PARAM,
} from "./dual-entry"
