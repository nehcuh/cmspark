# #532 independent adversarial component review

Date2026-10-14. Reviewer `/root/office_batch`, non-author of this16path confirmation-preview group. Read-only source review plus necessary focused checks. Base exactmain04353ca73b06e245cf0f114ec1ec946b90173dad, branchcodex/confirmation-preview-532 in `/Users/huchen/.codex/worktrees/issue-convergence/cmspark`. Complete implementation report/full diff/spec/fixtures/new tests read, actual production callers inspected. No source/GitHub/app/TCC/capture-permission/native-business changes, no commits/push. Only generated test compilation and isolated test/DOM artifacts written.

## Verdict

**APPROVE — #532 COMPONENT ONLY.** No confirmed P0/P1/P2 blocker. Conservative capability **T3** is appropriate: new diagnostic metadata traverses an existing human security-confirmation channel. No new L2 class, execution action, autonomy, origin/nonce/token authority or trust bypass found. Approval does not approve my authored Browser/Office code, combined group, release, native pixel fidelity, enterpriseT4 or pending shared/ARM/named/exactCI gates.

## Outcome: original external user requirement

Original GitHub532 body retrieved/read fully into `/tmp/cmspark-532-issue.json`: https://github.com/nehcuh/cmspark/issues/532. v0.6.9 failure emitted stale/solid capture log then generic degraded timeoutMs5000 while confirmation still appeared. Request is a visible “预览不可用（降级确认）” plus cause when preview fails, not a requirement to reject every action without an image or modify permission/timeouts.

The actual confirmation card now displays the requested fixed text and a distinct target/capture/OCR/render/timeout/helper cause. Existing Allow/Deny remain. Success, never-attempted/unsupported and old-wire cases remain neutral; image sizing/load failure has a fixed client notice. On mounted confirmation ID replacement old image-failure state no longer hides a new preview. Original failure's observability requirement is met on the full confirmation UI; no claim the historical native capture fault itself is fixed.

Heavy confirmation is Cockpit ConfirmElevated, actual caller `CockpitApp.tsx:234–242`; SidePanel App:280 delegates full preview there. Existing MinimalConfirm is intentionally a compact rapid-response surface linking to Cockpit. This batch changes the full preview card, not compact prompt structure, permissions or where fast responses can be sent. Native Windows/ScreenCaptureKit pixel verification was not run.

## Component correctness and trust chain

### Real helper and late raw lifetime

`companion/src/computer/l2-preview-image.ts:100–167` preserves Promise<Result|null>. Internal Outcome holds either actual image/caption or fixed unavailable enum. Pipeline starts at target_unavailable, advances capture_failed before capture, ocr_failed before OCR/credential scan/anchor location, render_failed before builder. No-window/pathless capture/empty builder return fixed stages; catch never sends native text as cause. Existing raw error stays solely on the pre-existing log path142, not new wire/UI/model metadata.

`finally:144–153` waits until capture/OCR/render settles before raw remove. Credential blur scan118 and crosshair coordinate logic are unchanged. `Promise.race:159` selects actual settled outcome or timeout; callback only occurs once at162 for the winner. The losing timeout branch has no callback; late capture/OCR cannot update already-emitted reason. Pipeline raw cleanup continues on timeout exactly as before; no deletion before a late writer finishes. Optional diagnostic callback exception is caught, cannot block nullable fallback or create approval. Native runner/kill/exit semantics unchanged, controlled cleanup proof is not an OS process timeout proof.

Reason “timeout” correctly refers to exceeding the helper's complete preview budget (including pending cleanup before outcome settlement), not a measurement claiming capture alone took5s. Fixed degraded log includes actual reason, so timeoutMs5000 no longer means every degradation was timeout. No retry/extra capture/permission request added.

### Admission, manager and wire-only schema

Actual Darwin branch `companion/src/tool/l2-admission.ts:802–829`, Windows branch830–858 pass callback into same helper, copy successful image/caption only when returned, import/construction catch uses preview_failed. Both still invoke preview only after existing cheap coordinate/busy/rate checks (`:793–801` surrounding invariant) and before human prompt. Unsupported/missing eligible identifier branch doesn't label an unattempted preview as capture failure. Explicit timeout5000 remains817/846.

`l2-admission.ts:1555–1563` adds only previewUnavailableReason to SecurityConfirmationDetails; finalParams/tool result isn't changed. It has no token/whitelist/session-trust semantics. New field use inventory is limited to helper availability, this details path, manager wire and human frontend. No model/knowledge channel use found. Actual denied admission tests assert field and security_token absent from result.

