# WP5 spike S-3: ORT dynamic weight-only int8 quantization of the 4 fp32 graphs.
# embed_tokens is a pure Gather graph (no MatMul) — quantization is a no-op, keep fp32.
import os
import time
from onnxruntime.quantization import quantize_dynamic, QuantType

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "..", "s1-tinyclick-onnx", "onnx")
DST = os.path.join(ROOT, "onnx-int8")
os.makedirs(DST, exist_ok=True)

for name in ["vision_encoder", "encoder_model", "decoder_model"]:
    src = os.path.join(SRC, name + ".onnx")
    dst = os.path.join(DST, name + ".onnx")
    t0 = time.time()
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8)
    dt = time.time() - t0
    s_mb = os.path.getsize(src) / 1e6
    d_mb = os.path.getsize(dst) / 1e6
    print(f"{name}: {s_mb:.1f} MB -> {d_mb:.1f} MB ({d_mb/s_mb*100:.0f}%) in {dt:.0f}s", flush=True)

# embed_tokens: copy fp32 as-is (Gather-only graph)
import shutil
src = os.path.join(SRC, "embed_tokens.onnx")
shutil.copy(src, os.path.join(DST, "embed_tokens.onnx"))
print(f"embed_tokens: kept fp32 {os.path.getsize(src)/1e6:.1f} MB (Gather-only, quantization no-op)")

total = sum(os.path.getsize(os.path.join(DST, f)) for f in os.listdir(DST))
print(f"TOTAL int8 variant: {total/1e6:.0f} MB")