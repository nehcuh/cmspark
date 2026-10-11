# MCP protocol, cooperation and outbound contracts

Date: 2026-10-11. Issue: [#592](https://github.com/nehcuh/cmspark/issues/592).

This batch implements review findings R5–R10. It builds on the existing tools/resources/prompts client, immutable cooperation plans, and the curated outbound MCP profiles. The separate lifecycle/selection and Windows batches remain necessary for the overall issue.

## Catalogs and tool results

Collect tools, resources and prompts through their complete cursor chains. Publish each catalog only after a complete successful collection. Preserve its preceding snapshot on an RPC failure, timeout, repeated cursor, or catalog limit. A single configured call timeout covers the whole refresh; bounds are 100 pages and 10,000 entries per catalog.

Handle list-change notifications for each capability. Concurrent notifications coalesce into one follow-up refresh instead of overlapping writes. Cache publication is conditional on the same SDK client still being connected; close/reconnect cannot publish an old response into a replacement connection.

Preserve `structuredContent` through the MCP client and dispatcher. Existing content-only tools retain their content-array result shape. A result with structured content exposes both `content` and `structuredContent`, including when the text content array is empty.

Tool results marked `isError` remain failures and retain their error message while carrying the same structured data. If the outer allow-directory retry/admission path rejects recovery, preserve the original structured error data alongside that rejection.

Preserve JSON Schema `$defs` and `definitions` alongside references. Scan nested schema metadata, including definitions, array items, composition branches and examples, with the existing injection rules before exposing tools to the model.

## Cooperation authority

A plan may require an actual aggregated MCP tool. Record its resolved server/tool identity and a deterministic digest of its configured server and input schema. Do not persist server credentials in the plan. Reject invented names, unavailable/changing connections, parent selection exclusions and missing parent capabilities.

Revalidate bindings when computing readiness, before spawning, when binding the created worker, and before/after MCP tool confirmation during worker execution. Changing an alias, server configuration or input contract invalidates the recorded requirement. A legacy checkpoint containing dynamic requirements without bindings fails closed. Persistence/reload preserves the binding and does not create new authority.

Runtime checks match both the declared alias and every alternative alias resolving to a bound server/tool. Sanitization collisions and catalog reordering cannot evade the recorded configuration/schema digest. A differently named route to an unchanged identity still requires the worker's current whitelist and parent capability checks. Immediately before dispatch (including retries), require the live alias route to match the route used for authorization; confirmation-time retargeting cannot execute an old captured route.

Use the same MCP exact-name, server-wildcard and global-wildcard semantics as runtime tool authorization. Wildcard intersections with narrower parent grants resolve to concrete available tools; explicit MCP denials cannot leave a broader wildcard behind. Keep existing worker hard denials and the distinction between orchestrator control tools and worker capabilities. Workers inherit manual MCP server selection. Live parent/worker selection intersection is enforced by the separate selection batch.

## Outbound cancellation and schemas

Carry the SDK request signal through the stdio bridge, HTTP request, Companion runner, pending execution and confirmation boundaries. Cancelling a caller should prevent later dispatch after awaited admission/confirmation work. Cancellation does not roll back completed browser side effects. Existing grant/profile/exfil checks remain authoritative.

Generate outbound argument schemas from the native Zod contracts and tool catalog, reusing the MCP SDK's JSON Schema conversion and AJV validator. Express native cross-field alternatives that cannot be converted automatically, then retain native Zod refinements during execution. Use the existing context-projection request schema for `site_context`.

Advertise and accept both flat tool arguments and the existing `{args, domain}` envelope. Keep domain as metadata, separate from tool arguments. Reject ambiguous/malformed envelopes. Apply the same argument contract to stdio, bridge and HTTP execution. Outbound tools that participate in the L9 tab lease require an explicit positive integer `tabId`, including screenshot/vision calls that allow an active-tab fallback in native usage. Preserve the existing HTTP `TAB_ID_REQUIRED` error and queue explanation for missing targets. Do not extend any outbound profile or treat caller acknowledgment as operator consent.

## Acceptance boundaries

Use real SDK in-memory transports, real ThreadManager persistence, production dispatch/admission paths, authenticated loopback HTTP fixtures and injected browser effects. Run the full compiled host suite and selected complete MCP/cooperation/outbound/image/security/URL/L2/admission/orchestrator suites in a fresh Linux arm64 container with independent dependencies. Record pre-rebase results separately from final reviewed/merged results.

The installed SDK updates its private output-validator/task-support cache per `listTools` page. This batch does not patch SDK internals or claim full task-protocol support. OAuth, legacy SSE, sampling, elicitation and resource-template support are outside this repair. Host/container tests provide no Windows desktop, NSIS or ConPTY certification.
