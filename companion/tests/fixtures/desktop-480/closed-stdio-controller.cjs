// Owned subprocess only: closing its standard descriptors must not lose bootstrap.
const fs=require('node:fs')
const binding=require(process.argv[2])
const binary=process.argv[3]
for(const fd of process.argv[4].split(',').map(Number))fs.closeSync(fd)
const child=binding.launch(binary,'11'.repeat(16),'22'.repeat(32),'ws://127.0.0.1:1/desktop',code=>process.exit(code))
process.on('exit',()=>child.terminate())
