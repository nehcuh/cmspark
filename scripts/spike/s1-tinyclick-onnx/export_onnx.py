# WP5 spike S-1: export TinyClick (Florence-2 arch) to ONNX.
# Layout follows onnx-community/Florence-2-base precedent:
#   vision_encoder.onnx  pixel_values -> image_features
#   embed_tokens.onnx    input_ids -> text embeddings
#   encoder_model.onnx   concat(image_features, text_embeds) + mask -> encoder_hidden_states
#   decoder_model.onnx   decoder_input_ids + encoder_hidden_states + mask -> logits
# Rationale for no-past decoder (recompute full prefix each step): the legacy
# torch.onnx tracer bakes past_key_values_length as a Python int constant, so a
# with-past graph traced at len=1 computes wrong positions at other lengths
# (optimum works around this with ModelPatcher). TinyClick outputs are ~7 tokens,
# so full-prefix recompute is cheap; parity is guaranteed.
import os
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(ROOT, "model")
OUT = os.path.join(ROOT, "onnx")
os.makedirs(OUT, exist_ok=True)

OPSET = 17

processor = AutoProcessor.from_pretrained(MODEL_DIR, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(MODEL_DIR, trust_remote_code=True).eval()

# ---- real example inputs (shapes guaranteed faithful) ----------------------
img = Image.open(os.path.join(ROOT, "test_image.png")).convert("RGB")
input_text = "what to do to execute the command? click on the ok button"
inputs = processor(images=img, text=input_text, return_tensors="pt", do_resize=True)

with torch.no_grad():
    image_features = model._encode_image(inputs["pixel_values"])
    text_embeds = model.get_input_embeddings()(inputs["input_ids"])
    merged = torch.cat([image_features, text_embeds], dim=1)
    enc_mask = torch.ones(merged.shape[0], merged.shape[1])
    enc_hidden = (
        model.language_model.get_encoder()(
            inputs_embeds=merged, attention_mask=enc_mask, return_dict=True
        ).last_hidden_state
    )
    dec_ids0 = torch.tensor([[model.config.text_config.decoder_start_token_id]])
    logits0 = model.language_model(
        input_ids=None,
        attention_mask=enc_mask,
        decoder_input_ids=dec_ids0,
        encoder_outputs=(enc_hidden,),
        past_key_values=None,
        use_cache=False,
        return_dict=True,
    ).logits

print("image_features", tuple(image_features.shape))
print("text_embeds    ", tuple(text_embeds.shape))
print("enc_hidden     ", tuple(enc_hidden.shape))
print("logits0        ", tuple(logits0.shape))
np.savez_compressed(
    os.path.join(ROOT, "torch_intermediates.npz"),
    enc_hidden=enc_hidden.numpy(),
    logits0=logits0.numpy(),
)

# ---- wrappers ---------------------------------------------------------------
class VisionEncoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, pixel_values):
        return self.m._encode_image(pixel_values)


class EmbedTokens(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.emb = m.get_input_embeddings()

    def forward(self, input_ids):
        return self.emb(input_ids)


class Encoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.enc = m.language_model.get_encoder()

    def forward(self, inputs_embeds, attention_mask):
        out = self.enc(
            inputs_embeds=inputs_embeds,
            attention_mask=attention_mask,
            return_dict=True,
        )
        return out.last_hidden_state


class Decoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.lm = m.language_model

    def forward(self, input_ids, encoder_hidden_states, encoder_attention_mask):
        out = self.lm(
            input_ids=None,
            attention_mask=encoder_attention_mask,
            decoder_input_ids=input_ids,
            encoder_outputs=(encoder_hidden_states,),
            past_key_values=None,
            use_cache=False,
            return_dict=True,
        )
        return out.logits


def export(module, args, path, input_names, output_names, dynamic_axes):
    with torch.no_grad():
        torch.onnx.export(
            module,
            args,
            path,
            input_names=input_names,
            output_names=output_names,
            dynamic_axes=dynamic_axes,
            opset_version=OPSET,
            do_constant_folding=True,
            dynamo=False,
        )
    print("exported", os.path.basename(path), f"{os.path.getsize(path)/1e6:.1f} MB")


export(
    VisionEncoder(model),
    (inputs["pixel_values"],),
    os.path.join(OUT, "vision_encoder.onnx"),
    ["pixel_values"],
    ["image_features"],
    {"pixel_values": {0: "batch"}, "image_features": {0: "batch"}},
)
export(
    EmbedTokens(model),
    (inputs["input_ids"],),
    os.path.join(OUT, "embed_tokens.onnx"),
    ["input_ids"],
    ["inputs_embeds"],
    {"input_ids": {0: "batch", 1: "sequence"}, "inputs_embeds": {0: "batch", 1: "sequence"}},
)
export(
    Encoder(model),
    (merged, enc_mask),
    os.path.join(OUT, "encoder_model.onnx"),
    ["inputs_embeds", "attention_mask"],
    ["encoder_hidden_states"],
    {
        "inputs_embeds": {0: "batch", 1: "sequence"},
        "attention_mask": {0: "batch", 1: "sequence"},
        "encoder_hidden_states": {0: "batch", 1: "sequence"},
    },
)
export(
    Decoder(model),
    (dec_ids0, enc_hidden, enc_mask),
    os.path.join(OUT, "decoder_model.onnx"),
    ["input_ids", "encoder_hidden_states", "encoder_attention_mask"],
    ["logits"],
    {
        "input_ids": {0: "batch", 1: "sequence"},
        "encoder_hidden_states": {0: "batch", 1: "enc_sequence"},
        "encoder_attention_mask": {0: "batch", 1: "enc_sequence"},
        "logits": {0: "batch", 1: "sequence"},
    },
)
print("ALL EXPORTS DONE")