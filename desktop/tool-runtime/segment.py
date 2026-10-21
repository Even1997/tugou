"""Offline IS-Net inference; preprocessing follows rembg's MIT-licensed DisSession.
Model: https://github.com/xuebinqin/DIS . No downloads or HTTP during inference.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
Image.MAX_IMAGE_PIXELS = 100_000_000
image = Image.open(args.input).convert("RGBA")
if image.width * image.height > 100_000_000 or max(image.size) > 30000:
    raise ValueError("Input image exceeds document limits")
options = ort.SessionOptions()
options.enable_mem_pattern = False
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
options.intra_op_num_threads = 2
provider = "DmlExecutionProvider" if "DmlExecutionProvider" in ort.get_available_providers() else "CPUExecutionProvider"
print("10%", file=sys.stderr, flush=True)
session = ort.InferenceSession(args.model, sess_options=options, providers=[provider, "CPUExecutionProvider"] if provider != "CPUExecutionProvider" else [provider])
pixels = np.asarray(image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS), dtype=np.float32)
pixels = pixels / max(float(pixels.max()), 1e-6) - .5
tensor = pixels.transpose(2, 0, 1)[None].astype(np.float32)
print("30%", file=sys.stderr, flush=True)
prediction = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
minimum, maximum = float(prediction.min()), float(prediction.max())
if not np.isfinite(prediction).all() or maximum - minimum < 1e-8:
    raise ValueError("Segmentation returned an empty or invalid mask")
mask = Image.fromarray(np.clip((prediction - minimum) / (maximum - minimum) * 255, 0, 255).astype(np.uint8)).resize(image.size, Image.Resampling.LANCZOS)
image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
image.save(args.output, format="PNG")
Path(args.output + ".json").write_text(json.dumps({"providers": session.get_providers(), "width": image.width, "height": image.height}), encoding="utf-8")
print("100%", file=sys.stderr, flush=True)
