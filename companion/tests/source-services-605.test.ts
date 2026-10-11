import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repo = path.resolve(__dirname, "../../..")
const run = (command: string, args: string[], options: any = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 20000, ...options })
  assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout as string
}

for (const platform of ["Darwin", "Linux"]) {
  test(`actual ${platform} source installer renders literal paths and foreground supervision`, { skip: process.platform === "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-service-605-")), home = path.join(root, "user ${HOME} space & 百分% 'owned")
    const bin = path.join(root, "bin"), agent = path.join(root, "agent ${HOME} space & 中文% 'owned.js")
    fs.mkdirSync(bin); fs.mkdirSync(home); fs.mkdirSync(path.join(home, "Applications"))
    fs.writeFileSync(agent, "process.stdout.write(JSON.stringify(process.argv.slice(2)))")
    fs.symlinkSync(process.execPath, path.join(bin, "node"))
    const checksum = path.join(bin, "checksum.cjs")
    fs.writeFileSync(checksum, "const fs=require('fs'),crypto=require('crypto');process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv.at(-1))).digest('hex')+'  fixture\\n')")
    for (const name of ["shasum", "sha256sum"]) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${checksum}' "$@"\n`, { mode: 0o755 })
    for (const [name, body] of [["uname", `printf '${platform}\\n'`], ["launchctl", "exit 0"], ["systemctl", "exit 0"]]) {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    }
    try {
      run("bash", [path.join(repo, "scripts/install-daemon.sh"), "daemon-only"], { env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CMSPARK_AGENT_PATH: agent } })
      if (platform === "Darwin") {
        const plist = fs.readFileSync(path.join(home, "Library/LaunchAgents/com.cmspark.companion.plist"), "utf8")
        assert.ok(plist.includes("&amp;") && plist.includes("&apos;")); assert.ok(!plist.includes("--daemonize"))
        assert.ok(plist.includes(`<string>${path.join(bin, "node")}</string>`))
        if (process.platform === "darwin") run("/usr/bin/plutil", ["-lint", path.join(home, "Library/LaunchAgents/com.cmspark.companion.plist")])
      } else {
        const unit = fs.readFileSync(path.join(home, ".config/systemd/user/cmspark-companion.service"), "utf8")
        assert.ok(unit.includes(`ExecStart=:"${path.join(bin, "node")}" "${agent.replace(/%/g, "%%")}" daemon start`))
        assert.ok(unit.includes(`ExecStop=:"${path.join(bin, "node")}"`)); assert.ok(!unit.includes("--daemonize") && !unit.includes("{{"))
      }
      assert.deepEqual(JSON.parse(run(process.execPath, [agent, "daemon", "start"], { env: { PATH: "/usr/bin:/bin" } })), ["daemon", "start"])
      const registration = path.join(home, platform === "Darwin" ? "Library/LaunchAgents/com.cmspark.companion.plist" : ".config/systemd/user/cmspark-companion.service")
      const previous = fs.readFileSync(registration, "utf8"), badAgent = path.join(root, "invalid\nentry.js")
      fs.writeFileSync(badAgent, "owned fixture")
      const failed = spawnSync("bash", [path.join(repo, "scripts/install-daemon.sh"), "daemon-only"], { env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CMSPARK_AGENT_PATH: badAgent }, encoding: "utf8", timeout: 10000 })
      assert.equal(failed.status, 1, failed.stdout + failed.stderr)
      assert.equal(fs.readFileSync(registration, "utf8"), previous, "failed render preserves the working registration")
      assert.deepEqual(fs.readdirSync(path.dirname(registration)), [path.basename(registration)])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}

