// Owned nonissuer fixture. Only inert unissued bootstrap values, no network or JSON output.
const binding=require(process.argv[2]);
global.owned=binding.launch(process.argv[3],"11".repeat(16),"22".repeat(32),"ws://127.0.0.1:1/desktop",code=>{process.exitCode=code});
