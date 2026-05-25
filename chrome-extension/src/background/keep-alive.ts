// Keep-alive via chrome.alarms to prevent service worker termination

export class KeepAlive {
  private readonly ALARM_NAME = "cmspark-keepalive"
  private pingCallback: (() => void) | null = null

  start(onPing: () => void) {
    this.pingCallback = onPing

    chrome.alarms.create(this.ALARM_NAME, {
      periodInMinutes: 25 / 60, // ~25 seconds
    })

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.ALARM_NAME) {
        this.pingCallback?.()
      }
    })
  }
}
