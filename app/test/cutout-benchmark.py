"""Measure the actual worker process, not the Windows venv launcher."""
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

spec = importlib.util.spec_from_file_location('worker', Path(__file__).resolve().parents[1] / 'runtime/image-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
started = time.monotonic()
result = worker.cutout(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
elapsed = time.monotonic() - started
if os.name == 'nt':
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [(key, ctypes.c_size_t) for key in ['peakWorking', 'working', 'peakPaged', 'paged', 'peakNonPaged', 'nonPaged', 'pagefile', 'peakPagefile']]
    counter = Counters()
    counter.cb = ctypes.sizeof(counter)
    kernel = ctypes.WinDLL('kernel32')
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    query = ctypes.WinDLL('psapi').GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not query(kernel.GetCurrentProcess(), ctypes.byref(counter), counter.cb):
        raise ctypes.WinError()
    peak = counter.peakWorking
    commit = counter.peakPagefile
else:
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)
    commit = None
print(json.dumps(dict(result=result, seconds=elapsed, peakWorking=peak, peakCommit=commit)), flush=True)
sys.exit(result)
