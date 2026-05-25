// CMspark Browser Agent — Popup

import { useEffect, useState } from "react"

type ConnectionState = "connected" | "connecting" | "disconnected"

function Popup() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
      if (response) setConnectionState(response.connectionState)
    })
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
        if (response) setConnectionState(response.connectionState)
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const colors = {
    connected: "#4CAF50",
    connecting: "#FFC107",
    disconnected: "#F44336",
  }

  const labels = {
    connected: "已连接",
    connecting: "连接中...",
    disconnected: "未连接",
  }

  const openSidePanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId })
      }
    })
    window.close()
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ ...styles.dot, background: colors[connectionState] }} />
        <span style={styles.title}>CMspark Agent</span>
      </div>

      <div style={styles.status}>
        <span style={{ ...styles.statusText, color: colors[connectionState] }}>
          {labels[connectionState]}
        </span>
      </div>

      <button style={styles.sidePanelBtn} onClick={openSidePanel}>
        打开 Side Panel
      </button>

      <div style={styles.footer}>
        <button style={styles.linkBtn} onClick={() => chrome.runtime.openOptionsPage()}>
          设置
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 240,
    padding: 14,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    color: "#1a1a1a",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  title: {
    fontWeight: 600,
    fontSize: 14,
  },
  status: {
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 500,
  },
  sidePanelBtn: {
    width: "100%",
    padding: "8px 0",
    border: "none",
    borderRadius: 6,
    background: "#4A90D9",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    marginBottom: 10,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#4A90D9",
    fontSize: 12,
    cursor: "pointer",
  },
}

export default Popup
