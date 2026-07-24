# Dump exact processor outputs (pixel_values fp32 + input_ids) for the W2
# correctness arm: isolates JS ORT runtime from preprocessing fidelity.
import os
import numpy as np
from PIL import Image
from transformers import AutoProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
S1 = os.path.join(ROOT, "..", "s1-tinyclick-onnx")
processor = AutoProcessor.from_pretrained(os.path.join(S1, "model"), trust_remote_code=True)
img = Image.open(os.path.join(S1, "test_image.png")).convert("RGB")
text = "what to do to execute the command? click on the ok button"
inputs = processor(images=img, text=text, return_tensors="np", do_resize=True)
np.save("pixel_values.npy", inputs["pixel_values"].astype(np.float32))
np.save("input_ids.npy", inputs["input_ids"].astype(np.int64))
print("pixel_values", inputs["pixel_values"].shape, inputs["pixel_values"].dtype)
print("input_ids", inputs["input_ids"].shape, inputs["input_ids"][0].tolist())
