/** Explicit post-build Windows CPU consumer; canonical census discovers it too. */
import test from 'node:test'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
if(process.platform==='win32')test('825 actual native worker/file reader distinguishes same-wire schedules, coherent publication, nested dispatch and UNKNOWNs',{timeout:30000},async t=>{
 const module=await(new Function('url','return import(url)'))(pathToFileURL(path.resolve(__dirname,'../../scripts/desktop-mcp-snapshot-cpu-runtime-825.mjs')).href)
 await module.runMcpSnapshotCpu825(t)
})
