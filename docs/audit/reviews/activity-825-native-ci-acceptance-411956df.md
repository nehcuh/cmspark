# Independent Windows directed native acceptance — 411956df

VERDICT: FAIL. Apps producer/GUI and original #758 pass; scope825 actually executes but the original owned receipt deadline refuses. Successful scope business acceptance is not established.

Source411956df76be5e534e7bd1f406c1ac2e80a859cb, CI41496031308 attempt1, directed native job125451098760 completed FAILURE. Only failed step is Actual passive activity capture and local OCR (#758); earlier bootstrap and interaction steps passed. No source changes, reruns, external comments, timeout changes or foreground manipulations were performed by this reviewer.

- Actual native MCP case PASS4180.5516ms. Original eight phases, successful matching navigation, postAuthRequestMask7, exited/done/approved/denied true, three windows.62 closed BOOT rows reach Navigate and resource callbacks. No historical root cause follows from this success.
- Actual Apps PS producer201/4096/4097 control PASS9920.9035ms.
- Actual Apps visible/minimized/hidden/no-window/foreground case PASS10822.1506ms. Original finite receipt confirms identity stability, unchanged foreground and exited-process removal; final TAP success follows original close joins and removal/lease settlement.
- Original real passive screenshot/local OCR/minimized refusal/notification #758 PASS9921.0129ms, with original native receipt and cleanup.
- scope825 actual two-column case FAIL10181.1319ms, not skipped. Error OWNED_SCOPE825_RECEIPT_TIMEOUT, ERR_TEST_FAILURE, stack at helpers/activity-scope825-native.js:45 (original10-second receipt timer). No scope825 success capability receipt.

The activity step totals8 PASS/1 FAIL/0 SKIP. The failed case's original finally completes retaining the receipt-timeout error; no separate cleanup failure is reported, and post-job orphan cleanup lists only vctip. Thus its normal child-close/removal path did not replace or stall the primary failure. Scope pending-image cleanup and all success-path business assertions are not established by this failed case.

The public transcript does not identify which ready/ack file was awaited when the deadline expired. It is not sound to identify an exact initial-render/foreground/focus/resize/popup stage from elapsed duration alone. The qualified receipt guard may deliberately withhold a receipt when a precondition is absent; the present observation does not tell which precondition or whether that explains the earlier PID mismatch. No claim of title OCR, crop/model input, resize or popup completion is made.

Public transcript: /tmp/cmspark-825-windows-4119-native-job.log. Full census remains independently monitored; a known CRLF consumer issue from bd43 is tracked separately and is not silently counted as this native failure.
