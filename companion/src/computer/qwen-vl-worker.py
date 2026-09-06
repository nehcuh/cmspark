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
Coordinates are image-space pixels (mapped from Qwen3-VL relative [0,1000] —
L-QW-3 revised 2026-09-07, #423).
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


def _num(v: Any) -> Optional[float]:
    """Accept int/float (not bool); first element of a list; numeric strings."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, list) and v:
        return _num(v[0])
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _point_from_json_obj(obj: Any) -> Optional[Tuple[float, float]]:
    """Extract (x, y) in model space from a decoded JSON object.

    #423 array-form adjudication (grok empirical lane, 2026-09-07): complex GUI
    prompts make the model emit {"x": [x, y], "y": [y]} — the point lives in the
    x array; the y field is a redundant (occasionally stale) copy. d9 proved
    y[0] can be wrong while x[1] is right, so x-array-len>=2 wins over y.
    """
    if not isinstance(obj, dict):
        return None
    x, y = obj.get("x"), obj.get("y")
    if isinstance(x, list) and len(x) >= 2:
        a, b = _num(x[0]), _num(x[1])
        if a is not None and b is not None:
            return a, b
    a, b = _num(x), _num(y)
    if a is not None and b is not None:
        return a, b
    return None


def _parse_point(text: str, width: int, height: int) -> Optional[Tuple[int, int]]:
    """Extract click point from model text.

    Supports JSON objects (scalar or #423 array form), (x,y), and UI-TARS-like
    Action DSL (point=/start_box=). Model output space is Qwen3-VL relative
    [0,1000] of the original image — mapped to pixels in _normalize
    (L-QW-3 revised, #423). Keep in lockstep with
    companion/src/computer/gui-action-parse.ts.
    """
    if not text:
        return None
    # JSON object — decode properly so array forms ({"x":[a,b],"y":[c]}) keep
    # their semantics instead of being grazed by the bracket regex.
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(text[start : end + 1])
        except Exception:
            obj = None
        pt = _point_from_json_obj(obj)
        if pt is not None:
            return _normalize(pt[0], pt[1], width, height)
    # JSON-ish object with x/y (regex fallback for malformed JSON)
    m = re.search(
        r'\{\s*"?x"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"?y"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)',
        text,
        re.I,
    )
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    # UI-TARS-like: point='x y' / start_box='(x,y)' / start_box='(x1,y1,x2,y2)'
    # Separators may be spaces and/or commas.
    m = re.search(
        r"(?:start_box|end_box|point|start_point|end_point)\s*=\s*['\"]?\(?\s*"
        r"([0-9]+(?:\.[0-9]+)?)\s*[, ]\s*([0-9]+(?:\.[0-9]+)?)"
        r"(?:\s*[, ]\s*([0-9]+(?:\.[0-9]+)?)\s*[, ]\s*([0-9]+(?:\.[0-9]+)?))?\)?['\"]?",
        text,
        re.I,
    )
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if m.group(3) is not None and m.group(4) is not None:
            c, d = float(m.group(3)), float(m.group(4))
            return _normalize((a + c) / 2.0, (b + d) / 2.0, width, height)
        return _normalize(a, b, width, height)
    # bracket form [x, y] or (x, y)
    m = re.search(r"[\[\(]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*[\]\)]", text)
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    # bare "x, y" near click/point/坐标
    m = re.search(
        r"(?:click|point|坐标|位置)[^\d]{0,12}([0-9]+(?:\.[0-9]+)?)\s*[,，]\s*([0-9]+(?:\.[0-9]+)?)",
        text,
        re.I,
    )
    if m:
        x, y = float(m.group(1)), float(m.group(2))
        return _normalize(x, y, width, height)
    return None


def _normalize(x: float, y: float, width: int, height: int) -> Tuple[int, int]:
    """Map Qwen3-VL relative [0,1000] coords to image pixels, then clamp.

    L-QW-3 revised 2026-09-07 (#423, adversarial consensus grok/pi/claude):
    Qwen3-VL ALWAYS speaks relative [0,1000] of the original image (official
    cookbook + local probe: mean err 11.9px under always-map vs 364px under
    absolute-pixel assumption). The old clamp-only ruling rested on the wrong
    premise that the model emits absolute pixels. Keep the final clamp as a
    safety net for out-of-range values (>1000 / negative).
    """
    if width <= 0 or height <= 0:
        return 0, 0
    px = int(round(float(x) / 1000.0 * width))
    py = int(round(float(y) / 1000.0 * height))
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
