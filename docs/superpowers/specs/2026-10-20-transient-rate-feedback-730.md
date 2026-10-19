# Transient host-computer rate feedback

GitHub: #730

The existing process rate limiter refuses a new `host_computer` task after30 successful injections within60000ms. Its pre-L2 producer currently drops the typed `RATE_LIMITED` signal; default text classification then halts the conversation. This existing bugfix preserves the refusal and window, while returning an intrinsically recoverable observation.

Root-approved finite table: `RATE_LIMITED` → recoverable; optional typed propagation of `COMPUTER_TASK_BUSY` → its existing non_recoverable. All167 existing grades, DEFAULT59, substring fallback, global computer1, task15/max30, L2/token/owner/worker/Trust and third-same-tool breaker remain. No queue, automatic retry, confirmation, injection or new authority is introduced.

Acceptance uses the complete current admission/earlyResult, real InjectionRateLimiter with virtual clock, actual classifier and adapter hard-stop block. Saturation0/59999ms must refuse without stopping the turn and with zero execution/approval/token/native/network effects; exact60000ms or29 injections must reach the original confirmation boundary. The test boundary explicitly remains unavailable, not a synthetic human approval. Permission denial and COMPUTER_TASK_BUSY remain hard; hostile diagnostic text cannot regrade RATE_LIMITED. The existing exact bidirectional registry guard is extended, not replaced.

Version remains the0.6.14 development line. This leaf supplies the remaining finite rate outlet plus an evidence-bound family inventory; issue closure still requires full originalDoD and independent review/CI acceptance. It does not reopen already-delivered#563 families or change multi-worker capacity.
