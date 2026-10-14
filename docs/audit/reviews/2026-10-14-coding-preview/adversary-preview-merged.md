# #532 preview integration independent incremental review

Reviewer `/root/office_batch`, non-author of532;2026-10-14. Scope ONLY already-approved confirmation-preview component's integration into frozen UI R3 + preview wave. Base04353ca73b06e245cf0f114ec1ec946b90173dad. No source/GitHub/commit/push mutations, no installed app/capture/permissions/native pixels. No approval of authored Browser/Office or entire37path wave.

## Verdict

**APPROVE — PREVIEW COMBINATION DELTA ONLY**. No new confirmed P0/P1/P2 defect introduced in532 by the shared-file merge. Prior16path component approval stays valid, with the same T3 conservative human-confirmation-channel scope and limits. Independent UI R3 and named final judges/exactCI remain separate parent gates.

## Frozen identity and mechanical integration proof

Complete prior report retained as `review/adversary-preview.md`, byte-for-byte SHA256 **bdc8680209fea6b95a3dcffeb518f1ecf799bedda2f7730172b528da2d2fe381**. No need to rerun the unchanged helper/component suite; its complete report contains original requirement, red/green, actualproducer→admission→manager→UI proof, raw cleanup/hostile/deny observations and native-pixel limits.

Independently verified all **15 nonshared** preview files against prior `/tmp/cmspark-532-manifest.json`, exact same bytes and also same values in combined manifest. Shared `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` SHA256 **895e8ad8d9bdfee1d9dda5a211568afe2a4df87b1503c43abfa473644a9b29a6** matches combined manifest.

Independently recreated `git merge-file --stdout` from exactbase043 source plus the two component source files whose whole-file SHA values were first verified against their component manifests. This clean3-way result matched the actual combined WS file byte-for-byte, exit0. Temporary comparison files only; no source writes. Also compared the **entire security.confirmation.request case** through the following switch case to the previously approved preview-only file: identical bytes, not just matching the new import. Receipt `review/adversary-preview-merge-proof.json` records these assertions.

Thus no dropped oldfields, duplicate fallthrough, wholefileoverwrite or unrelated merge edits found.

## Actual merged callers / owner and trust boundary

- `useWebSocket.ts:4` retains confirmationPreviewFromMessage import;`:7` separately imports codingControlAction. Neither name/namespace collides.
- Merged `:908–942` security.confirmation.request case still dispatches ADD_SECURITY_CONFIRMATION with all existing promptfields, exactnonce stringfilter925, preview whitelist928, owner/worker/orchestrator fields930–935, enterprise-offerbool936 and same expertteam field937. Ends in break942. New532 helper maps only image/caption/full_preview/reason; it does not modify confirmation_id,owner,nonce,timeout,approval/trust or reduceraction. Complete case byteidentity proves this unchanged beyond numericline shift.
- Other message types are disjoint: acp.session.event1669–1673 and acp.session.cancel.ack1675–1677 handle ACP state/receipt only. ACP error routing2412–2429 occurs inside the separate error case; it cannot intercept a security.confirmation.request already consumed at908–942. Preview diagnostic doesn't introduce msg.family or error type.
- Actual new UI R3 `coding-control-message.ts:10–20` chooses ACP_CONTROL_ERROR only for typedcancel and ACP_OPERATION_ERROR for exacttypedfollowup/prompt/apply, older/other repliesreturnnull. This neither translates previewreason nor dispatches a confirmationresponse. Checked this actualhelper, not assumed from oldR2 diff.
- Agent reducer `agentStore.tsx:1753` confirmationaddition remains its independentpendingqueue action. ACPcancel/Stop cases1981–1997 retain immutableowner/cancel/closed/compacted fences; operationfeedback1998–2006 checksstoredowner/currentowner/currentselection and stores only boundedhumanerror outside richcache. These cases do not granttoken/trust, mutate pendingSecurityConfirmations or adopt anunknownsessionasowner. This is an integration-boundary check, not a substitute wholeUIR3 componentreview or decision on522closure.
- All backend532 pipeline/admission/manager and actualCockpit files are among15 unchangedhashes. Prior5s preview/45s manager/origin/nonce/deny behavior, actual rawfinallyafterallawaits, fixedreason model/tool exclusion and newID imagefailurestate remain accepted exactly as before. No new trustauthority through neighboring ACPcase.

## Necessary focused check and shared machine scope

Node22.23.2 via nvm on combinedsnapshot: only productionwhitelist/replay/SSR/forwarding testfamily rerun, **14/14 PASS**,0fail/skip/cancel,47.516ms, `review/adversary-preview-forward-focused.log`. No fullcomponents/wholeinventory/bothbuild rerun. Frozencombined source15+shared hashes are unchanged afterchecks.

Root's frozen `machine.json` records actualgroupfinalhost5939total5887PASS52existingskips0fail/cancel, extension1546PASS, testcompile/fulltests/bothproductionbuild0. Freshlocked ARM64 container204targetedtotal203PASS1existingWindows-onlyskip +extension102PASS, bothbuild0. Linux istargetedcombinedcoverage, notfullLinuxinventory. ComponentpriorDOM and controlledcapturetests are notnativeWindows/ScreenCaptureKitpixels/Chromebusinessaccuracy/T4 proof.

Exactnewhead/mainCI and finalnamedjudges remainpending in this machinecard. This report does not waive them, create releaseapproval or claimmerge. It only confirms532 survives the merge unchanged.

## Verified unchanged preview source SHA256

| File | SHA256 |
| --- | --- |
| `chrome-extension/scripts/render-confirmation-preview-fixture.cjs` | `30a009988a8fc6b20536786756ab900e8058b5a0e7e169fefd940393b0866b16` |
| `chrome-extension/scripts/test-confirmation-preview-ui.py` | `9e7c679918d668078d1460a39a1826896a8103d54b70e70d7ebffec7c0eff756` |
| `chrome-extension/src/cockpit/CockpitApp.tsx` | `8723454ea3ea9df4668c088e20fb2f3f6b4d06d674547311edacccbe974fbbfd` |
| `chrome-extension/src/cockpit/ConfirmationPreview.tsx` | `205b0eec3774134ca216d5e6827b2da6bf500443207ad9e5bcfad042501c0f73` |
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

VERDICT: APPROVE (preview integration delta only); T3 unchanged, no confirmed new P0/P1/P2; combined/native/exactCI gates remain parent-owned.
