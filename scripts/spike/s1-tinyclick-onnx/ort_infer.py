# WP5 spike S-1: ORT-only inference over the 4 exported graphs; parity check
# against PyTorch reference.json (token ids, click point) + numeric diff of
# encoder hidden states and step-1 logits (torch_intermediates.npz).
import json
import os
import re
import numpy as np
import onnxruntime as ort
from PIL import Image
from transformers import AutoProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(ROOT, "model")
ONNX = os.path.join(ROOT, "onnx")

COMMAND = "click on the ok button"


def postprocess(text, image_size):
    pattern = r"</s><s>(<[^>]+>|[^<\s]+)\s*([^<]*?)(<loc_\d+>.*)"
    point_pattern = r"<loc_(\d+)><loc_(\d+)>"
    match = re.search(pattern, text)
    if not match or (action := match.group(1)) != "click":
        return {"action": None, "click_point": (0, 0)}
    location = re.findall(point_pattern, text)[0]
    point = [int(loc) for loc in location]
    return {
        "action": action,
        "click_point": (
            int((point[0] / 1000) * image_size[0]),
            int((point[1] / 1000) * image_size[1]),
        ),
        "loc_raw": point,
    }


def sess(name):
    return ort.InferenceSession(
        os.path.join(ONNX, name), providers=["CPUExecutionProvider"]
    )


def main():
    print("onnxruntime:", ort.__version__)
    s_vision = sess("vision_encoder.onnx")
    s_embed = sess("embed_tokens.onnx")
    s_enc = sess("encoder_model.onnx")
    s_dec = sess("decoder_model.onnx")

    img = Image.open(os.path.join(ROOT, "test_image.png")).convert("RGB")
    image_size = img.size
    input_text = ("What to do to execute the command? " + COMMAND.strip()).lower()

    processor = AutoProcessor.from_pretrained(MODEL_DIR, trust_remote_code=True)
    inputs = processor(images=img, text=input_text, return_tensors="np", do_resize=True)

    image_features = s_vision.run(None, {"pixel_values": inputs["pixel_values"]})[0]
    text_embeds = s_embed.run(None, {"input_ids": inputs["input_ids"].astype(np.int64)})[0]
    merged = np.concatenate([image_features, text_embeds], axis=1)
    enc_mask = np.ones((merged.shape[0], merged.shape[1]), dtype=np.float32)
    enc_hidden = s_enc.run(None, {"inputs_embeds": merged, "attention_mask": enc_mask})[0]

    # numeric diff vs torch intermediates
    ref = np.load(os.path.join(ROOT, "torch_intermediates.npz"))
    d_enc = float(np.abs(enc_hidden - ref["enc_hidden"]).max())
    print(f"enc_hidden max|diff| vs torch: {d_enc:.3e}")

    # greedy decode (full-prefix recompute), eos == decoder_start == 2
    DEC_START, EOS, MAX_NEW = 2, 2, 50
    ids = [DEC_START]
    first_step_logits = None
    while len(ids) - 1 < MAX_NEW:
        dec_in = np.array([ids], dtype=np.int64)
        logits = s_dec.run(
            None,
            {
                "input_ids": dec_in,
                "encoder_hidden_states": enc_hidden,
                "encoder_attention_mask": enc_mask,
            },
        )[0]
        if first_step_logits is None:
            first_step_logits = logits
            d_log = float(np.abs(logits - ref["logits0"]).max())
            print(f"step-1 logits max|diff| vs torch: {d_log:.3e}")
        nxt = int(np.argmax(logits[0, -1]))
        ids.append(nxt)
        if nxt == EOS:
            break

    text = processor.batch_decode([ids], skip_special_tokens=False)[0]
    rec = postprocess(text, image_size)
    print("ort text:", text)
    print("ort parsed:", rec)

    reference = json.load(open(os.path.join(ROOT, "reference.json"), encoding="utf-8"))
    ref_g = reference["greedy"]
    ids_match = ids == ref_g["token_ids"]
    pt_ort = rec["click_point"]
    pt_ref = tuple(ref_g["click_point"])
    delta = (abs(pt_ort[0] - pt_ref[0]), abs(pt_ort[1] - pt_ref[1]))
    print("token_ids match torch greedy:", ids_match)
    print("click_point ort:", pt_ort, "ref:", pt_ref, "delta(px):", delta)

    verdict = {
        "onnxruntime_version": ort.__version__,
        "ort_token_ids": ids,
        "ort_text": text,
        "ort_click_point": list(pt_ort),
        "ort_loc_raw": rec.get("loc_raw"),
        "ref_token_ids": ref_g["token_ids"],
        "token_ids_match": ids_match,
        "click_point_delta_px": list(delta),
        "enc_hidden_maxdiff": d_enc,
        "step1_logits_maxdiff": d_log,
    }
    with open(os.path.join(ROOT, "ort_result.json"), "w", encoding="utf-8") as f:
        json.dump(verdict, f, ensure_ascii=False, indent=2)
    print("saved ort_result.json")


if __name__ == "__main__":
    main()