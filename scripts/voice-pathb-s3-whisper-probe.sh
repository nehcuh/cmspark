#!/usr/bin/env bash
# Path B Spike S3 — whisper.cpp CPU probe (synthetic WAV, no Companion).
# Usage: bash scripts/voice-pathb-s3-whisper-probe.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${CMSPARK_SPIKE_WHISPER_DIR:-$HOME/.cmspark-agent/spike/whisper}"
mkdir -p "$CACHE"
OUT_JSON="${1:-$ROOT/docs/audit/reviews/voice-pathb-s3-whisper-probe.json}"
mkdir -p "$(dirname "$OUT_JSON")"

log() { echo "[pathb-s3] $*" >&2; }

HAVE_FFMPEG=0
command -v ffmpeg >/dev/null 2>&1 && HAVE_FFMPEG=1

WHISPER_BIN=""
if command -v whisper-cli >/dev/null 2>&1; then
  WHISPER_BIN="$(command -v whisper-cli)"
elif [[ -x /opt/homebrew/bin/whisper-cli ]]; then
  WHISPER_BIN=/opt/homebrew/bin/whisper-cli
elif command -v brew >/dev/null 2>&1 && brew list whisper-cpp &>/dev/null; then
  WHISPER_BIN="$(brew --prefix whisper-cpp)/bin/whisper-cli"
fi

if [[ -z "$WHISPER_BIN" || ! -x "$WHISPER_BIN" ]]; then
  if command -v brew >/dev/null 2>&1; then
    log "whisper-cli not found; brew install whisper-cpp"
    brew install whisper-cpp
    WHISPER_BIN="$(brew --prefix whisper-cpp)/bin/whisper-cli"
  fi
fi

MODEL_DIR="$CACHE/models"
mkdir -p "$MODEL_DIR"
MODEL_GGML="$MODEL_DIR/ggml-tiny.bin"
if [[ ! -f "$MODEL_GGML" ]]; then
  log "downloading ggml-tiny.bin for spike (not production catalog)"
  curl -fsSL -o "$MODEL_GGML.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
  mv "$MODEL_GGML.part" "$MODEL_GGML"
fi

WAV="$CACHE/spike-1s-440hz.wav"
if [[ "$HAVE_FFMPEG" -eq 1 ]]; then
  ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1" -ar 16000 -ac 1 -c:a pcm_s16le "$WAV" >/dev/null 2>&1
else
  node -e '
    const fs=require("fs");
    const sr=16000, n=sr, data=Buffer.alloc(n*2);
    const hdr=Buffer.alloc(44);
    hdr.write("RIFF",0); hdr.writeUInt32LE(36+data.length,4); hdr.write("WAVE",8);
    hdr.write("fmt ",12); hdr.writeUInt32LE(16,16); hdr.writeUInt16LE(1,20);
    hdr.writeUInt16LE(1,22); hdr.writeUInt32LE(sr,24); hdr.writeUInt32LE(sr*2,28);
    hdr.writeUInt16LE(2,32); hdr.writeUInt16LE(16,34); hdr.write("data",36);
    hdr.writeUInt32LE(data.length,40);
    fs.writeFileSync(process.argv[1], Buffer.concat([hdr,data]));
  ' "$WAV"
fi

STATUS="fail"
MSG=""
TRANSCRIPT=""
MS=0
if [[ -z "${WHISPER_BIN:-}" || ! -x "$WHISPER_BIN" ]]; then
  STATUS="skip"
  MSG="whisper CLI not found (install: brew install whisper-cpp)"
else
  log "using $WHISPER_BIN"
  START_MS=$(node -e 'console.log(Date.now())')
  set +e
  OUT=$("$WHISPER_BIN" -m "$MODEL_GGML" -f "$WAV" -l en -nt 2>&1)
  EC=$?
  set -e
  END_MS=$(node -e 'console.log(Date.now())')
  MS=$((END_MS - START_MS))
  TRANSCRIPT=$(printf '%s' "$OUT" | tail -c 2000)
  if [[ $EC -eq 0 ]]; then
    STATUS="pass"
    MSG="whisper ran exit 0 in ${MS}ms (synthetic sine; transcript may be empty/noise)"
  else
    STATUS="fail"
    MSG="whisper exit $EC: $(printf '%s' "$OUT" | tail -c 400)"
  fi
fi

export PATHB_S3_STATUS="$STATUS"
export PATHB_S3_MSG="$MSG"
export PATHB_S3_BIN="$WHISPER_BIN"
export PATHB_S3_MODEL="$MODEL_GGML"
export PATHB_S3_WAV="$WAV"
export PATHB_S3_MS="$MS"
export PATHB_S3_TX="$TRANSCRIPT"

node -e '
  const fs=require("fs");
  const o={
    spike:"pathb-s3-whisper-cpu",
    time:new Date().toISOString(),
    platform:process.platform,
    arch:process.arch,
    status:process.env.PATHB_S3_STATUS,
    message:process.env.PATHB_S3_MSG,
    whisperBin:process.env.PATHB_S3_BIN||null,
    model:process.env.PATHB_S3_MODEL||null,
    wav:process.env.PATHB_S3_WAV||null,
    wallMs:Number(process.env.PATHB_S3_MS||0),
    transcriptTail:process.env.PATHB_S3_TX||"",
    note:"tiny model for machine gate only; production catalog is small|medium|large-v3-turbo"
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(o,null,2));
  console.log(JSON.stringify(o,null,2));
' "$OUT_JSON"

if [[ "$STATUS" == "pass" ]]; then
  log "PASS → $OUT_JSON"
  exit 0
elif [[ "$STATUS" == "skip" ]]; then
  log "SKIP → $OUT_JSON ($MSG)"
  exit 0
else
  log "FAIL → $OUT_JSON ($MSG)"
  exit 1
fi
