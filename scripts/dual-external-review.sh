#!/usr/bin/env bash
# dual-external-review.sh — AFTER internal adversarial verification, launch
# Claude Code and Pi Agent as TWO SEPARATE processes for independent re-review.
#
# Usage:
#   scripts/dual-external-review.sh <batch-id> <prompt-file> [base-commit]
#
# Outputs (always written):
#   docs/audit/reviews/<batch>-claude-<ts>.md
#   docs/audit/reviews/<batch>-pi-<ts>.md
#   docs/audit/reviews/<batch>-verdict-<ts>.json
#
# Exit codes:
#   0  both APPROVE (or APPROVE_WITH_NITS)
#   2  at least one REJECT / BLOCK
#   3  infra failure (CLI missing / empty output)
set -euo pipefail

BATCH="${1:?batch id required (e.g. P0-A)}"
PROMPT_FILE="${2:?prompt file required}"
BASE_COMMIT="${3:-HEAD}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/docs/audit/reviews"
mkdir -p "$OUT_DIR"

CLAUDE_OUT="$OUT_DIR/${BATCH}-claude-${TS}.md"
PI_OUT="$OUT_DIR/${BATCH}-pi-${TS}.md"
VERDICT_JSON="$OUT_DIR/${BATCH}-verdict-${TS}.json"
DIFF_FILE="$OUT_DIR/${BATCH}-diff-${TS}.patch"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "prompt file not found: $PROMPT_FILE" >&2
  exit 3
fi

# Capture working tree diff for reviewers (uncommitted + vs base if provided)
{
  echo "# Dual external review context"
  echo "batch: $BATCH"
  echo "base: $BASE_COMMIT"
  echo "time: $TS"
  echo
  git rev-parse --short HEAD 2>/dev/null || true
  echo
  git status --short
  echo
  echo "## Diff (git diff + staged)"
  git diff --stat "$BASE_COMMIT" 2>/dev/null || git diff --stat
  echo
  git diff "$BASE_COMMIT" 2>/dev/null || git diff
  git diff --cached 2>/dev/null || true
} >"$DIFF_FILE"

REVIEW_SYSTEM=$'You are an independent senior code reviewer. Read the prompt file and the attached git diff.\n\nRules:\n1. Inspect real code/diff — do not rubber-stamp. Use Read/Bash tools on the repo.\n2. Look for: incomplete fixes, security regressions, missing tests, wrong file:line, over-claiming.\n3. Apply ADR-020 capability checks (Surface / Composition / Autonomy; Pack-first; no bare \"中层 Agent\"; trust monotonicity; originWs on new confirms). Checklist path: docs/audit/reviews/_templates/dual-review-capability-checklist.md\n4. Your FINAL response line MUST be EXACTLY one of these three strings (nothing after it):\nVERDICT: APPROVE\nVERDICT: APPROVE_WITH_NITS\nVERDICT: REJECT\n5. If REJECT, list concrete blocking issues with file:line BEFORE the VERDICT line.\n6. If APPROVE_WITH_NITS, list non-blocking nits only BEFORE the VERDICT line.\n7. Do not put the verdict only in a plan file — print it in the main stdout response.\n'

CAPABILITY_CHECKLIST="$ROOT/docs/audit/reviews/_templates/dual-review-capability-checklist.md"
CAPABILITY_SECTION=""
if [[ -f "$CAPABILITY_CHECKLIST" ]]; then
  CAPABILITY_SECTION=$(cat <<EOF

## ADR-020 capability checklist (mandatory for product/security diffs)

Read and apply: $CAPABILITY_CHECKLIST

If the implementer prompt lacks a Surface/Compose/Autonomy/Trust/Channel declaration and the diff is not pure docs/test/refactor, call it out (blocking when tools/gates/primary UI are added).
EOF
)
fi

# Build per-agent prompt body
BODY=$(cat "$PROMPT_FILE")
FULL_PROMPT=$(cat <<EOF
$REVIEW_SYSTEM

## Batch
$BATCH

## Review task (from implementer / adversarial stage)
$BODY
$CAPABILITY_SECTION

## Current git diff file path (read it with tools)
$DIFF_FILE

Also run: git diff and git status yourself if tools allow, to confirm the patch file is not stale.

REMINDER: End your entire answer with a single line that is exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
EOF
)

PROMPT_TMP=$(mktemp)
printf '%s\n' "$FULL_PROMPT" >"$PROMPT_TMP"

echo "[dual-review] launching Claude Code (separate process) for $BATCH ..."
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "claude CLI not found" >&2
  exit 3
fi

# Separate process #1: Claude Code
# Note: --permission-mode plan often swallows the final VERDICT line into a plan
# artifact; use acceptEdits + read tools so the printed response contains VERDICT.
set +e
"$CLAUDE_BIN" -p "$(cat "$PROMPT_TMP")" \
  --output-format text \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Bash" \
  >"$CLAUDE_OUT" 2>&1
