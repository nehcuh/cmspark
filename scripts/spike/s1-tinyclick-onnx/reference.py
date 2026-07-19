# WP5 spike S-1: TinyClick PyTorch reference inference (greedy + beam-3).
# Produces reference.json used as ground truth for the ONNX parity check.
import json, os, re, sys
import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")
IMAGE = os.path.join(os.path.dirname(__file__), "test_image.png")
COMMAND = "click on the ok button"

def postprocess(text, image_size):
    """Official postprocess from SamsungLabs/TinyClick tinyclick_utils.py."""
    pattern = r"</s><s>(<[^>]+>|[^<\s]+)\s*([^<]*?)(<loc_\d+>.*)"
    point_pattern = r"<loc_(\d+)><loc_(\d+)>"
    match = re.search(pattern, text)
    if not match or (action := match.group(1)) != "click":
        return {"action": None, "click_point": (0, 0)}
    result = {"action": action}
    try:
        location = re.findall(point_pattern, text)[0]
        point = [int(loc) for loc in location]
        result["click_point"] = (
            int((point[0] / 1000) * image_size[0]),
            int((point[1] / 1000) * image_size[1]),
        )
        result["loc_raw"] = point
    except Exception:
        result["click_point"] = (0, 0)
    return result

def main():
    img = Image.open(IMAGE).convert("RGB")
    image_size = img.size
    input_text = ("What to do to execute the command? " + COMMAND.strip()).lower()
    print("input_text:", input_text)

    processor = AutoProcessor.from_pretrained(MODEL_DIR, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL_DIR, trust_remote_code=True).eval()

    inputs = processor(images=img, text=input_text, return_tensors="pt", do_resize=True)
    print("pixel_values:", tuple(inputs["pixel_values"].shape), "input_ids:", tuple(inputs["input_ids"].shape))

    out = {}
    for name, gen_kwargs in {
        "greedy": dict(num_beams=1, do_sample=False, max_new_tokens=50),
        "beam3": dict(num_beams=3, no_repeat_ngram_size=3, early_stopping=True, max_new_tokens=50),
    }.items():
        with torch.inference_mode():
            ids = model.generate(**inputs, **gen_kwargs)
        text = processor.batch_decode(ids, skip_special_tokens=False)[0]
        rec = postprocess(text, image_size)
        print(f"[{name}] text: {text}")
        print(f"[{name}] parsed: {rec}")
        out[name] = {
            "token_ids": ids[0].tolist(),
            "text": text,
            "action": rec.get("action"),
            "click_point": list(rec["click_point"]),
            "loc_raw": rec.get("loc_raw"),
        }

    out["meta"] = {
        "image": os.path.basename(IMAGE),
        "image_size": list(image_size),
        "command": COMMAND,
        "input_text": input_text,
        "model_dir": "Krystianz/TinyClick (local snapshot)",
        "torch": torch.__version__,
    }
    with open(os.path.join(os.path.dirname(__file__), "reference.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("saved reference.json")

if __name__ == "__main__":
    main()
