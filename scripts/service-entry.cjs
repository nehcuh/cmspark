// Task Scheduler and shortcuts start with a fresh environment at login.
const path = require('node:path')
const [dataDir, agent, ...args] = process.argv.slice(2)
if (!dataDir || !agent || !path.isAbsolute(dataDir) || !path.isAbsolute(agent)) {
  throw new Error('Service entry requires absolute data and agent paths')
}
process.env.CMSPARK_DATA_DIR = dataDir
process.argv = [process.execPath, agent, ...args]
require(agent)
