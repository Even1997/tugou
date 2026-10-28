"""Tugou's local image adapter. No network access or third-party application code."""
import json
import os
import sys
import warnings

import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 100_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def emit(**data):
    print(json.dumps(data), flush=True)


def open_source(filename):
    with Image.open(filename) as raw:
        w, h = raw.size
        if w * h > 100_000_000 or max(w, h) > 30000:
            raise ValueError('dimensions')
        return ImageOps.exif_transpose(raw).convert('RGBA')


def memory_status():
    if os.name == 'nt':
        import ctypes
        class Memory(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(key, ctypes.c_ulonglong) for key in ['total', 'available', 'commit', 'commit_available', 'virtual', 'virtual_available', 'extended']]
        memory = Memory()
        memory.length = ctypes.sizeof(memory)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            raise RuntimeError('memory probe')
        return dict(available=memory.available, commitAvailable=memory.commit_available)
    return None


def cutout(spec):
    import onnxruntime as ort
    source = open_source(spec['input'])
    memory = memory_status()
    if memory:
        buffers = source.width * source.height * 20
        if memory['available'] < 2 * 1024**3 + buffers or memory['commitAvailable'] < 14 * 1024**3 + buffers:
            emit(error='精细抠图可用内存不足，请关闭占用内存的应用后重试')
            return 2
    provider = spec['provider']
    if provider not in ort.get_available_providers():
        raise ValueError('provider unavailable')
    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = 2
    options.log_severity_level = 3
    emit(stage='加载主体模型')
    session = ort.InferenceSession(spec['model'], sess_options=options, providers=[provider, 'CPUExecutionProvider'] if provider != 'CPUExecutionProvider' else [provider])
    session.disable_fallback()
    if session.get_providers()[0] != provider:
        raise RuntimeError('requested provider failed')
    # The pinned model's preprocessor declares bilinear 1024px, ImageNet mean/std.
    rgb = np.asarray(source.convert('RGB').resize((1024, 1024), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    rgb = (rgb - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = rgb.transpose(2, 0, 1)[None]
    meta = session.get_inputs()[0]
    if meta.type == 'tensor(float16)':
        tensor = tensor.astype(np.float16)
    emit(stage='识别主体')
    logits = session.run(None, {meta.name: tensor})[-1].squeeze().astype(np.float32)
    if logits.ndim != 2 or not np.isfinite(logits).all():
        raise ValueError('invalid mask')
    mask = np.rint(255 / (1 + np.exp(-np.clip(logits, -80, 80)))).astype(np.uint8)
    matte = Image.fromarray(mask).resize(source.size, Image.Resampling.BILINEAR)
    # Preserve original RGB and existing transparency; only reduce alpha.
    alpha = (np.asarray(source.getchannel('A'), dtype=np.uint16) * np.asarray(matte, dtype=np.uint16) + 127) // 255
    source.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    emit(stage='保存透明结果')
    source.save(spec['output'], format='PNG')
    emit(provider=provider, width=source.width, height=source.height)
    return 0


def main():
    if sys.argv[1] == 'probe':
        import onnxruntime as ort
        emit(providers=ort.get_available_providers(), version=ort.__version__, memory=memory_status())
        return 0
    with open(sys.argv[1], encoding='utf-8') as stream:
        spec = json.load(stream)
    mode = sys.argv[2]
    if mode == 'cutout':
        return cutout(spec)
    source = open_source(spec['input'])
    if mode == 'prepare':
        source.convert('RGB').save(spec['rgb'], format='PNG')
        emit(width=source.width, height=source.height)
    elif mode == 'finish':
        with Image.open(spec['enhanced']) as enhanced:
            expected = (source.width * spec['scale'], source.height * spec['scale'])
            if enhanced.size != expected:
                raise ValueError('unexpected output size')
            result = enhanced.convert('RGBA')
        result.putalpha(source.getchannel('A').resize(result.size, Image.Resampling.LANCZOS))
        result.save(spec['output'], format='PNG')
        emit(width=result.width, height=result.height)
    else:
        raise ValueError('unknown operation')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        emit(error='本地组件运行失败，请检查模型、显卡和可用内存')
        sys.exit(1)
