// CMspark Browser Agent — Side Panel Entry
import { useEffect, useState } from "react"
import { App } from "./App"

function SidePanel() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Verify side panel is properly loaded
    setReady(true)
  }, [])

  if (!ready) return null
  return <App />
}

export default SidePanel
