# Stable Windows Terminal AUMID vault identity

GitHub: #683 — https://github.com/nehcuh/cmspark/issues/683
Parent: #70 candidate 2 (one prerequisite; neither full CLI track nor whole parent).
Status: IMPLEMENTATION_CANDIDATE — root contract approved; independent delivery gates pending.
Base: main `737ad49c5f29aff14ee28f46e1eaea714625c62d`.

## Product behavior and evidence

The already protected terminal identity must remain protected when Apps receives stable Windows Terminal through AUMID rather than EXE. Recognize exactly `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App` as existing `win.terminal`; no other AUMID is newly classified.

Evidence (official sources, read before this contract):

- [Pinned Microsoft Terminal manifest](https://github.com/microsoft/terminal/blob/44b440bf043522ec06014b2cff30d0f52ca30b68/src/cascadia/CascadiaPackage/Package.appxmanifest): Identity.Name `Microsoft.WindowsTerminal`; Application.Id `App`.
- [Microsoft Learn Terminal installation](https://learn.microsoft.com/en-us/windows/terminal/install): stable package family `Microsoft.WindowsTerminal_8wekyb3d8bbwe`.
- [Microsoft Learn AUMID construction](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid): package family, `!`, and manifest Application.Id form the application identity.

ASCII case-insensitive matching is our finite protective policy, not a claim that all Windows identity APIs share that rule. Preview is not included; its evidence and semantics are outside this ticket.

## Exact contract

1. A pure AUMID resolver returns existing token `win.terminal` for the one exact identity, otherwise no match. It accepts only a string and folds ASCII A–Z. It does not trim, coerce objects, Unicode-normalize, decode, split-and-prefix-match, use substrings, or query the OS. Existing `apps.add` trimming stays unchanged; raw resolver whitespace is unmatched. An unknown identity remains unknown, not newly trusted or blanket denied.
2. Windows structural eligibility combines known identities conservatively. Any existing EXE LOLBIN/vault denial remains a denial. The known Terminal AUMID also denies eligibility, with or without an EXE. A normal/unknown alternate identity cannot wash out a protected one. Darwin/native bundle-ID behavior and current unknown-AUMID behavior are unchanged.
3. This is terminal protection, not a browser exception. A stable Terminal AUMID must never receive the vault-browser one-shot classification, including an entry that also carries an EXE browser identity. Existing browser EXE plus unknown/nonmatching AUMID retains current behavior. `allowVaultBrowserOneShot` cannot bypass the terminal denial.
4. `canEverCoordinate` must implement the Windows deny. Actual `apps.set_coordinate_allowed(true)` must reject through the existing structural-deny response before biometric/confirmation or persistence. The post-await current-subject check and all stale-grant protection remain. Already-true/tampered entries do not bypass the structural check. Execution admission must reject even with both coordinate switches set and the browser-one-shot option requested.
5. Configuration normalization must not retain coordinate/UIA hints on this known protected Windows identity; preserve current force-clear semantics and policy ceilings. Reuse the existing policy consumer where sufficient; no new persistent field, global generation, permission, grant, transport, or runtime framework is introduced.
6. Ordinary Apps registration/launch remains as today: AUMID GUI registration, ai ceiling, no new args or process action; CLI entries still reject AUMID. No change to `apps.add` path/AUMID exclusivity. Dual-identity cases cover existing schema/config input, not a new add flow.

## Acceptance matrix (permanent actual-source Node checks)

| Input / boundary | Required outcome |
|---|---|
| exact stable, lower/upper/mixed ASCII case | `win.terminal`; coordinate structurally denied |
| absent/non-string/empty, prefix/suffix, wrong PFN or publisher, wrong AppId, whitespace, Unicode lookalike, Preview | no new mapping; old policy behavior preserved |
| stable AUMID + ordinary EXE | denied |
| stable AUMID + browser EXE | denied; not browser one-shot eligible |
| unknown AUMID + existing protected EXE | original denial; browser EXE exception only as originally permitted |
| unknown AUMID-only / ordinary EXE | unchanged; no new blanket denial or grant |
| actual coordinate grant handler on stable identity | existing structural error, zero gate/confirmation/persist/input effects |
| already-true stable identity / invalidated subject while handler awaits | no stale grant revival; original owner guards intact |
| execution with stored bits true and one-shot option | terminal refused before action effects |
| normalization on actual Windows policy | coordinate false and UIA hints cleared; unrelated metadata/policy not rewritten |

First preserve an actual old-source RED at handler/admission, then the same producers GREEN. A standalone table unit test does not satisfy this ticket. Use a scoped Windows-platform seam around actual production functions for cross-platform inert Node controls; no global/live platform or configuration mutation.

## Bounds, risk and non-goals

T3 because identity affects persistent coordinate grant admission, although behavior only tightens refusal for one officially established identity. No numeric budget, timeout, retry, skip, concurrency, L2/Hello class, trust registry/default, or canonical-list change. No new error code is necessary. No native, GUI, browser, enterprise identity, installation, or live-config operation is authorized here.

No Preview/Canary/all-UWP map, CLI track enablement, argument templates, gallery, drift workflow, launch/enumeration expansion, Terminal browser exemption, or whole #70 closure. Do not call inert acceptance physical Hello or real Windows app operation.

## Delivery gates

Contract approval precedes coding. Freeze the smallest production/test paths; actual focused RED→GREEN, relevant families/TSC/build, one locked fresh ARM group, genuine nonauthor review, complete configured judge gates, then precise new-head CI and precise main CI. Reuse unchanged gates honestly. Final PR may close #683 and only reference #70 after its own DoD passes; root performs final merge/acceptance.
