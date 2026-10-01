#!/usr/bin/env bash
# computer-bg-oracles.sh — oracles that make the word "background" mean something (#571).
#
# macOS counterpart of companion/src/host-use/win/scripts/computer-bg-oracles.ps1. Same idea,
# same vocabulary, same fail-closed discipline: the capability ledger refuses to record a
# target as background-`Delivered` until these pass.
#
# WHY: cuInject's own comment reads "Always activate before inject" — the existing delivery
# path raises the target to the front. cuAXInvoke delivers through an AX action and never
# touches the frontmost app — but "never touches it" must be PROVEN, not asserted.
#
# OBSERVED ORACLES (measured, not inferred)
#   focus_kept   — the frontmost window is the same before and after.
#   zorder_kept  — the on-screen window order (front-first) is unchanged.
#   cursor_kept  — the pointer did not move.
#
# DERIVED ORACLE (honest about what it is)
#   no_leaked_input — NOT measured directly. Inferred from focus_kept AND cursor_kept AND the
#     caller declaring an AX-action delivery. Rationale: CGEvent injection targets whatever is
#     frontmost and a pointer move is the cheapest way to leak; an AX action addresses an
#     element and needs neither. A strong proxy, NOT a proof — recorded as `derived`.
#
# FAIL-CLOSED: if a reading is unavailable (host binary missing, window-list fails, cursor-get
# refuses) the corresponding oracle is `null` and `background_verified` is **false**. An
# unmeasurable state is never rounded up to a pass.
#
# JSON is handled with `node`, not python3: node is guaranteed present (the companion runs on
# it, and the Windows installer even ships node.exe), whereas python3 is only incidentally
# present. A verification tool must not depend on something that might not be there.
#
# Usage:
#   computer-bg-oracles.sh snapshot -out FILE [--host-bin PATH]
#   computer-bg-oracles.sh compare  -before A -after B -out FILE
#                                   [--target-hwnd N] [--delivery ax-action|sendinput]
#
# stdout: nothing (results go to -out, mirroring the .ps1)
# exit:   0 ok · 2 BADARGS · 3 ORACLE_READ_FAILED · 4 ORACLE_UNREADABLE_SNAPSHOT
set -euo pipefail

MODE=""
OUT=""
BEFORE=""
AFTER=""
TARGET_HWND=0
DELIVERY="ax-action"
HOST_BIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    snapshot) MODE="snapshot"; shift ;;
    compare)  MODE="compare"; shift ;;
    -out)          OUT="${2:-}"; shift 2 ;;
    -before)       BEFORE="${2:-}"; shift 2 ;;
    -after)        AFTER="${2:-}"; shift 2 ;;
    --target-hwnd) TARGET_HWND="${2:-0}"; shift 2 ;;
    --delivery)    DELIVERY="${2:-ax-action}"; shift 2 ;;
    --host-bin)    HOST_BIN="${2:-}"; shift 2 ;;
    *) echo "BADARGS: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

fail() { echo "$1:$2" >&2; exit "$3"; }

[ -n "$MODE" ] || fail "BADARGS" "mode must be 'snapshot' or 'compare'" 2
[ -n "$OUT" ] || fail "BADARGS" "-out is required" 2
case "$DELIVERY" in ax-action|sendinput) ;; *) fail "BADARGS" "--delivery must be ax-action or sendinput" 2 ;; esac
if [ "$MODE" = "compare" ]; then
  [ -n "$BEFORE" ] && [ -n "$AFTER" ] || fail "BADARGS" "compare requires -before and -after" 2
fi

command -v node >/dev/null 2>&1 || fail "ORACLE_READ_FAILED" "node not found on PATH" 3

# Resolve the host binary: explicit flag → PATH → the repo build locations.
if [ -z "$HOST_BIN" ]; then
  if command -v cmspark-host >/dev/null 2>&1; then
    HOST_BIN="$(command -v cmspark-host)"
  else
    here="$(cd "$(dirname "$0")" && pwd)"
    for c in "$here/../companion/src/host-use/darwin/build/cmspark-host" \
             "$here/../companion/dist/host-use/darwin/cmspark-host" \
             "$here/../companion/build/cmspark-host"; do
      if [ -x "$c" ]; then HOST_BIN="$c"; break; fi
    done
  fi
fi

read_foreground_id() {
  # `window-list --foreground` returns on-screen windows in CGWindowListCopyWindowInfo order,
  # which is front-to-back, so entry 0 is the frontmost window.
  [ -n "$HOST_BIN" ] || return 1
  "$HOST_BIN" window-list --foreground 2>/dev/null || return 1
}

read_cursor() {
  [ -n "$HOST_BIN" ] || return 1
  "$HOST_BIN" cursor-get 2>/dev/null || return 1
}

