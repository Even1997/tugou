"""Standalone JSON-file worker. No downloads, cloud calls, or changes to its input."""
import json
import os
import sys
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'


def main(spec):
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    from remove_ai_watermarks import watermark_registry as registry
    from remove_ai_watermarks.region_eraser import erase_cv2

    cv2.setNumThreads(2)
    if spec.get('action') == 'probe':
        return {'ready': True, 'engine': 'opencv', 'version': '1'}
    with Image.open(spec['input']) as image:
        if image.width * image.height > 24000000 or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('仅支持 2400 万像素以内的静态图片')
        icc = image.info.get('icc_profile')
        if image.mode not in ('RGB', 'RGBA', 'P', 'L', 'LA'):
            raise ValueError('请先转换为 RGB 图片再修复水印')
        rgba = np.array(ImageOps.exif_transpose(image).convert('RGBA'))
    source = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    mode = spec.get('mode', 'auto')
    if mode in ('mask', 'region'):
        if mode == 'mask':
            with Image.open(spec['mask']) as image:
                if image.size != (source.shape[1], source.shape[0]):
                    raise ValueError('蒙版与原图尺寸不同，请重新涂画')
                mask = np.array(image.convert('RGBA'))[:, :, 3]
        else:
            x, y, w, h = spec['region']
            mask = np.zeros(source.shape[:2], dtype=np.uint8)
            mask[y:y+h, x:x+w] = 255
        mask = np.where(mask > 0, 255, 0).astype(np.uint8)
        if not mask.any():
            raise ValueError('修复区域为空，请先涂画')
        if np.all(mask):
            raise ValueError('请保留部分未选区域，供修复时参考')
        result = erase_cv2(source, mask, radius=int(spec.get('radius', 6)))
        # The output contract changes only selected RGB pixels, never alpha.
        result[mask == 0] = source[mask == 0]
        summary = {'status': 'manual', 'marks': [], 'changedPixels': int(np.count_nonzero(np.any(result != source, axis=2)))}
    else:
        from remove_ai_watermarks.api import visible_provenance
        report = registry.remove_auto_marks_detailed(source, backend='cv2', sensitivity='strict', provenance=visible_provenance(spec['input']))
        result = report.image
        summary = {'status': report.status, 'marks': [
            {'label': m.label, 'status': m.status, 'bounds': list(m.mask_bbox) if m.mask_bbox else None}
            for m in report.marks
        ]}
    rgb = cv2.cvtColor(result, cv2.COLOR_BGR2RGB)
    output = Image.fromarray(np.dstack((rgb, rgba[:, :, 3])))
    output.save(spec['output'], format='PNG', **({'icc_profile': icc} if icc else {}))
    return summary


if __name__ == '__main__':
    try:
        spec = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        print(json.dumps(main(spec)), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)[:300]}), flush=True)
        sys.exit(1)
