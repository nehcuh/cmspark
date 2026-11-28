import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { beginMeetingCapture, createMeeting, loadMeeting, reconcileStaleRecordings } from "../src/meeting/meeting-store"

test("a foreground grant query leaves an ongoing capture for its server", t => {
  const profile = mkdtempSync(path.join(tmpdir(), "cmspark-meeting-owner-"))
  t.after(() => rmSync(profile, { recursive: true, force: true }))
  const { id } = createMeeting({ dataDir: profile })
  const capture = beginMeetingCapture(id, "capture-owned", 0, profile, "local")
  assert.equal(capture?.status, "recording")
  const query = spawnSync(process.execPath, [require.resolve("../src/index"), "outbound-grant", "list"], {
    env: { ...process.env, CMSPARK_DATA_DIR: profile }, encoding: "utf8", timeout: 30_000, windowsHide: true,
  })
  assert.equal(query.error, undefined)
  assert.equal(query.status, 0, query.stderr)
  assert.deepEqual(loadMeeting(id, profile)?.capture_summary, capture?.capture_summary)
  assert.equal(loadMeeting(id, profile)?.status, "recording")

  assert.deepEqual(reconcileStaleRecordings(profile).demoted, [id])
  assert.equal(loadMeeting(id, profile)?.capture_summary?.outcome, "interrupted")
  assert.deepEqual(reconcileStaleRecordings(profile).demoted, [])
})
