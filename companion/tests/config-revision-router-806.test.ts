import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("config handler rejects stale revisions without bypassing security or exposing keys", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-router-806-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  try {
    const config = await import("../src/config")
    const { handleConfigFamily } = await import("../src/message-router/handlers/config")
    const set = (args: any) => handleConfigFamily("config.set", { id: "settings-save:owned", config_revision: config.getConfigRevision(), ...args })
    config.clearConfigCache()
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: "owned-test-key" } }, { llmKey: true })
    const ordinary = config.saveConfig({ trusted_domains: ["owned.invalid"] })
    assert.equal(config.getCommittedConfigRevision(ordinary), undefined)
    const receipted = config.saveConfigWithReceipt({ trusted_domains: ["owned.invalid"] })
    assert.equal(config.getCommittedConfigRevision(receipted), config.getConfigRevision())
    assert.equal(config.getCommittedConfigRevision(receipted), undefined)
    for (const args of [
      {},
      { config_revision: config.getConfigRevision() },
      { id: "other:owned", config_revision: config.getConfigRevision() },
      { id: "settings-save:owned" },
    ]) {
      const clone = globalThis.structuredClone
      let count = 0
      globalThis.structuredClone = ((value: any, options?: any) => { count++; return clone(value, options) }) as typeof structuredClone
      try {
        const revision = config.getConfigRevision()
        const request = { ...args, ...(args.config_revision ? { config_revision: revision } : {}), config: { api_key: "owned-noncorrelated-key" } }
        const reply = await handleConfigFamily("config.set", request)
        assert.equal(reply.type, "config.updated")
        assert.equal(reply.config_applied_revision, undefined)
        assert.deepEqual(reply.config_applied_secret_fields, ["api_key"])
        assert.equal(count, 1)
      } finally { globalThis.structuredClone = clone }
    }
    const earlyConsume = (value: any) => { config.getCommittedConfigRevision(value) }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, earlyConsume)
    try {
      const reply = await set({ config: { model_name: "owned-consumed" } })
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, earlyConsume) }
    const read = await handleConfigFamily("config.get", {})
    assert.equal(read.config.llm.api_key, "***")
    const token = read.config_revision

    const broadcasts: Array<{ revision: string; value: string }> = []
    const observe = () => { const snapshot = config.getConfigSnapshot(); broadcasts.push({ revision: snapshot.revision, value: snapshot.config.llm.model_name }) }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, observe)
    let first: any
    try { first = await set({ config: { model_name: "owned-first" }, config_revision: token }) }
    finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, observe) }
    assert.deepEqual(broadcasts, [{ revision: first.config_revision, value: "owned-first" }])
    assert.equal(first.type, "config.updated")
    assert.notEqual(first.config_revision, token)
    assert.equal(first.config_applied_revision, first.config_revision)
    const stale = await set({ config: { model_name: "owned-stale" }, config_revision: token })
    assert.equal(stale.type, "config.conflict")
    assert.equal(stale.config_applied_revision, undefined)
    assert.equal(stale.config.llm.model_name, "owned-first")
    assert.equal(stale.config.llm.api_key, "***")
    assert.equal(JSON.stringify(stale).includes("owned-test-key"), false)
    assert.equal(config.getConfig().llm.model_name, "owned-first")

    const rejected = await set({
      config: { auto_approve_dangerous: true }, config_revision: first.config_revision,
    })
    assert.equal(rejected.type, "error")
    assert.notEqual(config.getConfig().security?.auto_approve_dangerous, true)

    const secretRevision = config.getConfigRevision()
    const secret = await set({ config: { api_key: "owned-next-key" }, config_revision: secretRevision })
    assert.equal(secret.config_applied_revision, secret.config_revision)
    assert.deepEqual(secret.config_applied_secret_fields, ["api_key"])
    assert.equal(secret.config.llm.api_key, "***")
    assert.equal(JSON.stringify(secret).includes("owned-next-key"), false)

    // A synchronous listener can perform another write before the first reply.
    // The returned value and token must refer to the same latest snapshot.
    const listener = () => {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-reentrant" } })
    }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
    try {
      const reply = await set({ config: { model_name: "owned-before-event" } })
      assert.equal(reply.config.llm.model_name, "owned-reentrant")
      assert.equal(reply.config_revision, config.getConfigRevision())
      assert.equal(reply.config_applied_revision, undefined)
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
    }
    // A reentrant write to the *same value* still has its own revision and
    // cannot be attributed to the outer request by comparing field contents.
    const sameValue = () => {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, sameValue)
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-same" } })
    }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, sameValue)
    try {
      const reply = await set({ config: { model_name: "owned-same" } })
      assert.equal(reply.config.llm.model_name, "owned-same")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, sameValue) }
    // Even the same on-disk content reloaded under a new revision must not
    // inherit a prior write's proof merely because the values match.
    const clearDuringEvent = () => { config.configEvents.off(config.CONFIG_CHANGE_EVENT, clearDuringEvent); config.clearConfigCache() }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, clearDuringEvent)
    try {
      const reply = await set({ config: { model_name: "owned-reload" } })
      assert.equal(reply.config.llm.model_name, "owned-reload")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, clearDuringEvent) }
    // The same cached object can be mutated by an event listener without a
    // second revision; such a response must not claim committed provenance.
    const mutateModel = (value: any) => { value.llm.model_name = "owned-mutated" }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, mutateModel)
    try {
      const reply = await set({ config: { model_name: "owned-on-disk" } })
      assert.equal(reply.config.llm.model_name, "owned-mutated")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, mutateModel); config.clearConfigCache() }
    // A secret-bearing object can change while its redacted wire shape stays
    // masked. The proof must be withheld without printing secret values.
    const mutateSecret = (value: any) => { value.llm.extra_headers = { Authorization: "owned-secret-mutated" } }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, mutateSecret)
    try {
      const reply = await set({ config: { model_name: "owned-secret-case" } })
      assert.equal(reply.config.llm.extra_headers.Authorization, "***")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, mutateSecret); config.clearConfigCache() }
    // Observe the same-revision transient value between mutation and restore,
    // as the real lifecycle broadcaster does. Recovery must not revive proof.
    const mutator = (value: any) => { value.llm.model_name = "owned-transient" }
    const observer = () => { assert.equal(config.getConfigSnapshot().config.llm.model_name, "owned-transient") }
    const restore = (value: any) => { value.llm.model_name = "owned-restored" }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, mutator)
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, observer)
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, restore)
    try {
      const reply = await set({ config: { model_name: "owned-restored" } })
      assert.equal(reply.config.llm.model_name, "owned-restored")
      assert.equal(reply.config_applied_revision, undefined)
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, mutator); config.configEvents.off(config.CONFIG_CHANGE_EVENT, observer); config.configEvents.off(config.CONFIG_CHANGE_EVENT, restore); config.clearConfigCache()
    }
    // Same-revision secret mutation and restore is detected when a snapshot
    // observer sees the transient value, even though redaction masks it.
    let originalHeaders: any
    const secretMutator = (value: any) => { originalHeaders = value.llm.extra_headers; value.llm.extra_headers = { Authorization: "owned-secret-transient" } }
    const secretObserver = () => { const observed = config.getConfigSnapshot(); assert.equal(observed.config.llm.extra_headers?.Authorization, "owned-secret-transient") }
    const secretRestore = (value: any) => { if (originalHeaders === undefined) delete value.llm.extra_headers; else value.llm.extra_headers = originalHeaders }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, secretMutator)
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, secretObserver)
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, secretRestore)
    try {
      const reply = await set({ config: { model_name: "owned-secret-restored" } })
      assert.equal(reply.config_applied_revision, undefined)
      assert.equal(JSON.stringify(reply).includes("owned-secret-transient"), false)
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, secretMutator); config.configEvents.off(config.CONFIG_CHANGE_EVENT, secretObserver); config.configEvents.off(config.CONFIG_CHANGE_EVENT, secretRestore); config.clearConfigCache()
    }
    // Failure to create an auxiliary in-memory baseline must not suppress the
    // actual write/event and must not manufacture a commit proof.
    const clone = globalThis.structuredClone
    let clones = 0, emitted = 0
    const eventCount = () => { emitted++ }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, eventCount)
    globalThis.structuredClone = ((value: any, options?: any) => { if (++clones === 3) throw new Error("owned-clone-failure"); return clone(value, options) }) as typeof structuredClone
    try {
      const reply = await set({ config: { model_name: "owned-clone-case" } })
      assert.equal(reply.config.llm.model_name, "owned-clone-case")
      assert.equal(reply.config_applied_revision, undefined)
      assert.equal(emitted, 1)
    } finally { globalThis.structuredClone = clone; config.configEvents.off(config.CONFIG_CHANGE_EVENT, eventCount) }
    // An exception after atomic write is not a successful receipt.
    let thrownSnapshot: any
    const throwsAfterWrite = (value: any) => { thrownSnapshot = value; throw new Error("owned-listener-failure") }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, throwsAfterWrite)
    try {
      await assert.rejects(set({ config: { model_name: "owned-persisted-before-error" } }), /owned-listener-failure/)
      assert.equal(config.getConfig().llm.model_name, "owned-persisted-before-error")
      assert.equal(config.getCommittedConfigRevision(thrownSnapshot), undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, throwsAfterWrite) }
  } finally {
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
