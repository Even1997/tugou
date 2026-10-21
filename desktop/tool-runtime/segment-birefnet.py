"""Offline BiRefNet general FP16; pinned upstream preprocessing, no downloads."""
import argparse
import ctypes
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageChops

sys.stderr.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser()
for name in ('model', 'input', 'output'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
Image.MAX_IMAGE_PIXELS = 100_000_000
image = Image.open(args.input)
if image.width * image.height > 100_000_000 or max(image.size) > 30000:
    raise ValueError('Input image exceeds document limits')
if 'DmlExecutionProvider' not in ort.get_available_providers():
    raise RuntimeError('精细识别需要 DirectML，请使用轻量识别或安装 DirectML 组件')
if sys.platform == 'win32':
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in (
            'totalPhysical', 'availablePhysical', 'totalPage', 'availablePage', 'totalVirtual', 'availableVirtual', 'availableExtended')]
    memory = MemoryStatus()
    memory.length = ctypes.sizeof(memory)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        raise ctypes.WinError()
    # Full general FP16 measured about 1 GiB working set; reserve another GiB
    # plus decoded image buffers. Commit also includes DirectML allocations.
    image_budget = image.width * image.height * 16
    if memory.availablePhysical < 2 * 1024 ** 3 + image_budget or memory.availablePage < 14 * 1024 ** 3 + image_budget:
        raise RuntimeError('精细识别内存余量不足，请关闭占用资源的程序或改用轻量识别')
options = ort.SessionOptions()
options.enable_mem_pattern = False
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
options.intra_op_num_threads = 2
print('10%', file=sys.stderr, flush=True)
session = ort.InferenceSession(args.model, sess_options=options, providers=['DmlExecutionProvider', 'CPUExecutionProvider'])
image = image.convert('RGBA')
pixels = np.asarray(image.convert('RGB').resize((1024, 1024), Image.Resampling.BILINEAR), dtype=np.float32) / 255
pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
print('30%', file=sys.stderr, flush=True)
prediction = session.run(None, {session.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None].copy()})[-1][0, 0].astype(np.float32)
if not np.isfinite(prediction).all():
    raise ValueError('精细识别返回无效蒙版')
coverage = 1 / (1 + np.exp(-np.clip(prediction, -80, 80)))
mask = Image.fromarray(np.rint(coverage * 255).astype(np.uint8)).resize(image.size, Image.Resampling.BILINEAR)
image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
image.save(args.output, format='PNG')
Path(args.output + '.json').write_text(json.dumps({'model': 'birefnet-general-fp16', 'providers': session.get_providers(), 'width': image.width, 'height': image.height}), encoding='utf-8')
print('100%', file=sys.stderr, flush=True)
