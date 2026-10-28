import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'test-results'
fixtures = root / 'local-ai-fixtures'
report = {'checks': [], 'metrics': {}}
def check(name, value):
    if not value:
        raise AssertionError(name)
    report['checks'].append(name)

try:
    original = Image.open(fixtures / 'small.png').convert('RGBA')
    for name, scale in [('anime', 2), ('general', 4), ('illustration', 4)]:
        result = Image.open(root / ('local-ai-upscale-' + name + '.png')).convert('RGBA')
        a = np.asarray(result)
        expected_alpha = np.asarray(original.getchannel('A').resize(result.size, Image.Resampling.LANCZOS))
        check(name + ' original alpha Lanczos retained exactly', np.array_equal(a[:,:,3], expected_alpha))
        linear = np.asarray(original.resize(result.size, Image.Resampling.LANCZOS))
        changed = np.any(a[:,:,:3] != linear[:,:,:3], axis=2) & (a[:,:,3] > 200)
        check(name + ' native AI output differs from interpolation', int(changed.sum()) > 1000)
        report['metrics'][name] = {'ai_changed_pixels': int(changed.sum())}
    reference = np.asarray(Image.open(fixtures / 'transparent.png').convert('RGBA'))
    collage = Image.new('RGB', (reference.shape[1] * 4, reference.shape[0] + 28), '#363b42')
    for i, name in enumerate(['white', 'gray', 'pattern', 'transparent']):
        source = np.asarray(Image.open(fixtures / (name + '.png')).convert('RGBA'))
        result = Image.open(root / ('local-ai-cutout-' + name + '.png')).convert('RGBA')
        pixels = np.asarray(result)
        check(name + ' RGB preserved pixel-exact', np.array_equal(source[:,:,:3], pixels[:,:,:3]))
        check(name + ' existing alpha never increases', bool((pixels[:,:,3] <= source[:,:,3]).all()))
        core = reference[:,:,3] > 250
        bg = reference[:,:,3] == 0
        retained = float((pixels[:,:,3][core] > 200).mean())
        removed = float((pixels[:,:,3][bg] < 30).mean())
        report['metrics'][name] = {'core_retained': retained, 'background_removed': removed, 'soft_pixels': int(((pixels[:,:,3]>0)&(pixels[:,:,3]<255)).sum())}
        check(name + ' subject core retained above 95 percent', retained > .95)
        check(name + ' background removed above 95 percent', removed > .95)
        canvas = Image.new('RGBA', result.size, '#829bb1')
        canvas.alpha_composite(result)
        collage.paste(canvas.convert('RGB'), (i*reference.shape[1], 28))
        ImageDraw.Draw(collage).text((i*reference.shape[1]+10, 6), name, fill='white')
    collage.save(root / 'local-ai-cutout-review.png')
except Exception as e:
    report['failure'] = str(e)
    raise
finally:
    (root / 'local-ai-pixels.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