CLAUDE_EC=$?
set -e
# Ensure file exists even if CLI produced nothing
: >"$CLAUDE_OUT.tmp"
if [[ -s "$CLAUDE_OUT" ]]; then
  cat "$CLAUDE_OUT" >"$CLAUDE_OUT.tmp"
fi
# If Claude forgot the machine line but clearly approved in prose, append a
# conservative mapping only when REJECT is absent (fail closed on ambiguity).
if ! grep -qE 'VERDICT:[[:space:]]*(APPROVE|APPROVE_WITH_NITS|REJECT)' "$CLAUDE_OUT.tmp" 2>/dev/null; then
  if grep -qiE 'reject|blocking issue|must fix|not approve' "$CLAUDE_OUT.tmp" 2>/dev/null; then
    echo "VERDICT: REJECT" >>"$CLAUDE_OUT.tmp"
  elif grep -qiE 'approve_with_nits|non-blocking nit|nits only|approve with nits' "$CLAUDE_OUT.tmp" 2>/dev/null; then
    echo "VERDICT: APPROVE_WITH_NITS" >>"$CLAUDE_OUT.tmp"
  elif grep -qiE '\bapprove\b|fixes? (are|look) sound|lgtm|looks good' "$CLAUDE_OUT.tmp" 2>/dev/null; then
    echo "VERDICT: APPROVE_WITH_NITS" >>"$CLAUDE_OUT.tmp"
  fi
fi
mv "$CLAUDE_OUT.tmp" "$CLAUDE_OUT"
echo "[dual-review] Claude exit=$CLAUDE_EC → $CLAUDE_OUT"

echo "[dual-review] launching Pi Agent (separate process) for $BATCH ..."
PI_BIN="${PI_BIN:-pi}"
if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "pi CLI not found" >&2
  exit 3
fi

# Separate process #2: Pi Agent (read + bash only; no edit/write)
set +e
"$PI_BIN" -p --no-session \
  -t read,bash \
  "$(cat "$PROMPT_TMP")" \
  >"$PI_OUT" 2>&1
PI_EC=$?
set -e
echo "[dual-review] Pi exit=$PI_EC → $PI_OUT"

rm -f "$PROMPT_TMP"

extract_verdict() {
  local f="$1"
  # Last VERDICT: line wins
  local v
  v=$(grep -E 'VERDICT:[[:space:]]*(APPROVE_WITH_NITS|APPROVE|REJECT)' "$f" 2>/dev/null | tail -1 | sed -E 's/.*VERDICT:[[:space:]]*//' | tr -d '\r' || true)
  # Normalize
  case "$v" in
    APPROVE|APPROVE_WITH_NITS|REJECT) echo "$v" ;;
    *)
      if grep -qiE 'VERDICT:[[:space:]]*REJECT' "$f" 2>/dev/null; then echo "REJECT"
      elif grep -qiE 'VERDICT:[[:space:]]*APPROVE_WITH_NITS' "$f" 2>/dev/null; then echo "APPROVE_WITH_NITS"
      elif grep -qiE 'VERDICT:[[:space:]]*APPROVE' "$f" 2>/dev/null; then echo "APPROVE"
      else echo "UNKNOWN"
      fi
      ;;
  esac
}

CLAUDE_V=$(extract_verdict "$CLAUDE_OUT")
PI_V=$(extract_verdict "$PI_OUT")

# Empty outputs → infra failure
if [[ ! -s "$CLAUDE_OUT" || ! -s "$PI_OUT" ]]; then
  CLAUDE_V="UNKNOWN"
  PI_V="UNKNOWN"
fi

pass_one() {
  case "$1" in
    APPROVE|APPROVE_WITH_NITS) return 0 ;;
    *) return 1 ;;
  esac
}

BOTH_OK=false
if pass_one "$CLAUDE_V" && pass_one "$PI_V"; then
  BOTH_OK=true
fi

cat >"$VERDICT_JSON" <<EOF
{
  "batch": "$BATCH",
  "timestamp": "$TS",
  "claude": { "verdict": "$CLAUDE_V", "exit_code": $CLAUDE_EC, "path": "$CLAUDE_OUT" },
  "pi": { "verdict": "$PI_V", "exit_code": $PI_EC, "path": "$PI_OUT" },
  "both_approve": $BOTH_OK,
  "diff_path": "$DIFF_FILE"
}
EOF

echo "[dual-review] claude=$CLAUDE_V pi=$PI_V both_ok=$BOTH_OK"
echo "[dual-review] verdict → $VERDICT_JSON"

if [[ "$BOTH_OK" == "true" ]]; then
  exit 0
fi
if [[ "$CLAUDE_V" == "UNKNOWN" || "$PI_V" == "UNKNOWN" ]]; then
  exit 3
fi
exit 2
