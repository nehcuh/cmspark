import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js"
import { createOutboundMcpServer, _resetOutboundProfileRuntimeForTests } from "../src/outbound-mcp/stdio-server"
import { outboundToolArgumentSchema, outboundToolWireSchema, decodeOutboundWireArgs, validateOutboundToolArgs } from "../src/outbound-mcp/tool-schema"
import { OUTBOUND_L1_INTERACT_PROFILE, OUTBOUND_CONTEXT_PROFILE } from "../src/outbound-mcp/outbound-grants"
import { outboundToolsForProfiles } from "../src/outbound-mcp/profile"
import { setOutboundDispatcher, invokeOutboundTool } from "../src/outbound-mcp/bridge"
import { companionInvokeOutbound, setOutboundToolRunner } from "../src/outbound-mcp/companion-http"
import { TOOL_ARG_SCHEMAS } from "../src/bridge/tool-schemas"

afterEach(() => {
  setOutboundDispatcher(null)
  setOutboundToolRunner(null)
  _resetOutboundProfileRuntimeForTests()
})

const validArgs: Record<string, Record<string, unknown>> = {
  list_tabs: {}, navigate: { tabId: 1, url: "https://example.com" }, get_page_text: { tabId: 1 },
  click: { tabId: 1, text: "Continue" }, type: { tabId: 1, value: "hello" }, screenshot: { tabId: 1 }, wait_for: { tabId: 1 },
  downloads_find: { filenameHint: "report", limit: 5 }, scroll: { tabId: 1, deltaY: 300 },
  get_element_info: { tabId: 1, selector: "#name" }, press_key: { tabId: 1, key: "Enter", code: "Enter" },
  select_option: { tabId: 1, text: "Country", value: "CN" }, hover: { tabId: 1, text: "Menu" },
  dblclick: { tabId: 1, selector: "#edit" }, fill_form: { tabId: 1, fields: [{ text: "Name", value: "Ada" }] },
  drag_and_drop: { tabId: 1, from_text: "Item", to_selector: "#target", exact: true },
  create_tab: { url: "https://example.com", index: 0 }, get_page_html: { tabId: 1, selector: "main" },
  analyze_image: { tabId: 1, prompt: "Describe the diagram" }, site_context: { tabId: 1, query: "help" },
}

test("every granted tool advertises its real SDK argument contract with flat and wrapped forms", async () => {
  const server = createOutboundMcpServer([OUTBOUND_L1_INTERACT_PROFILE, OUTBOUND_CONTEXT_PROFILE])
  const client = new Client({ name: "contract-client", version: "1" })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  await client.connect(left)
  try {
    const { tools } = await client.listTools()
    const granted = outboundToolsForProfiles([OUTBOUND_L1_INTERACT_PROFILE, OUTBOUND_CONTEXT_PROFILE])
    assert.equal(tools.length, granted.length + 2, "profiles retain their existing tool set")
    const validator = new AjvJsonSchemaValidator()
    for (const canonical of granted) {
      const name = canonical.slice("cmspark__".length)
      const advertised = tools.find(tool => tool.name === name)!
      assert.ok(advertised, name)
      const args = validArgs[name]
      assert.ok(args, `missing fixture for ${name}`)
      const validate = validator.getValidator(advertised.inputSchema)
      assert.equal(validate(args).valid, true, name)
      assert.equal(validate({ args, domain: "example.com" }).valid, true, `${name} wrapped`)
      assert.equal(validate({ args, domain: 42 }).valid, false, `${name} malformed domain`)
      assert.equal(validateOutboundToolArgs(canonical, args), null, name)
      assert.deepEqual(outboundToolArgumentSchema(canonical).properties,
        (advertised.inputSchema as any).properties.args.properties, `${name} advertised and execution properties`)
    }
    const click: any = tools.find(tool => tool.name === "click")!.inputSchema
    assert.equal(click.properties.tabId.type, "integer")
    assert.equal(click.properties.selector.type, "string")
    assert.deepEqual(click.anyOf[0].anyOf, [{ required: ["selector"] }, { required: ["text"] }])
  } finally { await client.close(); await server.close() }
})

