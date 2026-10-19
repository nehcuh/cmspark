# ACP pending proposal lifecycle and serial execution

GitHub: #722

Root APPROVE_FOR_IMPLEMENTATION_ONLY. This existing issue is not trueN/#728. Prior immutable R2 startup receipt/source6 is the foundation.

New proposal metadata budgets, explicitly not old limits or running capacity: at most4 offered records per thread,64 process-wide,15min from created_at. Lazy reclaim at propose/start/list/get; expired offered emits owner-bound closed/error=expired before deleting only its offer and corresponding caches. Never retire confirmed/running/handback/preparing/owned-child records, cancel running work, release a process slot, poll on a timer or auto-start/select the next row. Unknown/future/unusable clock metadata is conservative refusal, not extra capacity.

max_concurrent_sessions is a fixed literal1/default1; any other raw configuration remains1 and cannot enableN. Original manager start final synchronized admission/reserve and actual close release stay unchanged. Multiple proposals are not automatic queueing or running agents.

Model propose may create4 independent offered records. UI fresh start with an existing offered row remains typed busy before another confirmation. UI explicit selected existing session uses its immutable owner/agent/mode/workspace/goal snapshot, current worker/enabled checks, current capacity precheck and original per-call L2; late approval rechecks original final start. A private WeakSet of actual session objects only prevents duplicate pending confirmation for that offer; finally clears that object, no wire/history authority. Offered remains offered during approval and may expire.

UI lists only same-current-thread actionable offers/running records, selection is explicit and no background event overwrites current target. Existing shell/待启动 copy remains. Selecting/start/cancel requires the current owner/selected object and existing selection revision; old replies do not retarget another conversation. No new PTY or model content channel.

Acceptance uses actual production manager/handler/reducer CPU seams: four offers/fifth refusal;64 global refusal; expiry/cancel/unknown clock; real singleflight admission and delayed close; immutable confirmation snapshots; duplicate/preconfirm refusal; denied/late approval/config/owner/worker controls; same-thread explicit selection/foreign-row rejection and UI output. CPU/controlled win32 seams are not Windows native/daemon/browser proof.
