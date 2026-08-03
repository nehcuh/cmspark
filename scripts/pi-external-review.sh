#!/usr/bin/env bash
# pi-external-review.sh — Pi-only external review for important workflow nodes.
#
# Usage:
#   scripts/pi-external-review.sh <batch-id> <prompt-file> [base-commit]
#
# Outputs:
#   docs/audit/reviews/<batch>-pi-<ts>.md
#   docs/audit/reviews/<batch>-verdict-pi-<ts>.json
#   docs/audit/reviews/<batch>-diff-<ts>.patch  (context only)
#
# Exit: 0 APPROVE|APPROVE_WITH_NITS · 2 REJECT · 3 infra
set -euo pipefail

BATCH="${1:?batch id required}"
PROMPT_FILE="${2:?prompt file required}"
BASE_COMMIT="${3:-HEAD}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/docs/audit/reviews"
mkdir -p "$OUT_DIR"

PI_OUT="$OUT_DIR/${BATCH}-pi-${TS}.md"
VERDICT_JSON="$OUT_DIR/${BATCH}-verdict-pi-${TS}.json"
DIFF_FILE="$OUT_DIR/${BATCH}-diff-${TS}.patch"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "prompt file not found: $PROMPT_FILE" >&2
  exit 3
fi

{
  echo "# Pi external review context"
  echo "batch: $BATCH"
  echo "base: $BASE_COMMIT"
  echo "time: $TS"
  echo
  git rev-parse --short HEAD 2>/dev/null || true
  echo
  git status --short
  echo
  echo "## Diff"
  git diff --stat "$BASE_COMMIT" 2>/dev/null || git diff --stat
  echo
  git diff "$BASE_COMMIT" 2>/dev/null || git diff
  git diff --cached 2>/dev/null || true
} >"$DIFF_FILE"

REVIEW_SYSTEM=$'You are an independent senior code reviewer (Pi). Read the prompt and inspect REAL code with tools.\n\nRules:\n1. Do not rubber-stamp. Use Read/Bash on the repo.\n2. Look for incomplete fixes, security regressions, missing tests, wrong claims.\n3. Final line MUST be exactly one of:\nVERDICT: APPROVE\nVERDICT: APPROVE_WITH_NITS\nVERDICT: REJECT\n4. If REJECT, list blocking issues with file:line BEFORE the VERDICT line.\n5. If APPROVE_WITH_NITS, list nits BEFORE the VERDICT line.\n'

BODY=$(cat "$PROMPT_FILE")
FULL_PROMPT=$(cat <<EOF
$REVIEW_SYSTEM

## Batch
$BATCH

## Review task
$BODY

## Diff path (read with tools)
$DIFF_FILE

Also run git diff / git status yourself if needed.

REMINDER: End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
EOF
)

PROMPT_TMP=$(mktemp)
printf '%s\n' "$FULL_PROMPT" >"$PROMPT_TMP"

PI_BIN="${PI_BIN:-pi}"
if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "pi CLI not found" >&2
  exit 3
fi

echo "[pi-review] launching Pi for $BATCH ..."
set +e
"$PI_BIN" -p --no-session \
  -t read,bash \
  "$(cat "$PROMPT_TMP")" \
  >"$PI_OUT" 2>&1
PI_EC=$?
set -e
rm -f "$PROMPT_TMP"

if [[ ! -s "$PI_OUT" ]]; then
  echo "empty Pi output" >&2
  echo '{"batch":"'"$BATCH"'","pi":{"verdict":"UNKNOWN"},"approve":false}' >"$VERDICT_JSON"
  exit 3
fi

# Heuristic fallback if VERDICT line missing
if ! grep -qE 'VERDICT:[[:space:]]*(APPROVE|APPROVE_WITH_NITS|REJECT)' "$PI_OUT" 2>/dev/null; then
  if grep -qiE 'reject|blocking issue|must fix|not approve' "$PI_OUT" 2>/dev/null; then
    echo "VERDICT: REJECT" >>"$PI_OUT"
  elif grep -qiE 'approve_with_nits|non-blocking nit|nits only' "$PI_OUT" 2>/dev/null; then
    echo "VERDICT: APPROVE_WITH_NITS" >>"$PI_OUT"
  elif grep -qiE '\bapprove\b|lgtm|looks good' "$PI_OUT" 2>/dev/null; then
    echo "VERDICT: APPROVE_WITH_NITS" >>"$PI_OUT"
  fi
fi

extract_verdict() {
  local f="$1"
  local v
  v=$(grep -E 'VERDICT:[[:space:]]*(APPROVE_WITH_NITS|APPROVE|REJECT)' "$f" 2>/dev/null | tail -1 | sed -E 's/.*VERDICT:[[:space:]]*//' | tr -d '\r' || true)
  case "$v" in
    APPROVE|APPROVE_WITH_NITS|REJECT) echo "$v" ;;
    *) echo "UNKNOWN" ;;
  esac
}

PI_V=$(extract_verdict "$PI_OUT")
APPROVE=false
if [[ "$PI_V" == "APPROVE" || "$PI_V" == "APPROVE_WITH_NITS" ]]; then
  APPROVE=true
fi

cat >"$VERDICT_JSON" <<EOF
{
  "batch": "$BATCH",
  "timestamp": "$TS",
  "pi": { "verdict": "$PI_V", "exit_code": $PI_EC, "path": "$PI_OUT" },
  "approve": $APPROVE,
  "diff_path": "$DIFF_FILE"
}
EOF

echo "[pi-review] pi=$PI_V approve=$APPROVE → $VERDICT_JSON"
echo "[pi-review] review → $PI_OUT"

if [[ "$APPROVE" == "true" ]]; then
  exit 0
fi
if [[ "$PI_V" == "UNKNOWN" ]]; then
  exit 3
fi
exit 2