# --- node helpers -----------------------------------------------------------
# Kept as separate files so their logic can be exercised without a Mac (see the shell tests).

snapshot_js() {
  cat <<'JSEOF'
let wlRaw = "", curRaw = ""
try { wlRaw = require("node:fs").readFileSync(process.env.ORACLE_WL, "utf8") } catch {}
try { curRaw = require("node:fs").readFileSync(process.env.ORACLE_CUR, "utf8") } catch {}
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const wl = parse(wlRaw), cur = parse(curRaw)

const zorder = []
if (wl && wl.ok === true && Array.isArray(wl.windows)) {
  for (const w of wl.windows) if (typeof w.windowId === "number") zorder.push(w.windowId)
}
const foreground = zorder.length > 0 ? zorder[0] : null

let cursor = null
if (cur && cur.ok === true && typeof cur.x === "number" && typeof cur.y === "number") {
  cursor = { x: Math.trunc(cur.x), y: Math.trunc(cur.y) }
}

require("node:fs").writeFileSync(process.env.ORACLE_OUT, JSON.stringify({
  ts: new Date().toISOString(), foreground, zorder, cursor,
}))
JSEOF
}

compare_js() {
  cat <<'JSEOF'
const fs = require("node:fs")
const load = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (e) {
  process.stderr.write(`ORACLE_UNREADABLE_SNAPSHOT:${p} (${e.message})\n`); process.exit(4) } }

const b = load(process.env.ORACLE_BEFORE)
const a = load(process.env.ORACLE_AFTER)
if (!("foreground" in b) || !("foreground" in a)) {
  process.stderr.write("ORACLE_UNREADABLE_SNAPSHOT:missing 'foreground'\n"); process.exit(4)
}

// null on either side means "could not read" -> fail closed, never "kept".
const focusKept = (b.foreground === null || a.foreground === null) ? null : b.foreground === a.foreground

const bz = Array.isArray(b.zorder) ? b.zorder : []
const az = Array.isArray(a.zorder) ? a.zorder : []
let zorderKept = null, zDiffAt = -1
if (bz.length > 0 && az.length > 0) {
  const n = Math.min(bz.length, az.length)
  for (let i = 0; i < n; i++) if (bz[i] !== az[i]) { zDiffAt = i; break }
  zorderKept = zDiffAt < 0
}

const bc = b.cursor, ac = a.cursor
const cursorKept = (!bc || !ac) ? null : (bc.x === ac.x && bc.y === ac.y)

const delivery = process.env.ORACLE_DELIVERY || "ax-action"
// Derived, and stated as derived: any null reading propagates to false — an unmeasurable
// oracle cannot pass. `sendinput` must never claim background even if nothing moved.
const leakOk = focusKept === true && cursorKept === true && delivery === "ax-action"

fs.writeFileSync(process.env.ORACLE_OUT, JSON.stringify({
  ok: true,
  delivery,
  target_hwnd: Number(process.env.ORACLE_TARGET || 0),
  focus_kept: focusKept,
  zorder_kept: zorderKept,
  cursor_kept: cursorKept,
  no_leaked_input: leakOk,
  no_leaked_input_kind: "derived",
  background_verified: focusKept === true && zorderKept === true && cursorKept === true && leakOk,
  before: { foreground: b.foreground, cursor: bc ?? null },
  after: { foreground: a.foreground, cursor: ac ?? null },
  zorder_diff_at: zDiffAt,
}))
JSEOF
}

cmd_snapshot() {
  # A snapshot is written even when readings fail: it records null so the comparison can say
  # "could not verify" instead of silently comparing nothing.
  wl_tmp="$(mktemp)"; cur_tmp="$(mktemp)"
  read_foreground_id > "$wl_tmp" 2>/dev/null || true
  read_cursor > "$cur_tmp" 2>/dev/null || true
  ORACLE_WL="$wl_tmp" ORACLE_CUR="$cur_tmp" ORACLE_OUT="$OUT" \
    node -e "$(snapshot_js)"
  rm -f "$wl_tmp" "$cur_tmp" 2>/dev/null || true
  [ -s "$OUT" ] || fail "ORACLE_READ_FAILED" "snapshot was not written to $OUT" 3
  exit 0
}

cmd_compare() {
  ORACLE_BEFORE="$BEFORE" ORACLE_AFTER="$AFTER" ORACLE_OUT="$OUT" \
    ORACLE_TARGET="$TARGET_HWND" ORACLE_DELIVERY="$DELIVERY" node -e "$(compare_js)"
  [ -s "$OUT" ] || fail "ORACLE_READ_FAILED" "verdict was not written to $OUT" 3
  exit 0
}

case "$MODE" in
  snapshot) cmd_snapshot ;;
  compare)  cmd_compare ;;
esac