test("native refinements remain aligned with outbound schemas", () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["click", { tabId: 1 }], ["click", { tabId: "1", text: "Continue" }],
    ["navigate", { tabId: 1, url: "not a URL" }], ["select_option", { tabId: 1, selector: "select" }],
    ["downloads_find", {}], ["downloads_find", { filenameHint: "x", limit: 21 }],
    ["fill_form", { tabId: 1, fields: [{ value: "Ada" }] }],
    ["drag_and_drop", { tabId: 1, from_text: "Item" }], ["wait_for", { tabId: 1, state: "unknown" }],
  ]
  for (const [name, args] of invalid) {
    assert.equal(TOOL_ARG_SCHEMAS[name].safeParse(args).success, false, name)
    assert.equal(new AjvJsonSchemaValidator().getValidator(outboundToolArgumentSchema(`cmspark__${name}`))(args).valid, false, `${name} advertised constraints`)
    assert.ok(validateOutboundToolArgs(`cmspark__${name}`, args), name)
  }
  assert.ok(validateOutboundToolArgs("cmspark__click", { ...validArgs.click, __thread_id: "injected" }))
  assert.ok(validateOutboundToolArgs("cmspark__site_context", { tabId: 1, query: "x".repeat(2049) }))
  assert.equal(validateOutboundToolArgs("cmspark__wait_for", { tabId: 1 }), null, "condition omitted means network idle")
})

test("wire decoding keeps domain separate and rejects ambiguous wrappers", () => {
  for (const input of [{ ...validArgs.click, domain: "example.com" }, { args: validArgs.click, domain: "example.com" }]) {
    assert.deepEqual(decodeOutboundWireArgs("cmspark__click", input), { ok: true, args: validArgs.click, domain: "example.com" })
  }
  for (const args of [[], null, 12, "bad"]) {
    assert.equal(decodeOutboundWireArgs("cmspark__click", { args }).ok, false)
  }
  assert.equal(decodeOutboundWireArgs("cmspark__click", { ...validArgs.click, args: validArgs.click }).ok, false)
  assert.equal(decodeOutboundWireArgs("cmspark__click", { args: validArgs.click, domain: true }).ok, false)
})

test("SDK, bridge and direct HTTP execution reject malformed arguments before the runner", async () => {
  const server = createOutboundMcpServer([OUTBOUND_L1_INTERACT_PROFILE])
  const client = new Client({ name: "schema-execution", version: "1" })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  await client.connect(left)
  const received: unknown[] = []
  setOutboundDispatcher(async req => { received.push(req.args); return { success: true, data: "ok" } })
  setOutboundToolRunner(async (_id, _tool, args) => { received.push(args); return { success: true, data: "ok" } })
  try {
    for (const name of ["click", "cmspark__click"]) {
      const invalid = await client.callTool({ name, arguments: { tabId: 1 } })
      assert.equal(invalid.isError, true)
      assert.equal(JSON.parse((invalid.content as any)[0].text).error_code, "INVALID_ARGUMENTS")
      for (const args of [validArgs.click, { args: validArgs.click, domain: "example.com" }]) {
        assert.equal((await client.callTool({ name, arguments: args })).isError, false)
      }
    }
    assert.equal(received.length, 4)
    assert.ok(received.every(args => JSON.stringify(args) === JSON.stringify(validArgs.click)))
    const bridge = await invokeOutboundTool({ caller_id: "schema", tool: "cmspark__click", args: { tabId: 1 } })
    const http = await companionInvokeOutbound({ caller_id: "schema", tool: "click", args: { tabId: 1 } })
    assert.equal(bridge.error_code, "INVALID_ARGUMENTS")
    assert.equal(http.error_code, "INVALID_ARGUMENTS")
    assert.equal(received.length, 4)
    assert.equal((await companionInvokeOutbound({ caller_id: "schema", tool: "click", args: validArgs.click })).ok, true)
    assert.equal(received.length, 5)
    const listProfile = await client.callTool({ name: "list_outbound_profile", arguments: { injected: true } })
    assert.equal(listProfile.isError, true)
    const meta = outboundToolWireSchema("cmspark__accept_data_disclosure")
    assert.deepEqual(meta.required, ["acknowledge"])
  } finally { await client.close(); await server.close() }
})