`companion/src/security-confirmation.ts:337–339` independently validates only six exact strings, strips unknown/raw/nonstring values, emits optional preview_unavailable_reason. Shared helper `computer/preview-availability.ts:2–9` never coerces or stringifies hostile objects. Pending entry authority at277–318 and existing response/origin/nonce logic remain bytewise unaffected by patch; new diagnostic never changes pending owner/nonce/trust fields. Default timeout constant7 remains45000, prompt timer uses existingthis.timeoutMs, not5000.

`chrome-extension/src/sidepanel/hooks/useWebSocket.ts:909–941` actual security.confirmation.request branch now adopts `confirmationPreviewFromMessage` at927 in the existing whitelist. New helper `sidepanel/utils/confirmation-preview.ts:2–18` exact-enum validates reason; image/caption/full_preview old string handling preserved. Reason raw object/string/HTML isn't elevated into trusted text. `agentStore.tsx:1718` ADD_SECURITY_CONFIRMATION and existing hydration keep the accepted request; diagnostic doesn't change reducer approval or confirmation ownership.

### Actual human card and ID state

`chrome-extension/src/cockpit/ConfirmationPreview.tsx:5–30` maps exact whitelisted values to fixed Chinese copy, role=status and existingimage styling/safe size guard. Unknown reason doesn't become HTML/raw native text; old unattempted absence null, valid image success uses existing base64 JPEGimage. Actual onError is fixed “预览图片加载失败”; unsafe oversized image fixed “预览图片无法显示”. Native paths/OCR/window title never appear in new explanation.

`CockpitApp.tsx:479,583–585` failedImageId stores confirmation identity and only marks current ID's image failed; mounted new ID can show fresh image even before reset effects. Other trust/nonce reset effect:493–505, existing45s wire capped≤60s client auto-deny:509–519, response ownership/nonce/trust serialization:536–569, original Allow/Deny unchanged. It is a named export for tests, not a new navigation, approval or tool capability.

## Trajectory: red evidence and accurate gates

Read full `/tmp/cmspark-532-implementation.md` plus complete full.diff16paths SHA256**bd18af1a8ffa3530320acad35403d3478b37372aecf653a9889b499adf764a12**. All16 whole source hashes independently verified against `/tmp/cmspark-532-manifest.json`, before and after tests. New fixture fields originate in actual helper→admission→manager emitted JSON; normalized TAP escapes/opaque IDs preserve schema. Simple SSR unit fixtures are supplemented by actual producer frame replay through production whitelist/reducer, not used alone as real wire proof.

Retained authorred: actualproducer3cases1pass2fail andactualSSR3cases1pass2fail. Report candidly retains corrected test issues (implicit-any annotations, actual fs.rm receipt rather than setImmediate deletion assumption, raw-base64 fixture instead of double dataURL). No product gate relaxation. Authorfocused Companion61/61, front51/51 andbothproductionbuild0 are supplied component evidence. Original fivecase producer repeated3totalgreen; not repeated fullsuite.

Independent necessary checks (nvm22.23.2; actual tsc -p tsconfig.test.json first, so .test-dist matches frozen source):
- Companion canonical isolated runner integration/confirmation-preview-532 +computer-l2-preview-image +security-confirmation-origin: **32/32 PASS**,0fail/skip/cancel,5248.86ms, `/tmp/cmspark-532-independent-companion.log`. Includes real manager/origin+deny wire, success/unattempted, target/capture/timeout, actual owned raw fs.rm completion, hostile managerreason/nonce and original helper credential blur/raw-order tests. The active production preview budget remains5000; injected existing sleep seam settles only controlled timeout quickly.
- Frontend actualconfirmation SSR/frame replay and security-confirmation-forward: **14/14 PASS**,0fail/skip/cancel,54.74ms, `/tmp/cmspark-532-independent-extension.log`. Actual component/whitelist/reducer, no hostile raw reason rendered; original forwarding response flags preserved.
- Independently reran actual Chromium card DOM script viauv, **PASS**, zero pageerrors, `/tmp/cmspark-532-independent-dom.log`. Real component reused between failures/newID; actual image error DOM event visible; successful synthetic2×2JPEG pixel control, no oldfailureinheritance; explicit deny produces approvedfalse/no whitelist/session/enterprise grant/currentID. All browser network aborted and transport synthetic, not installed extension/live SSO/native capture.
- Viewed actual screenshot `/var/folders/f5/f_1l4tl15tnc_rj9gnm4kyfr0000gn/T/cmspark-532-preview-shots/capture-unavailable.png`: notice and cause visibly rendered beside task/actions, Allow/Deny available, no private native title/path. Evidence.json in that directory contains actual denial message, alltrustflags false/none, browser_errors[]; imageerror/success screenshots adjacent. Initial view attempted /tmp path failed because Darwin tempfile root differs; resolved actual script temp root and viewed the real artifact, not substituted image.
- Own additional actual helperprobe `/tmp/cmspark-532-independent-diagnostic-probe.log`: real pipeline emptyrender + throwing onUnavailable, nullable resultnull, exactlyonerender_failed, raw removed aftersettledpipeline, fixeddegraded log, no rawpathpromoted. This tests the new optional callback cannot turn diagnostics into a confirmation failure.

