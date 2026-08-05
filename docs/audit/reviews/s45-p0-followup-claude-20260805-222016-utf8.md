## Code Review Summary

### P0 Items (Must Land) 鈥?All Complete 鉁?
1. **Upload error thread isolation**
   - `useWebSocket.ts:1183-1185`: Always clears `threadBusyById[uploadErrTid]`, then gates panel chrome with `shouldApplyStreamEvent`
   - `App.tsx:604-610`: SW-fail path uses `activeThreadIdRef.current` with same gate
   - Closure handling correct: `activeThreadIdRef` updated on each render (line 226)

2. **Fleet stop run scope**
   - `thread-busy.ts:177-206`: `buildFleetStopAllMessage` stamps `orchestrator_run_id` for run scope, honest copy for parent/none
   - `FleetStrip.tsx:102-112`: Sends stamped payload
   - `FleetWorkerList.tsx:71-83`: Sends stamped payload
   - `message-router.ts:1810-1820`: Companion filters by `runId` when present

### P1 Items 鈥?All Complete 鉁?
3. **Gate `file.uploaded` panel `isProcessing`**
   - `useWebSocket.ts:1216-1218`: Always clears mapBusy, gates isProcessing with `shouldApplyStreamEvent`

4. **Stamped `file.upload_error` for oversized/invalid**
   - `server.ts:6017-6025`: Oversized 鈫?stamped error with `thread_id`
   - `server.ts:6080-6091`: Invalid file.upload 鈫?stamped error with `thread_id`

5. **`safeUploadBasename` for Office temp write**
   - `file-parser.ts:301-309`: Function strips path/NUL, rejects `.`/`..`
   - `file-parser.ts:258-288`: Applied with double-check containment (`path.relative` escape guard)
   - Tests: 4/4 pass

6. **`plasmo.config.ts` version bump**
   - `plasmo.config.ts:7`: `version: "0.4.0"` 鉁?
### Test Results
- Extension tests: 435/435 pass (including `shouldApplyStreamEvent` upload-error case, `buildFleetStopAllMessage` run stamp)
- Companion file-parser tests: 4/4 pass

### Out of Scope Respected
- No Trust/forceConfirm/cruise algebra changes
- Parent-scoped stop filter unchanged (still process-wide with honest copy)

---

VERDICT: APPROVE