test("source Windows installer uses literal spaced argv and preserves state after failed stop", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark service 中文 & owned-"))
  const scripts = path.join(root, "scripts"), companion = path.join(root, "companion"), data = path.join(root, "data"), harness = path.join(root, "harness.ps1")
  for (const dir of [scripts, path.join(companion, "dist"), data]) fs.mkdirSync(dir, { recursive: true })
  for (const name of ["install-daemon.ps1", "uninstall-daemon.ps1"]) fs.copyFileSync(path.join(repo, "scripts", name), path.join(scripts, name))
  const entry = path.join(companion, "dist/index.js"), argv = path.join(root, "argv.json")
  fs.writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(argv)},JSON.stringify(process.argv.slice(2)));process.exit(process.env.OWNED_STOP_FAIL==='1'?1:0)`)
  fs.writeFileSync(harness, `param([string]$Installer,[string]$Node,[string]$Result)
    $ErrorActionPreference='Stop';$global:actions=@();$global:registered=($env:OWNED_TASK_EXISTS -eq '1')
    function global:Get-Command { param($Name,$ErrorAction); if($Name -eq 'node'){if($env:OWNED_NODE_MISSING -ne '1'){[pscustomobject]@{Source=$Node}}}else{Microsoft.PowerShell.Core\\Get-Command $Name -ErrorAction $ErrorAction} }
    function global:Get-ScheduledTask { param($TaskName,$ErrorAction);if($global:registered){[pscustomobject]@{TaskName=$TaskName}} }
    function global:New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory);$global:actions+=@{Execute=$Execute;Argument=$Argument;WorkingDirectory=$WorkingDirectory};[pscustomobject]@{} }
    function global:New-ScheduledTaskTrigger { param([switch]$AtLogOn);[pscustomobject]@{} }
    function global:New-ScheduledTaskSettingsSet { param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$StartWhenAvailable,[switch]$RunOnlyIfNetworkAvailable,$RestartCount,$RestartInterval);[pscustomobject]@{} }
    function global:New-ScheduledTaskPrincipal { param($UserId,$RunLevel);[pscustomobject]@{} }
    function global:Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Settings,$Principal,[switch]$Force);$global:registered=$true }
    function global:Start-ScheduledTask { param($TaskName) }
    function global:Stop-ScheduledTask { param($TaskName,$ErrorAction);throw 'Unexpected destructive task stop' }
    function global:Unregister-ScheduledTask { param($TaskName,$Confirm);throw 'Unexpected task removal' }
    function global:Start-Sleep { param($Seconds) }
    function global:New-Object { param($ComObject);$obj=[pscustomobject]@{};$obj|Add-Member ScriptMethod CreateShortcut {param($Path);$s=[pscustomobject]@{TargetPath='';Arguments='';WorkingDirectory='';Description=''};$s|Add-Member ScriptMethod Save {};$global:shortcut=$s;return $s};return $obj }
    try { if($env:OWNED_FORCE -eq '1'){ & $Installer -Force }else{ & $Installer }; @{actions=$global:actions;shortcut=$global:shortcut}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $Result -Encoding UTF8 } catch { [Console]::Error.WriteLine($_.Exception.Message);exit 1 }
  `)
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), result = path.join(root, "result.json")
  const env = { ...process.env, USERPROFILE: root, APPDATA: root, CMSPARK_DATA_DIR: data }
  try {
    run(ps, ["-NoProfile", "-NonInteractive", "-File", harness, "-Installer", path.join(scripts, "install-daemon.ps1"), "-Node", process.execPath, "-Result", result], { env })
    const rendered = JSON.parse(fs.readFileSync(result, "utf8").replace(/^\uFEFF/, ""))
    assert.equal(rendered.actions[0].Execute, process.execPath)
    assert.equal(rendered.actions[0].Argument, `"${entry}" daemon start`)
    assert.equal(rendered.shortcut.Arguments, `"${entry}" tray`)
    const pid = path.join(data, "daemon.pid"); fs.writeFileSync(pid, "owned state")
    const failed = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-File", harness, "-Installer", path.join(scripts, "uninstall-daemon.ps1"), "-Node", process.execPath, "-Result", result], { env: { ...env, OWNED_STOP_FAIL: "1" }, encoding: "utf8", timeout: 15000 })
    assert.equal(failed.status, 1, failed.stdout + failed.stderr); assert.ok(fs.existsSync(pid))
    assert.deepEqual(JSON.parse(fs.readFileSync(argv, "utf8")), ["daemon", "stop"])
    fs.linkSync(process.execPath, path.join(companion, "node.exe"))
    const bundled = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-File", harness, "-Installer", path.join(scripts, "uninstall-daemon.ps1"), "-Node", process.execPath, "-Result", result], { env: { ...env, OWNED_STOP_FAIL: "1", OWNED_NODE_MISSING: "1" }, encoding: "utf8", timeout: 15000 })
    assert.equal(bundled.status, 1); assert.match(bundled.stderr, /Daemon did not stop/)
    assert.ok(fs.existsSync(pid)); assert.deepEqual(JSON.parse(fs.readFileSync(argv, "utf8")), ["daemon", "stop"])
    fs.unlinkSync(pid)
    const force = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-File", harness, "-Installer", path.join(scripts, "install-daemon.ps1"), "-Node", process.execPath, "-Result", result], { env: { ...env, OWNED_STOP_FAIL: "1", OWNED_TASK_EXISTS: "1", OWNED_FORCE: "1" }, encoding: "utf8", timeout: 15000 })
    assert.equal(force.status, 1); assert.match(force.stderr, /Existing daemon did not stop; task preserved/)
    assert.deepEqual(JSON.parse(fs.readFileSync(argv, "utf8")), ["daemon", "stop"])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})


for (const platform of ["Darwin", "Linux"]) {
  test(`source ${platform} uninstall finds the repository entry without a global binary`, { skip: process.platform === "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-uninstall-605-")), home = path.join(root, "home"), bin = path.join(root, "bin"), scripts = path.join(root, "scripts"), data = path.join(root, "custom data")
    const entry = path.join(root, "companion/dist/index.js"), marker = path.join(root, "argv.json")
    for (const dir of [bin, scripts, data, path.dirname(entry), path.join(home, "Applications/CMspark Agent.app")]) fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(repo, "scripts/uninstall-daemon.sh"), path.join(scripts, "uninstall-daemon.sh"))
    fs.symlinkSync(process.execPath, path.join(bin, "node"))
    for (const [name, body] of [["uname", `printf '${platform}\\n'`], ["launchctl", "exit 0"], ["systemctl", "exit 0"]]) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    fs.writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));process.exit(process.env.OWNED_STOP_FAIL==='1'?1:0)`)
    const defaultData = path.join(home, ".cmspark-agent")
    fs.mkdirSync(defaultData); fs.writeFileSync(path.join(defaultData, "keep.txt"), "UNRELATED_DEFAULT_DATA")
    const pid = path.join(data, "daemon.pid"); fs.writeFileSync(pid, "owned fixture")
    const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CMSPARK_AGENT_PATH: "", CMSPARK_DATA_DIR: data }
    try {
      const failed = spawnSync("bash", [path.join(scripts, "uninstall-daemon.sh"), "--purge"], { env: { ...env, OWNED_STOP_FAIL: "1" }, encoding: "utf8", timeout: 10000 })
      assert.equal(failed.status, 1, failed.stdout + failed.stderr); assert.ok(fs.existsSync(pid))
      assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), ["daemon", "stop"])
      fs.unlinkSync(path.join(bin, "node"))
      const noNode = spawnSync("/bin/bash", [path.join(scripts, "uninstall-daemon.sh"), "--purge"], { env: { ...env, PATH: bin, CMSPARK_AGENT_PATH: entry }, encoding: "utf8", timeout: 10000 })
      assert.equal(noNode.status, 1); assert.match(noNode.stderr, /Node.js missing.*state preserved/)
      assert.ok(fs.existsSync(pid)); assert.ok(fs.existsSync(path.join(home, "Applications/CMspark Agent.app")))
      fs.symlinkSync(process.execPath, path.join(bin, "node"))
      run("bash", [path.join(scripts, "uninstall-daemon.sh"), "--purge"], { env }); assert.ok(!fs.existsSync(data))
      assert.equal(fs.readFileSync(path.join(defaultData, "keep.txt"), "utf8"), "UNRELATED_DEFAULT_DATA")
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}
