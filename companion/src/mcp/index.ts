// MCP module — public entry point.
//
// Re-exports the singleton manager, confirm cache, types, and the namespaced-tool helper
// used by the router. Importers should prefer `import { getMcpManager } from "../mcp"`.

export { McpClient } from "./client.js"
export { McpManager, getMcpManager, type McpManagerEvent } from "./manager.js"
export { McpConfirmCache, getMcpConfirmCache, type ConfirmCacheKey } from "./confirm-cache.js"
export {
  aggregateMcpTools,
  buildNamespacedName,
  isMcpNamespaced,
  sanitizeSegment,
  type AggregatedTools,
} from "./aggregator.js"
export { createTransport, extractPid } from "./transport.js"
export {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_POLICY,
  DEFAULT_STARTUP_TIMEOUT_MS,
  resolveCallTimeout,
  resolveRestartPolicy,
  resolveStartupTimeout,
  requiresRestart,
  type McpCapabilities,
  type McpConfig,
  type McpConnectionState,
  type McpConnectionStatus,
  type McpHttpServerConfig,
  type McpPromptMeta,
  type McpResourceMeta,
  type McpRestartPolicy,
  type McpServerConfig,
  type McpServerMeta,
  type McpStdioServerConfig,
  type McpToolMeta,
  type McpToolRoute,
  type McpTransportKind,
  type McpTrustLevel,
} from "./types.js"
