# Dual external review — Dictation+ D1a

**Batch**: `dictation-plus-d1a`  
**Branch**: `feat/dictation-plus-d1a`  
**Blast tier**: **T2** (L0 input surface expansion; new continuous residual + privacy ack v3)  
**Machine**: chrome-extension `npm test` — 545 pass (2026-08-07)

## Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        mic + browser STT residual (longer if continuous) +
              voice_privacy_ack_v3 gate; no auto-send; no tools from voice
Channel:      community
```

## What shipped (scope)

### Design (SoT lock)

- `docs/superpowers/specs/2026-08-07-dictation-plus-design.md`
- `docs/superpowers/specs/2026-08-07-meeting-minutes-design.md` (design only, no meeting code)
- `docs/adr/024-dictation-plus-asr-refiner-meeting.md`
- R1/R2 adversary syntheses + D1 plan/workflow

### Implementation D1a only

- `voiceDictationMode`: `classic` | `continuous` (default **classic**)
- Browser continuous: **adapter-local onend restart** + `listenGen`
- Caps: soft **5 min** hint (non-stop); hard default **15 min**
- Local engine: still **45s** (D1c later)
- Privacy **ack v3** required before continuous browser start
- Settings radio + App mic timer for continuous
- Tests: restart classic vs continuous; continuous-timeout banner; soft cap

### Explicitly **out** of this PR

- ASR Refiner (D1b)
- Local segmented continuous (D1c)
- Hold hotkey / global HUD (D2)
- Meeting capture (Mtg1)
- auto-send, 书面化, system inject, default Fn

## SoT floors to verify

From Dictation+ SoT + ADR-024 / R1+R2:

1. Default remains classic M1 (45s, no restart)
2. Continuous is opt-in; hard cap default 15m
3. No auto-send
4. ENGINE_END not spuriously fired on continuous mid-session restart
5. Pack still cannot write voice prefs (no Pack surface in this PR — note residual)
6. No system-wide inject
7. Identity: composer draft only / not system dictation

## Reviewer instructions

1. Read the attached git diff vs base `main` merge-base.
2. Check **spec compliance** (SoT D1a scope only — do not demand D1b/D2).
3. Check **Trust**: continuous cloud STT residual disclosed via v3; classic path unchanged.
4. Flag security bugs, dual-mode regression risks, SM races.
5. End with exactly one line:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`

Nits must be non-blocking. REJECT requires concrete fix list.

## Eval gate

- [x] Machine: extension unit tests green  
- [ ] Dual Claude + Pi  
- [ ] Nits absorbed if APPROVE_WITH_NITS  
