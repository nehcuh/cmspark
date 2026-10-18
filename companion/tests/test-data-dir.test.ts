import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import vm from "node:vm"

test("test preload isolates each process before config imports and leaves caller data untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-isolation-contract-"))
  const callerDir = path.join(root, "caller")
  fs.mkdirSync(callerDir)
  const sentinel = '{"security":{"auto_approve_dangerous":true}}'
  fs.writeFileSync(path.join(callerDir, "config.json"), sentinel)
  const preload = path.resolve(__dirname, "../../scripts/test-data-dir.cjs")
  const configModule = path.resolve(__dirname, "../src/config.js")
  try {
    const dirs = [0, 1].map(() => {
      const child = spawnSync(process.execPath, ["--require", preload, "-e", `
        const { DATA_DIR, getConfig, saveConfig } = require(${JSON.stringify(configModule)});
        if (getConfig().security.auto_approve_dangerous === true) throw new Error('inherited caller policy');
        saveConfig({security: {...getConfig().security, auto_approve_dangerous: true}});
        process.stdout.write('DATA_DIR=' + DATA_DIR);
      `], {
        encoding: "utf8",
        env: { ...process.env, CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: callerDir },
      })
      assert.equal(child.status, 0, child.stderr)
      const dir = child.stdout.split("DATA_DIR=").at(-1)!
      assert.equal(path.dirname(dir), root)
      assert.notEqual(dir, callerDir)
      return dir
    })
    assert.notEqual(dirs[0], dirs[1], "test workers must not share mutable config")
    assert.equal(fs.readFileSync(path.join(callerDir, "config.json"), "utf8"), sentinel)
    assert.deepEqual(fs.readdirSync(callerDir), ["config.json"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("test runner isolates workers, supports targeted runs, and cleans data after a failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-worker-contract-"))
  const scripts = path.join(root, "scripts")
  const fixtures = path.join(root, ".test-dist", "tests")
  fs.mkdirSync(scripts, { recursive: true })
  fs.mkdirSync(fixtures, { recursive: true })
  const caller = path.join(root, "caller")
  fs.mkdirSync(caller)
  fs.writeFileSync(path.join(caller, "sentinel"), "untouched")
  fs.writeFileSync(path.join(fixtures, "unselected.test.js"), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "unselected-ran"))}, 'bad')`)
  for (const name of ["run-tests.mjs", "test-data-dir.cjs"]) {
    fs.copyFileSync(path.resolve(__dirname, "../../scripts", name), path.join(scripts, name))
  }
  try {
    const files = ["a", "b"].map(name => {
      const filename = path.join(fixtures, `${name}.test.js`)
      fs.writeFileSync(filename, `
        const fs = require('node:fs');
        const { spawnSync } = require('node:child_process');
        const dir = process.env.CMSPARK_DATA_DIR;
        const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.CMSPARK_DATA_DIR)'], { encoding: 'utf8' });
        if (child.status !== 0 || child.stdout !== dir) throw new Error('unsafe child inheritance');
        fs.writeFileSync(${JSON.stringify(path.join(root, name + ".json"))}, JSON.stringify({dir}));
        require('node:test')('worker fixture', () => {
          if (${JSON.stringify(name)} === "b") throw new Error('intentional test failure');
        });
      `)
      return filename
    })
    const env = { ...process.env, CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: path.join(root, "caller") }
    // Start a new test runner, not a child impersonating this runner's IPC worker.
    delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, [path.join(scripts, "run-tests.mjs"), ...files], {
      encoding: "utf8",
      env,
    })
    assert.equal(run.status, 1, "failing test must propagate failure: " + run.stdout + run.stderr)
    assert.ok(fs.existsSync(path.join(root, "a.json")), run.stdout + run.stderr)
    const dirs = ["a", "b"].map(name => JSON.parse(fs.readFileSync(path.join(root, name + ".json"), "utf8")).dir)
    assert.notEqual(dirs[0], dirs[1])
    assert.equal(path.dirname(dirs[0]), path.dirname(dirs[1]))
    for (const dir of dirs) assert.equal(fs.existsSync(dir), false, "runner cleans worker data on failure")
    assert.equal(fs.readFileSync(path.join(caller, "sentinel"), "utf8"), "untouched")
    assert.deepEqual(fs.readdirSync(caller), ["sentinel"])
    assert.equal(fs.existsSync(path.join(root, "unselected-ran")), false, "targeted runner must skip other discovered files")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})


// Execute the actual complete runner with an inert spawn outlet. No child or
// platform-native fixture is started by this scheduling contract.
test("Windows runner serializes original file budgets without changing discovery or case deadlines", () => {
  const owned=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-schedule-contract-"))),scripts=path.join(owned,"scripts"),fixtures=path.join(owned,".test-dist/tests")
  fs.mkdirSync(scripts);fs.mkdirSync(fixtures,{recursive:true});fs.mkdirSync(path.join(fixtures,"nested"))
  const source=fs.readFileSync(path.resolve(__dirname,"../../scripts/run-tests.mjs"),"utf8")
  const imports=source.match(/^import .*$/gm) || [];assert.equal(imports.length,5)
  const program=source.replace(/^import .*$/gm,"").replace("import.meta.url",'"owned:runner"')
  for(const name of ["one.test.js","two.test.js","settings-web.test.js","_ignored.test.js","nested/three.test.js"])fs.writeFileSync(path.join(fixtures,name),"OWNED_INERT_NOT_EXECUTED")
  const all=["one.test.js","two.test.js","nested/three.test.js","settings-web.test.js"].map(n=>fs.realpathSync(path.join(fixtures,n))).sort()
  const execute=(platform:string,requested:string[]=[],status=0) => {
    const calls:{args:string[];options:any}[]=[],end={code:-1},exit=Symbol("owned-exit")
    const context:any={fs,path,os:{tmpdir:()=>owned},fileURLToPath:()=>path.join(scripts,"run-tests.mjs"),spawnSync:(_bin:string,args:string[],options:any)=>{calls.push({args,options});return {status,signal:null}},console:{error:()=>{}},process:{execPath:"/owned/node",argv:["/owned/node","owned-runner",...requested],platform,versions:{node:"22.23.2"},env:{OWNED_SENTINEL:"inert"},exit(code:number){end.code=code;throw exit}}}
    vm.createContext(context);try{vm.runInContext(program,context)}catch(error){if(error!==exit)throw error}
    assert.notEqual(end.code,-1);return {calls,code:end.code,context}
  }
  try{
    for(const platform of ["win32","darwin","linux"]){
      const result=execute(platform);assert.equal(result.code,0);assert.equal(result.calls.length,2)
      const main=result.calls[0],settings=result.calls[1],files=result.calls.flatMap(c=>c.args.filter(a=>a.startsWith(fixtures))).sort()
      assert.deepEqual(files,all);assert.equal(new Set(files).size,all.length)
      assert.equal(main.args.includes("--test-concurrency=1"),platform==="win32")
      assert.equal(main.args.includes("--test-timeout"),false);assert.equal(settings.args.includes("--test-concurrency=1"),false)
      assert.ok(settings.args.includes("--experimental-test-isolation=none"));assert.deepEqual(Array.from(settings.args.filter(a=>a.startsWith(fixtures))),[path.join(fixtures,"settings-web.test.js")])
      for(const call of result.calls){assert.equal(call.args[0],"--require");assert.equal(call.args[1],path.join(scripts,"test-data-dir.cjs"));assert.equal(call.args[2],"--test");assert.equal(call.options.cwd,owned);assert.equal(call.options.stdio,"inherit");assert.equal(call.options.env.OWNED_SENTINEL,"inert");assert.equal(fs.existsSync(call.options.env.CMSPARK_TEST_RUN_DIR),false)}
      const fixed=main.args.filter(a=>!a.startsWith(fixtures)),many=Array.from({length:600},(_,i)=>"/owned/"+"x".repeat(100)+i+".test.js")
      const batches:string[][]=result.context.chunkByArgv("/owned/node",fixed,many)
      assert.deepEqual(Array.from(batches).flat(),many);assert.ok(batches.length>1)
      for(const batch of batches)assert.ok(result.context.argvChars("/owned/node",fixed,batch)<=32000)
    }
    const requested=[path.join(fixtures,"two.test.js"),path.join(fixtures,"two.test.js")],target=execute("win32",requested)
    assert.equal(target.calls.length,1);assert.deepEqual(Array.from(target.calls[0].args.filter(a=>a.startsWith(fixtures))),[requested[0]])
    const failure=execute("win32",[],1);assert.equal(failure.code,1);assert.equal(failure.calls.length,1,"failure must not start settings after failed main")
    const invalid=execute("win32",[path.join(owned,"foreign.test.js")]);assert.equal(invalid.code,1);assert.equal(invalid.calls.length,0)
    assert.deepEqual(fs.readdirSync(owned).sort(),[".test-dist","scripts"])
  }finally{fs.rmSync(owned,{recursive:true,force:true})}
})
