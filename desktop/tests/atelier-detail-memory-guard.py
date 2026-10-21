"""Stream a valid 100MP PNG and exercise the actual low-memory guard, no mocks."""
import ctypes
import hashlib
import json
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path
from PIL import Image

root = Path('D:/CanvasStudioCutoutUpgradeQA/guard-100mp-valid')
root.mkdir(parents=True, exist_ok=True)
source, output = root / 'input.png', root / 'output.png'
assert not (root / 'result.json').exists(), 'Do not repeat unchanged evidence'

# Generate without holding a 400 MB bitmap in the test process.
def chunk(stream, kind, data):
    stream.write(struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data)))

with source.open('wb') as stream:
    stream.write(b'\x89PNG\r\n\x1a\n')
    chunk(stream, b'IHDR', struct.pack('>IIBBBBB', 10000, 10000, 8, 6, 0, 0, 0))
    compressor = zlib.compressobj()
    for row in range(10000):
        data = compressor.compress(b'\0' + bytes([row % 256, 80, 120, 255]) * 10000)
        if data:
            chunk(stream, b'IDAT', data)
    chunk(stream, b'IDAT', compressor.flush())
    chunk(stream, b'IEND', b'')
Image.MAX_IMAGE_PIXELS = 100_000_000
with Image.open(source) as image:
    assert image.size == (10000, 10000)
    image.verify()

class MemoryStatus(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in (
        'totalPhysical', 'availablePhysical', 'totalPage', 'availablePage', 'totalVirtual', 'availableVirtual', 'availableExtended')]

memory = MemoryStatus()
memory.length = ctypes.sizeof(memory)
assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory))
assert memory.availablePhysical < 2 * 1024 ** 3 + 100_000_000 * 16 or memory.availablePage < 14 * 1024 ** 3 + 100_000_000 * 16, 'Current resources no longer exercise the low-memory guard'
before = hashlib.sha256(source.read_bytes()).hexdigest()
started = time.perf_counter()
result = subprocess.run([sys.executable, 'D:/CanvasStudioRuntime/segmentation/segment-birefnet.py', '--model',
    'D:/CanvasStudioRuntime/segmentation/birefnet-general-fp16.onnx', '--input', str(source), '--output', str(output)],
    capture_output=True, encoding='utf-8', timeout=30)
elapsed = time.perf_counter() - started
(root / 'stderr.log').write_text(result.stderr, encoding='utf-8')
report = {'dimensions': [10000, 10000], 'sourceVerified': True, 'workerExit': result.returncode,
    'elapsedMs': round(elapsed * 1000), 'availablePhysicalMiB': round(memory.availablePhysical / 1024 ** 2),
    'availableCommitMiB': round(memory.availablePage / 1024 ** 2),
    'memoryGuard': '精细识别内存余量不足' in result.stderr, 'modelLoadingStarted': '10%' in result.stderr,
    'outputExists': output.exists(), 'sourceUnchanged': hashlib.sha256(source.read_bytes()).hexdigest() == before,
    'limits': 'Low-memory rejection before model allocation; not successful 100MP inference or a low-VRAM test'}
(root / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
assert result.returncode != 0 and report['memoryGuard'] and not report['modelLoadingStarted'] and not report['outputExists'] and report['sourceUnchanged']
