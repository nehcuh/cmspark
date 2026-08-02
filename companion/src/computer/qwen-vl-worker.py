#!/usr/bin/env python3
"""
Qwen3-VL experimental locate worker for CMspark Companion.

Line protocol (JSON per line, UTF-8):
  stdin  → {"id": str, "cmd": "load"|"infer"|"ping"|"shutdown", ...}
  stdout → {"id": str, "ok": bool, ...}

load:  {"id","cmd":"load","model_dir": str, "device": "auto"|"cpu"|"cuda"|"mps"}
infer: {"id","cmd":"infer","image_path": str, "command": str, "width": int, "height": int}
ping:  {"id","cmd":"ping"}
shutdown: {"id","cmd":"shutdown"}

Infer success: {"id","ok":true,"x":int,"y":int,"raw":str}
Coordinates are image-space pixels (same convention as former TinyClick layer).
"""

from __future__ import annotations

import json
import re
import sys
import traceback
from typing import Any, Optional, Tuple

# Lazy imports after load — keeps cold start light for ping.

_model = None
_processor = None
_device = "cpu"
_model_dir: Optional[str] = None


def _reply(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _parse_point(text: str, width: int, height: int) -> Optional[Tuple[int, int]]:
    """Extract click point from model text. Supports JSON and (x,y) image pixels."""
    if not text:
        return None
    # JSON object with x/y
    m = re.search(
        r'\{\s*"?x"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"?y"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)',
        text,
        re.I,
    )
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    # bracket form [x, y] or (x, y)
    m = re.search(r"[\[\(]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*[\]\)]", text)
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    # bare "x, y" near end
    m = re.search(r"(?:click|point|坐标|位置)[^\d]{0,12}([0-9]+(?:\.[0-9]+)?)\s*[,，]\s*([0-9]+(?:\.[0-9]+)?)", text, re.I)
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    return None


def _normalize(x: float, y: float, width: int, height: int) -> Tuple[int, int]:
    """Clamp to image pixels only (SoT D3 / L-QW-3).

    Never treat in-bounds or 0–1000 values as relative-to-1000 when they already
    fit the image — false scaling on wide screens was a P0 blocker.
    Explicit out-of-bounds coords (>width/height) still clamp, not rescale.
    """
    if width <= 0 or height <= 0:
        return 0, 0
    px = int(round(x))
    py = int(round(y))
    return max(0, min(width - 1, px)), max(0, min(height - 1, py))


def _load(model_dir: str, device: str) -> None:
    global _model, _processor, _device, _model_dir
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText

    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    dtype = torch.float16 if device in ("cuda", "mps") else torch.float32
    processor = AutoProcessor.from_pretrained(model_dir, trust_remote_code=True)
    model = AutoModelForImageTextToText.from_pretrained(
        model_dir,
        torch_dtype=dtype,
        device_map="auto" if device == "cuda" else None,
        trust_remote_code=True,
    )
    if device != "cuda":
        model = model.to(device)
    model.eval()
    _model = model
    _processor = processor
    _device = device
    _model_dir = model_dir


def _infer(image_path: str, command: str, width: int, height: int) -> dict:
    global _model, _processor, _device
    if _model is None or _processor is None:
        return {"ok": False, "error": "model-not-loaded"}

    from PIL import Image
    import torch

    image = Image.open(image_path).convert("RGB")
    w, h = image.size
    if width <= 0:
        width = w
    if height <= 0:
        height = h

    prompt = (
        "You are a GUI grounding assistant. Look at the screenshot and locate the UI element "
        "described by the user command. Reply with ONLY a JSON object of the click point in "
        "image pixel coordinates: {\"x\": <int>, \"y\": <int>}. "
        "Do not include any other text.\n"
        f"User command: {command}"
    )

    # Prefer chat template when available (Qwen3-VL)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    try:
        text = _processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = _processor(text=[text], images=[image], return_tensors="pt", padding=True)
    except Exception:
        inputs = _processor(text=prompt, images=image, return_tensors="pt")

    inputs = {k: v.to(_device) if hasattr(v, "to") else v for k, v in inputs.items()}

    with torch.inference_mode():
        out_ids = _model.generate(**inputs, max_new_tokens=64, do_sample=False)

    # Strip prompt tokens when possible
    try:
        gen = out_ids[:, inputs["input_ids"].shape[1] :]
    except Exception:
        gen = out_ids
    raw = _processor.batch_decode(gen, skip_special_tokens=True)[0].strip()
    pt = _parse_point(raw, width, height)
    if pt is None:
        return {"ok": False, "error": "no-coordinates", "raw": raw[:500]}
    x, y = pt
    return {"ok": True, "x": x, "y": y, "raw": raw[:500]}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as e:
            _reply({"id": "?", "ok": False, "error": f"bad-json:{e}"})
            continue
        mid = msg.get("id", "?")
        cmd = msg.get("cmd")
        try:
            if cmd == "ping":
                _reply({"id": mid, "ok": True, "pong": True, "loaded": _model is not None})
            elif cmd == "load":
                _load(str(msg["model_dir"]), str(msg.get("device") or "auto"))
                _reply({"id": mid, "ok": True, "device": _device, "model_dir": _model_dir})
            elif cmd == "infer":
                r = _infer(
                    str(msg["image_path"]),
                    str(msg.get("command") or ""),
                    int(msg.get("width") or 0),
                    int(msg.get("height") or 0),
                )
                r["id"] = mid
                _reply(r)
            elif cmd == "shutdown":
                _reply({"id": mid, "ok": True})
                break
            else:
                _reply({"id": mid, "ok": False, "error": f"unknown-cmd:{cmd}"})
        except Exception as e:
            _reply(
                {
                    "id": mid,
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc()[-1500:],
                }
            )


if __name__ == "__main__":
    main()
