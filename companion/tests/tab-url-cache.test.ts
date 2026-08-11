/**
 * tab-url-cache colocation (day dual-review nit).
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  applyTabNavigated,
  clearTabUrlCacheForTests,
  getCachedTabUrl,
  getTabUrlCache,
  refreshTabUrlCache,
} from "../src/ws/tab-url-cache"

beforeEach(() => {
  clearTabUrlCacheForTests()
})

describe("tab-url-cache", () => {
  it("get/set via applyTabNavigated", () => {
    applyTabNavigated(1, "https://example.com/a")
    assert.equal(getCachedTabUrl(1), "https://example.com/a")
    assert.equal(getTabUrlCache().get(1), "https://example.com/a")
  })

  it("refreshTabUrlCache merges list_tabs shape", () => {
    refreshTabUrlCache([
      { id: 2, url: "https://a.example/" },
      { id: 3, url: "https://b.example/" },
      { id: "bad", url: "https://x/" },
    ])
    assert.equal(getCachedTabUrl(2), "https://a.example/")
    assert.equal(getCachedTabUrl(3), "https://b.example/")
    assert.equal(getCachedTabUrl(undefined), undefined)
  })

  it("applyTabNavigated overwrites previous url", () => {
    applyTabNavigated(9, "https://old.example/")
    applyTabNavigated(9, "https://new.example/path")
    assert.equal(getCachedTabUrl(9), "https://new.example/path")
  })
})
