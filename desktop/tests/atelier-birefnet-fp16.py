"""Offline FP16 conversion of the pinned upstream ONNX, outside the product runtime."""
import ctypes
import gc
import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path

root = Path('D:/CanvasStudioBiRefNetQA')
sys.path.insert(0, str(root / 'converter-libs'))
import onnx
from onnxconverter_common import float16


class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong) for name in ('totalPhysical', 'availablePhysical',
        'totalPage', 'availablePage', 'totalVirtual', 'availableVirtual', 'availableExtended')]


def free():
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return status.availablePhysical


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


source = root / 'BiRefNet-matting-epoch_100.onnx'
skip_shapes = os.environ.get('STUDIO_BIREFNET_NO_SHAPE_INFER') == '1'
file_shapes = os.environ.get('STUDIO_BIREFNET_FILE_SHAPES') == '1'
ort_converter = os.environ.get('STUDIO_BIREFNET_ORT_CONVERTER') == '1'
assert not ort_converter or file_shapes, 'ORT conversion reuses the typed file'
assert not (skip_shapes and file_shapes), 'Choose one conversion strategy'
suffix = '-ort-file-shapes' if ort_converter else '-file-shapes' if file_shapes else '-no-shapes' if skip_shapes else ''
target = root / f'BiRefNet-matting-local-fp16{suffix}.onnx'
assert not target.exists(), 'Do not overwrite a prior conversion'
assert digest(source) == '6065d27c615ea27308f5b88598dd8db116eb07436c7a323ca40d13b2866c309e'
assert free() >= 4 * 1024 ** 3, 'Reserve 4 GiB before isolated conversion'
started = time.monotonic()


def guard():
    while True:
        time.sleep(.25)
        available = free()
        if available < 1536 * 1024 ** 2 or time.monotonic() - started > 180:
            result = dict(status='conversion-resource-limit', availableMiB=round(available / 1024 ** 2))
            (root / f'conversion{suffix}-stopped.json').write_text(json.dumps(result), encoding='utf-8')
            print(json.dumps(result), flush=True)
            os._exit(2)


threading.Thread(target=guard, daemon=True).start()
typed_source = root / 'BiRefNet-matting-typed.onnx'
if file_shapes:
    if not typed_source.exists():
        onnx.shape_inference.infer_shapes_path(str(source), str(typed_source), check_type=True, strict_mode=True)
model = onnx.load(str(typed_source if file_shapes else source))
print(json.dumps(dict(nodes=len(model.graph.node), valueInfo=len(model.graph.value_info))), flush=True)
if ort_converter:
    from onnxruntime.transformers import float16 as ort_float16
    converted = ort_float16.convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=True)
    float16.sort_topology(converted.graph)
else:
    converted = float16.convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=skip_shapes or file_shapes)
onnx.save(converted, str(target))
del model, converted
gc.collect()
onnx.checker.check_model(str(target))
result = dict(sourceSha256=digest(source), sha256=digest(target), bytes=target.stat().st_size,
              seconds=round(time.monotonic() - started, 3), checkerPassed=True,
              converter='onnxruntime 1.22.0 transformer converter / onnx 1.17.0' if ort_converter else 'onnxconverter-common 1.15.0 / onnx 1.17.0', keepIoTypes=True,
              disableShapeInference=skip_shapes or file_shapes, fileShapeInference=file_shapes,
              limits='Conversion only; no numerical equivalence or inference acceptance yet')
(root / f'conversion{suffix}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result), flush=True)
