// cmspark-agent CLI entry point

import { startServer } from "./server"
import { initDataDir } from "./config"

const command = process.argv[2]

async function main() {
  switch (command) {
    case "start":
      await initDataDir()
      await startServer()
      break
    case "stop":
      console.log("Stop command not yet implemented")
      process.exit(0)
    case "status":
      console.log("Status command not yet implemented")
      process.exit(0)
    default:
      console.log(`cmspark-agent v0.1.0

Usage:
  cmspark-agent start     Start the companion server
  cmspark-agent stop      Stop the companion server
  cmspark-agent status    Show server status`)
      process.exit(0)
  }
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
