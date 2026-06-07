// Tests for background notification logic
// These tests exercise the debounced notification behavior on WS state changes.

import test from "node:test"
import assert from "node:assert/strict"

test("should schedule notification after disconnect debounce", async () => {
  let notificationShown = false
  let notificationCleared = false
  const timers: ReturnType<typeof setTimeout>[] = []

  const DISCONNECT_DEBOUNCE_MS = 3000
  let disconnectNotificationTimer: ReturnType<typeof setTimeout> | null = null
  let lastNotifiedState: "connected" | "disconnected" | null = null

  function showDisconnectedNotification() {
    if (lastNotifiedState === "disconnected") return
    lastNotifiedState = "disconnected"
    notificationShown = true
  }

  function clearDisconnectedNotification() {
    if (lastNotifiedState === "connected") return
    lastNotifiedState = "connected"
    notificationCleared = true
  }

  function scheduleDisconnectNotification() {
    if (disconnectNotificationTimer) return
    disconnectNotificationTimer = setTimeout(() => {
      disconnectNotificationTimer = null
      showDisconnectedNotification()
    }, DISCONNECT_DEBOUNCE_MS)
    timers.push(disconnectNotificationTimer)
  }

  function cancelDisconnectNotification() {
    if (disconnectNotificationTimer) {
      clearTimeout(disconnectNotificationTimer)
      disconnectNotificationTimer = null
    }
  }

  // Simulate disconnect
  scheduleDisconnectNotification()
  assert.equal(notificationShown, false)

  // Wait for debounce
  await new Promise((r) => setTimeout(r, DISCONNECT_DEBOUNCE_MS + 100))
  assert.equal(notificationShown, true)

  // Simulate reconnect
  cancelDisconnectNotification()
  clearDisconnectedNotification()
  assert.equal(notificationCleared, true)

  // Cleanup
  timers.forEach(clearTimeout)
})

test("should cancel pending notification if reconnect happens before debounce", async () => {
  let notificationShown = false
  const timers: ReturnType<typeof setTimeout>[] = []

  const DISCONNECT_DEBOUNCE_MS = 3000
  let disconnectNotificationTimer: ReturnType<typeof setTimeout> | null = null
  let lastNotifiedState: "connected" | "disconnected" | null = null

  function showDisconnectedNotification() {
    if (lastNotifiedState === "disconnected") return
    lastNotifiedState = "disconnected"
    notificationShown = true
  }

  function scheduleDisconnectNotification() {
    if (disconnectNotificationTimer) return
    disconnectNotificationTimer = setTimeout(() => {
      disconnectNotificationTimer = null
      showDisconnectedNotification()
    }, DISCONNECT_DEBOUNCE_MS)
    timers.push(disconnectNotificationTimer)
  }

  function cancelDisconnectNotification() {
    if (disconnectNotificationTimer) {
      clearTimeout(disconnectNotificationTimer)
      disconnectNotificationTimer = null
    }
  }

  // Simulate disconnect then immediate reconnect
  scheduleDisconnectNotification()
  assert.equal(notificationShown, false)

  // Reconnect before debounce fires
  cancelDisconnectNotification()

  // Wait past original debounce time
  await new Promise((r) => setTimeout(r, DISCONNECT_DEBOUNCE_MS + 100))
  assert.equal(notificationShown, false)

  // Cleanup
  timers.forEach(clearTimeout)
})

test("should deduplicate notifications (not show twice)", async () => {
  let notificationCount = 0
  const timers: ReturnType<typeof setTimeout>[] = []

  const DISCONNECT_DEBOUNCE_MS = 3000
  let disconnectNotificationTimer: ReturnType<typeof setTimeout> | null = null
  let lastNotifiedState: "connected" | "disconnected" | null = null

  function showDisconnectedNotification() {
    if (lastNotifiedState === "disconnected") return
    lastNotifiedState = "disconnected"
    notificationCount++
  }

  function scheduleDisconnectNotification() {
    if (disconnectNotificationTimer) return
    disconnectNotificationTimer = setTimeout(() => {
      disconnectNotificationTimer = null
      showDisconnectedNotification()
    }, DISCONNECT_DEBOUNCE_MS)
    timers.push(disconnectNotificationTimer)
  }

  // Simulate multiple disconnect events
  scheduleDisconnectNotification()
  scheduleDisconnectNotification()
  scheduleDisconnectNotification()

  await new Promise((r) => setTimeout(r, DISCONNECT_DEBOUNCE_MS + 100))
  assert.equal(notificationCount, 1)

  // Cleanup
  timers.forEach(clearTimeout)
})