No fullrepository rerun. No native screenshot/current app/TCC/network-business action. Shared combinedmachine/ARM, complete namedmodelreviews and exacthead/mainCI remain pending parent gates. Both independentcompiles createdgeneratedartifacts only;16frozen hashes remainexact.

## Limits / nonblocking observations

- New real admission/manager producer tests exercise Darwin branch with controlled native adapter methods; Windows callback branch inspected directly, samehelper semanticsunit tested. No independent actual Windows pixel/capture acceptance here. Parent Linux focused pass likewise cannot prove Windows/ScreenCaptureKitpixels.
- SuccessfixtureimageZmFrZQ== is an inert control for wire/SSR, notvalidJPEG. The actualbrowser success control intentionally replacesonlyrawimagewith2×2canvasJPEG; don't claim captured pixels.
- Existing compact sidepanel confirmation does not render heavy preview, and existingCockpit full_preview rendering still slices1200chars; unchanged general UI scope is not newly fixed or approved by this component. #532 tests/approval concern visible preview degradation on the actual full preview card, not a complete redesign of allconfirmation content.
- Diagnostic explanations are operator stage summaries, notnativeerrorcauseanalysis. TCC/no-window/nativecapture fault itself remainsseparatelyowned.

No changes required by this component review. This is componentAPPROVE only; root must integrate both narrowuseWebSocket deltas without whole-fileoverwrite then runsharedgates before merge.

## Frozen source SHA256

| File | SHA256 |
| --- | --- |
| `chrome-extension/scripts/render-confirmation-preview-fixture.cjs` | `30a009988a8fc6b20536786756ab900e8058b5a0e7e169fefd940393b0866b16` |
| `chrome-extension/scripts/test-confirmation-preview-ui.py` | `9e7c679918d668078d1460a39a1826896a8103d54b70e70d7ebffec7c0eff756` |
| `chrome-extension/src/cockpit/CockpitApp.tsx` | `8723454ea3ea9df4668c088e20fb2f3f6b4d06d674547311edacccbe974fbbfd` |
| `chrome-extension/src/cockpit/ConfirmationPreview.tsx` | `205b0eec3774134ca216d5e6827b2da6bf500443207ad9e5bcfad042501c0f73` |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | `728b119d0ab9a7b213834f02459272748086c2b0ca66a33b907fd8a11ac0bfa0` |
| `chrome-extension/src/sidepanel/types.ts` | `873040dab653eac890ec7ff0e76aa69fcdb32be3c43d898ca20ab96dbc867865` |
| `chrome-extension/src/sidepanel/utils/confirmation-preview.ts` | `f1aae8896623265303756386cd45d7c88a926cae7eb088e3e1bb1a6449da4d49` |
| `chrome-extension/tests/confirmation-preview-532.test.ts` | `4df38448ac191bf86b8f87d6a275618ed32c95731fcd903ac59e995a6aa4d288` |
| `chrome-extension/tests/fixtures/confirmation-preview-532.json` | `62c4fd6185615700fd796a054c2f2a258ee297741ef16a0e530890d705b578a6` |
| `companion/src/computer/l2-preview-image.ts` | `3e45fdc435d357beff9e94627721ab9c4b87d1cce9441972dac54ca3560f5fd0` |
| `companion/src/computer/preview-availability.ts` | `8ad05105e07a16a09f15f4b32163f77d2bcf43419267603dda3d699ba0b5735d` |
| `companion/src/security-confirmation.ts` | `95afb9f42fb377cd331723666ca4f9fa083d0c53671de6252820151490aff2fb` |
| `companion/src/tool/l2-admission.ts` | `700f28bf283bcdf1a8bdbbb0c6df74455c9f03857a251533defeb9242519904f` |
| `companion/tests/computer-l2-preview-image.test.ts` | `459129e969205e4fd4244e0b9fff9fbaf4a1b1d56dc5842a58548c4da2b6abd8` |
| `companion/tests/integration/confirmation-preview-532.test.ts` | `a6947f391f1107bf8f1e33a7925681bfd176d0b80ba2a98762b3d1ca6c36e494` |
| `docs/superpowers/specs/2026-10-14-confirmation-preview-532.md` | `2d011351df8f6ec67a8c556963ca83c5310274eedfd89bce75f1990c3c5f9783` |

VERDICT: APPROVE (only #532 component), no confirmed P0/P1/P2 blocker; T3, shared/named/native/exactCI gates not waived.
