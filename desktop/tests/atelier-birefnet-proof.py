"""Isolated BiRefNet matting evaluation; never installs or changes the product runtime.
Preprocessing/output follow the upstream tutorials/BiRefNet_pth2onnx.ipynb.
"""
import ctypes
import hashlib
import json
import os
import threading
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageChops


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


class Memory(ctypes.Structure):
    _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [
        (name, ctypes.c_size_t) for name in (
            'peakWorkingSet', 'workingSet', 'peakPagedPool', 'pagedPool',
            'peakNonpagedPool', 'nonpagedPool', 'pagefile', 'peakPagefile', 'private')]


class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong) for name in (
            'totalPhysical', 'availablePhysical', 'totalPage', 'availablePage',
            'totalVirtual', 'availableVirtual', 'availableExtended')]


def available_memory(commit=False):
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise ctypes.WinError()
    return status.availablePage if commit else status.availablePhysical


def memory():
    counters = Memory()
    counters.cb = ctypes.sizeof(counters)
    handle = ctypes.windll.kernel32.GetCurrentProcess
    handle.restype = ctypes.c_void_p
    get = ctypes.windll.psapi.GetProcessMemoryInfo
    get.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not get(handle(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return {key: round(getattr(counters, key) / 1024 ** 2, 1)
            for key in ('workingSet', 'peakWorkingSet', 'private', 'peakPagefile')}


lite = os.environ.get('STUDIO_BIREFNET_LITE') == '1'
full = os.environ.get('STUDIO_BIREFNET_FULL') == '1'
portrait = os.environ.get('STUDIO_BIREFNET_PORTRAIT') == '1'
matting16 = os.environ.get('STUDIO_BIREFNET_MATTING_FP16') == '1'
benchmark = os.environ.get('STUDIO_BIREFNET_BENCH') == '1'
profile = os.environ.get('STUDIO_BIREFNET_PROFILE') == '1'
assert not profile or ((full or matting16) and not benchmark), 'Profile one full-model inference'
assert not benchmark or lite or full or portrait or matting16, 'Known-alpha benchmark requires a pinned candidate'
assert sum((lite, full, portrait, matting16)) <= 1, 'Choose one isolated model'
variant = 'matting16' if matting16 else 'portrait' if portrait else 'full' if full else 'lite' if lite else 'matting'
settings = {
    'matting': ('D:/CanvasStudioBiRefNetQA', 'BiRefNet-matting-epoch_100.onnx', 972667742, '6065d27c615ea27308f5b88598dd8db116eb07436c7a323ca40d13b2866c309e'),
    'lite': ('D:/CanvasStudioBiRefNetLiteQA', 'model_fp16.onnx', 98484532, 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'),
    'full': ('D:/CanvasStudioBiRefNetFullQA', 'model_fp16.onnx', 489666272, '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09'),
    'portrait': ('D:/CanvasStudioBiRefNetPortraitQA', 'model_fp16.onnx', 489666272, '4c05930c0b6f1418d02eb1de81c46fe37638ba54f5a93adeb5c674521db10110'),
    'matting16': ('D:/CanvasStudioBiRefNetQA', 'BiRefNet-matting-local-fp16-ort-file-shapes.onnx', 489658479, '9e2757b2118c60d085dc0109fd8b23e29543fdc20598c0455ad727aa63f808fc'),
}
directory, filename, size, expected_hash = settings[variant]
root = Path(directory)
model = root / filename
assert model.stat().st_size == size, 'Incomplete model'
model_hash = digest(model)
assert model_hash == expected_hash, 'Model differs from the recorded QA artifact'
# Bounded isolated QA, not a measured model minimum or production policy.
available = available_memory()
assert available >= 4 * 1024 ** 3, f'QA deferred: {available / 1024 ** 3:.1f} GiB free; reserve 4 GiB before guarded evaluation'
cpu_only = os.environ.get('STUDIO_BIREFNET_CPU') == '1'
assert not (variant != 'matting' and cpu_only), 'FP16 evaluation requires DirectML'
output = root / ('results-alpha-benchmark' if benchmark else 'results-cpu' if cpu_only else 'results-physical-guard')
if matting16:
    output = root / ('results-matting-fp16-benchmark' if benchmark else 'results-matting-fp16')
if profile:
    output = root / ('results-full-fp16-profile' if full else 'results-matting-fp16-profile')
output.mkdir(exist_ok=True)
started = time.monotonic()


def guard():
    while True:
        time.sleep(.5)
        state = dict(availableMiB=round(available_memory() / 1024 ** 2),
                     availableCommitMiB=round(available_memory(commit=True) / 1024 ** 2),
                     elapsedSeconds=round(time.monotonic() - started, 1), memoryMiB=memory())
        if state['availableMiB'] < 1024 or state['availableCommitMiB'] < 2048 or state['memoryMiB']['private'] > 16384 or state['elapsedSeconds'] > 180:
            state['status'] = 'isolated-test-stopped-at-resource-limit'
            (output / 'guard-stop.json').write_text(json.dumps(state, indent=2), encoding='utf-8')
            print(json.dumps(state), flush=True)
            os._exit(2)  # This QA process owns no product files or running application.


threading.Thread(target=guard, daemon=True).start()
references = Path(__file__).resolve().parents[3] / '风格试验/C组-照片人物测试01/人物参考'
sources = [('portrait-a', references / '01-person.png'),
           ('portrait-b', references / '02-person.png'),
           ('pet', Path('D:/CanvasStudioQuality/samples/chelsea.png'))]
if profile:
    sources = sources[:1]
truths = {}
if benchmark:
    fixtures = json.loads(Path('D:/CanvasStudioBiRefNetFullQA/alpha-benchmark/manifest.json').read_text(encoding='utf-8'))
    sources = [(item['name'], Path(item['source'])) for item in fixtures]
    truths = {item['name']: Path(item['truth']) for item in fixtures}
report = {
    'model': str(model), 'sha256': model_hash,
    'source': 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-matting-epoch_100.onnx',
    'integrity': 'HTTPS upstream release and exact size; locally recorded SHA256, no upstream digest published',
    'limits': 'Offline QA only; no ground-truth alpha, large-image, cancellation, product or UI acceptance',
    'guard': '4 GiB physical free before start; stop own process below 1 GiB physical or 2 GiB commit headroom, above 16 GiB private committed memory, or after 180 seconds; sampled every 500ms. Private commit is not physical RAM or dedicated VRAM.',
    'samples': [],
}
if lite:
    report.update(source='https://huggingface.co/studioludens/birefnet-lite-512/tree/962e67969ec6acec9c19fab76acee4f5e22e990c',
                  integrity='Fixed community conversion revision, published LFS SHA256 and size verified; MIT license retained')
if full:
    report.update(source='https://huggingface.co/onnx-community/BiRefNet-ONNX/tree/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67',
                  integrity='Published full-model FP16 conversion, fixed revision, LFS SHA256 and size verified; model card MIT and upstream license retained',
                  modelVariant='General full BiRefNet at 1024, not the matting-specialized checkpoint')
if portrait:
    report.update(source='https://huggingface.co/onnx-community/BiRefNet-portrait-ONNX/tree/dd7167f6a8b54ff7efc29a4c988938d79866464f',
                  integrity='Fixed portrait conversion revision, published LFS SHA256 and size verified; MIT model card and upstream license retained',
                  modelVariant='Portrait checkpoint, not general matting or general segmentation')
if matting16:
    report.update(integrity='Local FP16 derivation of the pinned upstream matting ONNX; conversion-ort-file-shapes.json records source/output hashes and checker result',
                  modelVariant='Dedicated general matting checkpoint, types inferred through file API before conversion; numerical equivalence not yet proven')
if benchmark:
    report.update(limits='Nine known-alpha synthetic composites, not photographic ground truth or product acceptance',
                  alphaScreen={'meanAbsoluteErrorMax': .03, 'transitionMAEMax': .12, 'foregroundRetainedMin': .97, 'backgroundClearedMin': .98})
options = ort.SessionOptions()
options.enable_mem_pattern = False
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
options.intra_op_num_threads = 2
if profile:
    options.enable_profiling = True
    options.profile_file_prefix = str(output / 'ort')
assert cpu_only or 'DmlExecutionProvider' in ort.get_available_providers(), 'DirectML required for this hardware comparison'
start = time.perf_counter()
print('Loading isolated ' + ('CPU' if cpu_only else 'DirectML') + ' model', flush=True)
session = ort.InferenceSession(str(model), sess_options=options,
                              providers=['CPUExecutionProvider'] if cpu_only else ['DmlExecutionProvider', 'CPUExecutionProvider'])
report.update(loadSeconds=round(time.perf_counter() - start, 3),
              providers=session.get_providers(), inputShape=session.get_inputs()[0].shape,
              inputType=session.get_inputs()[0].type, memoryAfterLoadMiB=memory())
print(json.dumps(report), flush=True)
(output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
edge = 512 if lite else 1024
assert session.get_inputs()[0].shape == [1, 3, edge, edge]
assert session.get_inputs()[0].type in ('tensor(float)', 'tensor(float16)')
for name, path in sources:
    before = digest(path)
    source = Image.open(path).convert('RGBA')
    pixels = np.asarray(source.convert('RGB').resize((edge, edge), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = pixels.transpose(2, 0, 1)[None].copy()
    if session.get_inputs()[0].type == 'tensor(float16)':
        tensor = tensor.astype(np.float16)
    times = []
    for repeat in range(1 if benchmark or profile else 2):
        start = time.perf_counter()
        prediction = session.run(None, {session.get_inputs()[0].name: tensor})[-1][0, 0].astype(np.float32)
        assert np.isfinite(prediction).all()
        alpha = 1 / (1 + np.exp(-np.clip(prediction, -80, 80)))
        times.append(round(time.perf_counter() - start, 3))
    mask = Image.fromarray(np.rint(alpha * 255).astype(np.uint8)).resize(source.size, Image.Resampling.LANCZOS if variant == 'matting' else Image.Resampling.BILINEAR)
    result = source.copy()
    result.putalpha(ImageChops.multiply(source.getchannel('A'), mask))
    actual, original = np.array(result), np.array(source)
    assert result.size == source.size
    assert np.array_equal(actual[:, :, :3], original[:, :, :3])
    assert np.all(actual[:, :, 3] <= original[:, :, 3])
    assert digest(path) == before
    result.save(output / f'{name}.png')
    preview = Image.new('RGB', (round(result.width * 500 / result.height) * 2, 500))
    for index, background in enumerate(('#ffffff', '#17191f')):
        canvas = Image.new('RGBA', result.size, background)
        canvas.alpha_composite(result)
        preview.paste(canvas.convert('RGB').resize((preview.width // 2, 500), Image.Resampling.LANCZOS), (index * preview.width // 2, 0))
    preview.save(output / f'{name}-backgrounds.png')
    item = dict(name=name, source=str(path), sourceSha256=before, size=result.size,
                inferenceSeconds=times, memoryMiB=memory(), rgbPreserved=True,
                originalFileUnchanged=True, alphaRange=[int(actual[:, :, 3].min()), int(actual[:, :, 3].max())])
    if benchmark:
        truth = np.asarray(Image.open(truths[name]).convert('RGBA'))[:, :, 3].astype(np.float32) / 255
        predicted = actual[:, :, 3].astype(np.float32) / 255
        error = np.abs(predicted - truth)
        transition = (truth > .05) & (truth < .95)
        foreground = truth > .95
        background = truth < .01
        item['alphaMetrics'] = dict(meanAbsoluteError=float(error.mean()),
                                    transitionMAE=float(error[transition].mean()),
                                    foregroundRetained=float((predicted[foreground] > .9).mean()),
                                    backgroundCleared=float((predicted[background] < .05).mean()))
        # Operational screening thresholds declared before inference, not universal quality claims.
        m = item['alphaMetrics']
        item['alphaScreenPassed'] = bool(m['meanAbsoluteError'] <= .03 and m['transitionMAE'] <= .12 and m['foregroundRetained'] >= .97 and m['backgroundCleared'] >= .98)
    report['samples'].append(item)
    print(json.dumps(item), flush=True)
    (output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
if profile:
    report['profilePath'] = session.end_profiling()
    (output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    time.sleep(5)  # Allow the separate GPU counter sampler to observe the live session.
