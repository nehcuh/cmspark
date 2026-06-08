// Keep-alive via chrome.alarms for MV3 service worker
//
// Two purposes:
// 1. Periodically wake the service worker to check WS connection
// 2. Drive the WS reconnect alarm (chrome.alarms survives worker suspension)

export class KeepAlive {
  private readonly ALARM_NAME = "cmspark-keepalive"
  private readonly RECONNECT_ALARM = "cmspark-ws-reconnect"
  private pingCallback: (() => void) | null = null

  start(onPing: () => void) {
    this.pingCallback = onPing

    // Main keep-alive alarm: Chrome minimum is ~0.5 min, use 0.5 for best effort
    chrome.alarms.create(this.ALARM_NAME, {
      periodInMinutes: 0.5,
    })

    // Single listener handles both keep-alive and reconnect alarms
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.ALARM_NAME) {
        this.pingCallback?.()
      }
      // Reconnect alarm is handled by ws-client calling connect() directly
      // We just need to trigger the check here
      if (alarm.name === this.RECONNECT_ALARM) {
        this.pingCallback?.() // pingCallback → checkAndReconnect
      }
    })
  }
}
