import fs from 'node:fs'

// The relocated probe has exited before this runs. Windows can still briefly
// deny deletion of its mapped executable. Persistent locks must remain failures.
export function removeOfficeSmokeRuntime(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
