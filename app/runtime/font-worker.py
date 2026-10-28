"""Deterministic atlas-to-UFO worker. All paths come from FontService, never MCP code."""
import hashlib
import json
import math
import platform
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.pointPen import SegmentToPointPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from fontTools.ufoLib import UFOReader, UFOWriter

VERSION = 'atlas-2'
MAX_PIXELS = 16_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
DICTIONARY = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)


def save_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def progress(stage, done=0, total=1):
    print(json.dumps(dict(stage=stage, done=done, total=total)), flush=True)


def glyph_name(char):
    return f'u{ord(char):06X}'


def artifact(out, filename, mime):
    data = (out / filename).read_bytes()
    return dict(id=filename, file=filename, mimeType=mime, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def make_plan(job, out):
    if job.get('layout') == 'grid256':
        pages, artifacts = [], []
        for start in range(0, len(job['characters']), 256):
            cells = []
            for i, char in enumerate(job['characters'][start:start+256]):
                row, col = divmod(i, 16)
                cells.append(dict(character=char, id=glyph_name(char), box=[col*90, row*160, (col+1)*90, (row+1)*160], baseline=112, emPixels=90, originX=0))
            filename = f'template-{len(pages)}.png'
            Image.new('RGB', (1440, 2560), 'white').save(out / filename)
            pages.append(dict(page=len(pages), layout='grid256', width=1440, height=2560, cells=cells, template=filename))
            artifacts.append(artifact(out, filename, 'image/png'))
        result = dict(version=VERSION, pages=pages, characters=job['characters'], unitsPerEm=1000)
        save_json(out / 'plan.json', result)
        return dict(plan=result, artifacts=artifacts+[artifact(out, 'plan.json', 'application/json')])
    cell = job.get('cellSize', 384)
    pages, artifacts = [], []
    # Eight columns keep 512px cells below the raster budget only when paginated.
    cols = min(8, int(math.sqrt(MAX_PIXELS)) // cell - 1)
    rows = min(8, (MAX_PIXELS // (cols * cell + 192) - 192) // cell)
    chars = job['characters']
    for start in range(0, len(chars), cols * rows):
        subset = chars[start:start + cols * rows]
        used_rows = math.ceil(len(subset) / cols)
        width, height = cols * cell + 192, used_rows * cell + 192
        image = Image.new('RGB', (width, height), 'white')
        marker_origins = [(24, 24), (width - 72, 24), (width - 72, height - 72), (24, height - 72)]
        markers = []
        for i, (x, y) in enumerate(marker_origins):
            image.paste(Image.fromarray(cv2.aruco.generateImageMarker(DICTIONARY, i, 48)), (x, y))
            markers.append([[x, y], [x + 47, y], [x + 47, y + 47], [x, y + 47]])
        cells = []
        draw = ImageDraw.Draw(image)
        for i, char in enumerate(subset):
            row, col = divmod(i, cols)
            x, y = 96 + col * cell, 96 + row * cell
            # No grid strokes inside extraction cells: labels live in the manifest.
            cells.append(dict(character=char, id=glyph_name(char), box=[x, y, x + cell, y + cell],
                              baseline=cell * .72, emPixels=cell * .68, originX=cell * .1))
        draw.text((96, 28), f'Tugou atlas {len(pages) + 1} - keep corner markers unchanged', fill='black')
        filename = f'template-{len(pages)}.png'
        image.save(out / filename)
        pages.append(dict(page=len(pages), width=width, height=height, markers=markers, cells=cells, template=filename))
        artifacts.append(artifact(out, filename, 'image/png'))
    result = dict(version=VERSION, pages=pages, characters=chars, unitsPerEm=1000,
                  instructions='Keep markers and cells. Draw dark ink on light background. Use the manifest mapping; do not render labels inside cells.')
    save_json(out / 'plan.json', result)
    artifacts.append(artifact(out, 'plan.json', 'application/json'))
    return dict(plan=result, artifacts=artifacts)


def load_image(filename):
    with Image.open(filename) as source:
        if source.format not in ('PNG', 'JPEG', 'WEBP') or source.width * source.height > MAX_PIXELS:
            raise ValueError('IMAGE_LIMIT: 仅支持不超过 16 MP 的 PNG/JPEG/WebP')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('IMAGE_FORMAT: 不支持动画图集')
        return np.array(source.convert('RGBA'))


def align(image, page, explicit=None):
    if page.get('layout') == 'recognized':
        return image, dict(method='reviewed-ocr-boxes', sourceSize=[image.shape[1], image.shape[0]])
    if page.get('layout') == 'grid256' and explicit is None:
        if abs(image.shape[1]/image.shape[0]/(9/16)-1) > .03:
            raise ValueError('GRID_RATIO: 图集需为9:16，或提供四角定位')
        explicit = [[0, 0], [image.shape[1]-1, 0], [image.shape[1]-1, image.shape[0]-1], [0, image.shape[0]-1]]
    alpha = image[:, :, 3:4].astype('float32') / 255
    rgb = (image[:, :, :3] * alpha + 255 * (1 - alpha)).astype('uint8')
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    if explicit is not None:
        source = np.array(explicit, dtype='float32')
        if not cv2.isContourConvex(source) or abs(cv2.contourArea(source)) < image.shape[0] * image.shape[1] * .2:
            raise ValueError('NEEDS_ALIGNMENT: 角点应按左上、右上、右下、左下排列')
        target = np.array([[0, 0], [page['width']-1, 0], [page['width']-1, page['height']-1], [0, page['height']-1]], dtype='float32')
        matrix = cv2.getPerspectiveTransform(source, target)
        residual, method = None, 'explicit-corners'
    else:
        corners, ids, _ = cv2.aruco.ArucoDetector(DICTIONARY).detectMarkers(gray)
        if ids is None or len(ids) != 4 or set(ids.flatten()) != {0, 1, 2, 3}:
            raise ValueError('NEEDS_ALIGNMENT: 四角定位标记缺失或重复，请补图或明确提供角点')
        located = {int(i): c[0] for i, c in zip(ids.flatten(), corners)}
        source = np.concatenate([located[i] for i in range(4)])
        target = np.concatenate(page['markers']).astype('float32')
        matrix, _ = cv2.findHomography(source, target, 0)
        if matrix is None or not np.isfinite(matrix).all():
            raise ValueError('NEEDS_ALIGNMENT: 定位变换无效')
        projected = cv2.perspectiveTransform(source.reshape(-1, 1, 2), matrix).reshape(-1, 2)
        residual = float(np.max(np.linalg.norm(projected - target, axis=1)))
        if residual > 2.5:
            raise ValueError('NEEDS_ALIGNMENT: 标记形变过大，不能可靠自动校正')
        method = 'aruco-homography'
    corrected = cv2.warpPerspective(image, matrix, (page['width'], page['height']),
                                    flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255, 0))
    return corrected, dict(method=method, matrix=matrix.tolist(), maxResidualPixels=residual,
                          sourceSize=[image.shape[1], image.shape[0]])


def mask_from_cell(cell, background, threshold, check_edges=True):
    if background == 'alpha':
        if cell[:, :, 3].min() > 10 or cell[:, :, 3].max() < 200:
            raise ValueError('ALPHA_REQUIRED: 透明输入必须包含透明背景及不透明字形')
        mask = (cell[:, :, 3] >= threshold).astype('uint8')
    else:
        a = cell[:, :, 3:4].astype(float) / 255
        rgb = (cell[:, :, :3] * a + 255 * (1 - a)).astype('uint8')
        mask = (cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < threshold).astype('uint8')
    return mask, mask_geometry(mask) if check_edges else None


def recognized_mask(image, box, background, threshold):
    x0, y0, x1, y1 = box
    mask, _ = mask_from_cell(image[y0:y1, x0:x1], background, threshold, False)
    if not mask.any():
        raise ValueError('EMPTY_GLYPH: 裁切框没有字形')
    # A reviewed identity is not permission to clip a stroke at its crop boundary.
    if mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any():
        raise ValueError('CROSS_CELL: 裁切框触及笔画，请扩大或调整裁切框')
    yy, xx = np.nonzero(mask)
    tight = mask[yy.min():yy.max()+1, xx.min():xx.max()+1]
    scale = 216/max(tight.shape)
    resized = cv2.resize(tight, (max(1, round(tight.shape[1]*scale)), max(1, round(tight.shape[0]*scale))), interpolation=cv2.INTER_NEAREST)
    result = np.zeros((384, 384), dtype='uint8')
    top, left = 280-resized.shape[0], (384-resized.shape[1])//2
    result[top:top+resized.shape[0], left:left+resized.shape[1]] = resized
    original_geometry = mask_geometry(np.pad(tight, 4))
    geometry = mask_geometry(result)
    if (original_geometry['components'], original_geometry['holes']) != (geometry['components'], geometry['holes']):
        raise ValueError('NORMALIZATION_TOPOLOGY: 缩放裁切字形会改变点画或字腔，请检查素材')
    return result, geometry


def mask_geometry(mask):
    if not mask.any():
        raise ValueError('EMPTY_GLYPH: 格子没有字形')
    if mask[:3].any() or mask[-3:].any() or mask[:, :3].any() or mask[:, -3:].any():
        raise ValueError('CROSS_CELL: 墨迹接触格子边缘，拒绝裁切笔画')
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    holes = 0
    for i in range(len(contours)):
        depth, parent = 0, hierarchy[0][i][3]
        while parent >= 0:
            depth += 1
            parent = hierarchy[0][parent][3]
        holes += depth % 2
    # Small regions are retained. A warning is not permission to delete a dot.
    tiny = int(sum(stats[1:, cv2.CC_STAT_AREA] < 4))
    return dict(components=count-1, holes=holes, inkPixels=int(mask.sum()),
                warnings=['SMALL_REGIONS_PRESERVED'] if tiny else [])


def trace(mask, stem, out, tracer, cell):
    pgm, svg = out / f'{stem}.pgm', out / f'{stem}.svg'
    Image.fromarray(np.where(mask, 0, 255).astype('uint8')).save(pgm)
    subprocess.run([tracer, str(pgm), '--svg', '-o', str(svg), '--turdsize', '0',
                    '--alphamax', '1', '--opttolerance', '.15'], check=True, capture_output=True,
                   timeout=20, creationflags=0x08000000 if sys.platform == 'win32' else 0)
    raw = RecordingPen()
    for element in ElementTree.fromstring(svg.read_bytes()).iter():
        if element.tag.rsplit('}', 1)[-1] == 'path':
            parse_path(element.attrib['d'], raw)
    scale = 1000 / cell['emPixels']
    pen = RecordingPen()
    # Potrace's raw paths use 10 units per pixel, with a bottom-up Y axis.
    raw.replay(TransformPen(pen, (scale/10, 0, 0, scale/10,
                                 -cell['originX']*scale, (cell['baseline']-mask.shape[0])*scale)))
    bounds = BoundsPen(None)
    pen.replay(bounds)
    if bounds.bounds is None:
        raise ValueError('EMPTY_OUTLINE: 描图没有产生轮廓')
    return pen, bounds.bounds


def ink_metrics(mask):
    info = mask_geometry(mask)
    y, x = np.nonzero(mask)
    left, top, right, bottom = int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    ridges = distance[(distance >= cv2.dilate(distance, np.ones((3, 3), np.uint8))-.01) & (distance >= 2)]
    if not len(ridges):
        ridges = distance[distance > 0]
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    perimeter = sum(cv2.arcLength(c, True) for c in contours)
    return dict(box=[left, top, right, bottom], width=right-left, height=bottom-top,
                centroid=[float(x.mean()), float(y.mean())],
                opticalCenter=[.65*(left+right-1)/2+.35*float(x.mean()), .65*(top+bottom-1)/2+.35*float(y.mean())],
                # Effective stroke width is a stable area/perimeter proxy, not semantic stem detection.
                strokeWidth=float(2*mask.sum()/max(perimeter, 1)),
                strokeContrast=float(np.percentile(ridges, 90)/max(1, np.percentile(ridges, 25))),
                components=info['components'], holes=info['holes'])


def glyph_alignment(char, mask, cell, options):
    """Explicit script metrics, not OCR: preserve CJK aspect, Latin case and descenders."""
    m = ink_metrics(mask)
    unit = cell['emPixels']/1000
    cap, xheight = options.get('capHeight', 720), options.get('xHeight', 500)
    cjk = '\u3400' <= char <= '\u9fff'
    if not cjk and not (char.isascii() and char.isalnum()):
        raise ValueError('NORMALIZATION_SCRIPT: 逐字校正目前仅支持中文及 A–Z/a–z')
    body, desc = m, 0
    if cjk:
        group, desired, measured = 'cjk', options.get('cjkExtent', 720)*unit, max(m['width'], m['height'])
        anchor_y, target_y = m['opticalCenter'][1], cell['baseline']-options.get('cjkExtent', 720)*unit/2
    else:
        group = 'latin'
        desc = 200 if char in 'gjpqy' else 60 if char == 'Q' else 0
        height = cap if char.isupper() or char.isdigit() or char in 'bdfhkl' else cap*.86 if char == 't' else xheight
        if char in 'ij':
            # The detached dot is preserved but must not define x-height or baseline.
            count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
            if count > 2:
                body = ink_metrics((labels == (1+int(np.argmax(stats[1:, cv2.CC_STAT_AREA])))).astype('uint8'))
        desired, measured = (height+desc)*unit, body['height']
        anchor_y, target_y = body['box'][3]-1, cell['baseline']+desc*unit
    return dict(group=group, size=measured, targetSize=desired, anchorY=anchor_y, targetY=target_y,
                centerX=m['opticalCenter'][0], targetX=cell['originX']+cell['emPixels']/2,
                descender=desc, metrics=m)


def topology(mask):
    m = ink_metrics(mask)
    return m['components'], m['holes']


def place_glyph(mask, char, cell, options, resize=True):
    a = glyph_alignment(char, mask, cell, options)
    scale = a['targetSize']/a['size'] if resize and options.get('size', True) else 1
    if not .6 <= scale <= 1.6:
        raise ValueError('NORMALIZATION_SCALE: 字形大小偏离目标过多，请检查格子或调整目标尺寸')
    x = a['targetX'] if options.get('center', True) else a['centerX']
    y = a['targetY'] if options.get('baseline', True) else a['anchorY']
    matrix = np.float32([[scale, 0, x-scale*a['centerX']], [0, scale, y-scale*a['anchorY']]])
    # Supersampling permits subpixel translations without integer-pixel jumps.
    high = cv2.resize(mask.astype('float32'), None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    expected = topology(mask)
    # A quarter-pixel raster phase can retain a narrow counter without filling or deleting ink.
    for dx, dy in ((0, 0), (-.25, 0), (.25, 0), (0, -.25), (0, .25), (-.25, .25), (.25, -.25), (-.25, -.25), (.25, .25)):
        high_matrix = matrix.copy()
        high_matrix[:, 2] = 4*(matrix[:, 2]+[dx, dy])+1.5*(1-scale)
        moved = cv2.warpAffine(high, high_matrix, (mask.shape[1]*4, mask.shape[0]*4), flags=cv2.INTER_LINEAR)
        result = (cv2.resize(moved, (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_AREA) >= .5).astype('uint8')
        try:
            if topology(result) == expected:
                return result, dict(scale=scale, translateX=float(matrix[0, 2])+dx, translateY=float(matrix[1, 2])+dy,
                                    rasterPhase=[dx, dy])
        except ValueError:
            pass
    raise ValueError('NORMALIZATION_TOPOLOGY: 大小或位置校正会改变点画或字腔，保留原字待审阅')


def balance_weight(mask, target):
    """Bounded contour offset; reject merges, lost dots/counters and contrast changes."""
    current = ink_metrics(mask)['strokeWidth']
    best, best_error, offset = mask, abs(current-target), 0
    high = cv2.resize(mask, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    inside = cv2.distanceTransform(high, cv2.DIST_L2, 5)
    outside = cv2.distanceTransform(1-high, cv2.DIST_L2, 5)
    direction = 1 if target > current else -1
    original_metrics = ink_metrics(mask)
    original_topology = topology(mask)
    for delta in (.25, .5, .75, 1, 1.25, 1.5):
        if delta*2 > current*.2:
            break
        candidate = (outside <= delta*4).astype('uint8') if direction > 0 else (inside > delta*4).astype('uint8')
        candidate = (cv2.resize(candidate.astype('float32'), (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_AREA) >= .5).astype('uint8')
        try:
            m = ink_metrics(candidate)
        except ValueError:
            continue
        if (m['components'], m['holes']) != original_topology:
            continue
        if abs(m['strokeContrast']/original_metrics['strokeContrast']-1) > .15:
            continue
        error = abs(m['strokeWidth']-target)
        if error < best_error-.05:
            best, best_error, offset = candidate, error, direction*delta
    return best, offset


def normalize_glyphs(items, options, out):
    targets, groups = {}, {}
    for item in items:
        original, cell = item['mask'], item['cell']
        record = dict(before=ink_metrics(original), warnings=[], status='corrected')
        item['normalization'] = record
        try:
            item['mask'], record['transform'] = place_glyph(original, cell['character'], cell, options)
            a = glyph_alignment(cell['character'], item['mask'], cell, options)
            groups.setdefault(a['group'], []).append(ink_metrics(item['mask'])['strokeWidth']/cell['emPixels']*1000)
            record['group'] = a['group']
        except ValueError as exc:
            record.update(status='needs_review', warnings=[str(exc)], transform=dict(scale=1, translateX=0, translateY=0))
        item['originalMask'] = original
    for group, widths in groups.items():
        targets[group] = options.get('strokeWidth', float(np.median(widths)))
    for item in items:
        record, mask, cell = item['normalization'], item['mask'], item['cell']
        if record['status'] == 'corrected':
            target = targets[record['group']]*cell['emPixels']/1000
            record.update(targetStrokeWidth=target, weightOffsetPixels=0)
            if options.get('weight', True):
                balanced, offset = balance_weight(mask, target)
                try:
                    item['mask'], placement = place_glyph(balanced, cell['character'], cell, options, resize=False)
                    record.update(weightOffsetPixels=offset, finalPlacement=placement)
                except ValueError as exc:
                    record['warnings'].append(str(exc))
            a = glyph_alignment(cell['character'], item['mask'], cell, options)
            if options.get('weight', True) and abs(a['metrics']['strokeWidth']-target) > max(1, target*.15):
                record['warnings'].append('WEIGHT_LIMIT: 为保留笔形，剩余字重差异未强行消除')
        try:
            a = glyph_alignment(cell['character'], item['mask'], cell, options)
            before = glyph_alignment(cell['character'], item['originalMask'], cell, options)
            target = targets.get(a['group'], before['metrics']['strokeWidth']/cell['emPixels']*1000)*cell['emPixels']/1000
            def errors(value):
                return dict(center=abs(value['centerX']-value['targetX']), baseline=abs(value['anchorY']-value['targetY']),
                            size=abs(value['size']-value['targetSize']), weight=abs(value['metrics']['strokeWidth']-target))
            record.update(beforeErrorPixels=errors(before), afterErrorPixels=errors(a))
        except ValueError:
            pass  # Unsupported scripts are explicitly retained with needs_review above.
        record['after'] = ink_metrics(item['mask'])
        if record['warnings']:
            record['status'] = 'needs_review'
    artifacts = []
    # Each glyph gets identical framing in both columns, including baseline guides.
    for start in range(0, len(items), 24):
        subset = items[start:start+24]
        sheet = Image.new('RGB', (1152, math.ceil(len(subset)/4)*178+36), '#f7f5ef')
        draw = ImageDraw.Draw(sheet)
        draw.text((16, 10), 'BEFORE  /  AFTER   - same frame; blue guide = baseline', fill='#344651')
        for i, item in enumerate(subset):
            x, y = (i%4)*288, 36+(i//4)*178
            for j, mask in enumerate((item['originalMask'], item['mask'])):
                tile = Image.fromarray(np.where(mask, 28, 255).astype('uint8')).convert('RGB').resize((136, 136), Image.Resampling.LANCZOS)
                sheet.paste(tile, (x+j*140, y))
                baseline = y+round(item['cell']['baseline']/mask.shape[0]*136)
                draw.line((x+j*140, baseline, x+j*140+135, baseline), fill='#92bcc7')
            draw.text((x+6, y+140), f"U+{ord(item['cell']['character']):04X}  {item['normalization']['status']}", fill='#344651')
        name = f'normalization-{start//24}.png'
        sheet.save(out / name)
        artifacts.append(artifact(out, name, 'image/png'))
    return artifacts, targets


def process_atlases(job, out):
    previous = job.get('previous')
    if previous:
        reader = UFOReader(previous['source'])
        old_set = reader.getGlyphSet()
        for record in previous['glyphs']:
            if hashlib.sha256(old_set.getGLIF(record['id'])).hexdigest() != record['sha256']:
                raise ValueError('SOURCE_CHANGED: 已有轮廓摘要不一致')
        reader.close()
        shutil.copytree(previous['source'], out / 'source.ufo')
    writer = UFOWriter(out / 'source.ufo', formatVersion=3)
    options = job.get('normalization', {})
    writer.writeInfo(SimpleNamespace(familyName=job['name'], styleName='Regular', unitsPerEm=1000,
                                    ascender=900, descender=-300, xHeight=options.get('xHeight', 500), capHeight=options.get('capHeight', 720)))
    glyphset = writer.getGlyphSet()
    replaced = {cell['character'] for atlas in job['atlases'] for cell in atlas['page']['cells']}
    glyphs = [g for g in previous['glyphs'] if g['character'] not in replaced] if previous else []
    atlases, errors, artifacts, seen, items = [], [], [], set(), []
    total = sum(len(a['page']['cells']) for a in job['atlases'])
    for atlas in job['atlases']:
        image = load_image(atlas['source'])
        try:
            corrected, transform = align(image, atlas['page'], atlas.get('corners'))
        except ValueError as exc:
            errors.append(dict(atlasId=atlas['id'], code=str(exc).split(':')[0], message=str(exc)))
            continue
        corrected_name = f"corrected-{atlas['id']}.png"
        Image.fromarray(corrected).save(out / corrected_name)
        artifacts.append(artifact(out, corrected_name, 'image/png'))
        atlases.append(dict(atlasId=atlas['id'], sourceHash=atlas['sha256'], transform=transform))
        for cell in atlas['page']['cells']:
            char, stem = cell['character'], cell['id']
            if char in seen:
                raise ValueError('DUPLICATE_GLYPH: 同一候选中字符重复')
            seen.add(char)
            x0, y0, x1, y1 = cell['box']
            try:
                if atlas['page'].get('layout') == 'recognized':
                    mask, geometry = recognized_mask(corrected, cell['box'], job['background'], job.get('threshold', 128))
                else:
                    mask, geometry = mask_from_cell(corrected[y0:y1, x0:x1], job['background'], job.get('threshold', 128))
                items.append(dict(cell=cell, atlas=atlas, mask=mask, geometry=geometry))
            except ValueError as exc:
                errors.append(dict(character=char, atlasId=atlas['id'], code=str(exc).split(':')[0], message=str(exc)))
            progress('切格', len(items)+len(errors), total)
    normalization = None
    if 'normalization' in job and items:
        progress('逐字校正', 0, len(items))
        comparisons, targets = normalize_glyphs(items, job['normalization'], out)
        artifacts.extend(comparisons)
        normalization = dict(options=job['normalization'], targetStrokeWidthEm=targets,
                             needsReview=[i['cell']['character'] for i in items if i['normalization']['status'] == 'needs_review'])
    for item in items:
        cell, atlas, mask = item['cell'], item['atlas'], item['mask']
        char, stem = cell['character'], cell['id']
        try:
            Image.fromarray((mask*255).astype('uint8')).save(out / f'{stem}.png')
            pen, bounds = trace(mask, stem, out, job['potrace'], cell)
            advance, shift = 1000, 0
            if char.isascii() and char.isalpha():
                optical = 0
                if 'normalization' in job and job['normalization'].get('center', True):
                    m = ink_metrics(mask)
                    optical = np.clip((m['centroid'][0]-(m['box'][0]+m['box'][2]-1)/2)*1000/cell['emPixels']*.35, -24, 24)
                shift = 48 - bounds[0] - float(optical)
                moved = RecordingPen()
                pen.replay(TransformPen(moved, (1, 0, 0, 1, shift, 0)))
                pen = moved
                advance = round(bounds[2] - bounds[0] + 96)
            if bounds[1] < -300 or bounds[3] > 900 or bounds[0] < -125 or bounds[2] > 1125:
                raise ValueError('METRICS_BOUNDS: 字形超出模板指标范围，请调整素材位置')
            glyph = SimpleNamespace(width=advance, unicodes=[ord(char)])
            glyphset.writeGlyph(stem, glyph, lambda pointpen, p=pen: p.replay(SegmentToPointPen(pointpen)))
            glif_hash = hashlib.sha256(glyphset.getGLIF(stem)).hexdigest()
            geometry = ink_metrics(mask) if normalization is not None else item['geometry']
            glyphs.append(dict(character=char, id=stem, sha256=glif_hash, advance=advance,
                               geometry=dict(status='pass', **geometry), identity='unverified', style='unreviewed',
                               **({'normalization':item['normalization']} if 'normalization' in item else {}),
                               source=dict(atlasId=atlas['id'], sha256=atlas['sha256'], box=cell['box'],
                                           baseline=cell['baseline'], emPixels=cell['emPixels'], bearingShift=shift)))
        except ValueError as exc:
            errors.append(dict(character=char, atlasId=atlas['id'], code=str(exc).split(':')[0], message=str(exc)))
        progress('描图', len(seen.intersection(g['character'] for g in glyphs))+len(errors), total)
    glyphset.writeContents()
    writer.writeLayerContents()
    writer.close()
    order = {char:i for i,char in enumerate(job['characters'])}
    glyphs.sort(key=lambda glyph: order[glyph['character']])
    missing = [c for c in job['characters'] if c not in {g['character'] for g in glyphs}]
    report = dict(version=VERSION, glyphs=glyphs, atlases=atlases, errors=errors, missing=missing,
                  geometry='pass' if not errors and not missing else 'needs_review', identity='unverified', style='unreviewed',
                  normalization=normalization,
                  parameters=dict(background=job['background'], threshold=job.get('threshold', 128), turdsize=0, opttolerance=.15))
    save_json(out / 'report.json', report)
    artifacts.append(artifact(out, 'report.json', 'application/json'))
    return dict(report=report, artifacts=artifacts, source='source.ufo')


def build(job, out):
    source = Path(job['source'])
    reader = UFOReader(source)
    info = SimpleNamespace()
    reader.readInfo(info)
    glyphset = reader.getGlyphSet()
    glyphs, metrics, cmap = {}, {}, {32: 'space'}
    for name in ['.notdef', 'space']:
        glyphs[name] = TTGlyphPen(None).glyph()
        metrics[name] = (350, 0)
    for index, record in enumerate(job['glyphs']):
        char, name = record['character'], record['id']
        if hashlib.sha256(glyphset.getGLIF(name)).hexdigest() != record['sha256']:
            raise ValueError('SOURCE_CHANGED: 源轮廓摘要不一致')
        pen = TTGlyphPen(None)
        glyphset[name].draw(Cu2QuPen(pen, max_err=1))
        glyph = pen.glyph()
        glyph.recalcBounds(None)
        glyphs[name], metrics[name], cmap[ord(char)] = glyph, (record['advance'], glyph.xMin), name
        progress('编译', index+1, len(job['glyphs']))
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=900, descent=-300)
    psname = (re.sub('[^A-Za-z0-9-]', '', job['name']) or 'Tugou'+job['sourceRevision'][:8]) + '-Regular'
    builder.setupNameTable(dict(familyName=job['name'], styleName='Regular', uniqueFontIdentifier=psname+'-'+job['sourceRevision'],
                               fullName=job['name']+' Regular', psName=psname, version='Version 1.000'))
    builder.setupOS2(sTypoAscender=900, sTypoDescender=-300, usWinAscent=900, usWinDescent=300,
                     sxHeight=round(info.xHeight), sCapHeight=round(info.capHeight))
    builder.setupPost()
    builder.setupMaxp()
    builder.setupHead(created=3400000000, modified=3400000000)
    ttf = out / 'font.ttf'
    builder.save(ttf)
    font = TTFont(ttf, recalcTimestamp=False)
    expected = {ord(g['character']) for g in job['glyphs']}
    if not expected.issubset(font.getBestCmap()) or any(font['glyf'][font.getBestCmap()[n]].numberOfContours <= 0 for n in expected):
        raise ValueError('FONT_VALIDATION: 缺少字符映射或轮廓')
    font.flavor = 'woff2'
    font.save(out / 'font.woff2')
    if TTFont(out / 'font.woff2').getBestCmap() != font.getBestCmap():
        raise ValueError('FONT_VALIDATION: WOFF2 回读映射不一致')
    artifacts = [artifact(out, 'font.ttf', 'font/ttf'), artifact(out, 'font.woff2', 'font/woff2')]
    # Rendering uses this exact TTF: Pillow/FreeType does not fall back to a system font.
    face = ImageFont.truetype(str(ttf), 68)
    for start in range(0, len(job['glyphs']), 64):
        records = job['glyphs'][start:start+64]
        image = Image.new('RGB', (1280, 64+math.ceil(len(records)/8)*130), '#faf9f5')
        draw = ImageDraw.Draw(image)
        draw.text((24, 16), f"{job['name']} / actual exported TTF / page {start//64+1}", fill='#465469')
        for i, record in enumerate(records):
            x, y = 20+(i%8)*160, 100+(i//8)*130
            draw.text((x, y), record['character'], font=face, fill='#162334', anchor='ls')
            draw.text((x, y+24), f"U+{ord(record['character']):04X}", fill='#67788a')
        filename = f'proof-{start//64}.png'
        image.save(out / filename)
        artifacts.append(artifact(out, filename, 'image/png'))
    report = dict(version=VERSION, mode=job['mode'], sourceRevision=job['sourceRevision'], glyphCount=len(expected),
                  covered=''.join(g['character'] for g in job['glyphs']), missing=job['missing'],
                  unreviewed=job['unreviewed'], cmapRoundTrip=True, allOutlinesNonempty=True,
                  renderer='Pillow FreeType / exported font.ttf / no fallback', sourceRecords=job['glyphs'], reviews=job['reviews'])
    save_json(out / 'build-report.json', report)
    artifacts.append(artifact(out, 'build-report.json', 'application/json'))
    with zipfile.ZipFile(out / 'font-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_file():
                archive.write(file, 'source.ufo/'+file.relative_to(source).as_posix())
        archive.write(out / 'build-report.json', 'build-report.json')
        origins = []
        for original in job['originals']:
            data = Path(original['source']).read_bytes()
            if hashlib.sha256(data).hexdigest() != original['sha256']:
                raise ValueError('SOURCE_CHANGED: 打包原图摘要不一致')
            name = f"originals/{original['sha256']}.{original['format']}"
            if name not in archive.namelist():
                archive.writestr(name, data)
            origins.append({**{k:v for k,v in original.items() if k != 'source'}, 'file':name})
        archive.writestr('provenance.json', json.dumps(dict(originals=origins, processing=job['sourceReport']), ensure_ascii=False, indent=2))
    artifacts.append(artifact(out, 'font-source.zip', 'application/zip'))
    return dict(report=report, artifacts=artifacts)


def main():
    job = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = Path(job['output'])
    started = time.perf_counter()
    if job['operation'] == 'refine':
        import runpy
        refine = runpy.run_path(str(Path(__file__).with_name('font-outline.py')))['refine']
        result = refine(job, out, progress, artifact)
    else:
        if job['operation'] == 'recognize':
            import runpy
            recognize = runpy.run_path(str(Path(__file__).with_name('font-ocr.py')))['recognize']
            result = recognize(job, out, progress, artifact)
        else:
            result = {'plan': make_plan, 'process': process_atlases, 'build': build}[job['operation']](job, out)
    result['elapsedSeconds'] = round(time.perf_counter()-started, 3)
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        class MemoryCounters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in
                       ('peakWorkingSet', 'workingSet', 'peakPagedPool', 'pagedPool', 'peakNonPagedPool', 'nonPagedPool', 'pagefile', 'peakPagefile')]
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
        ctypes.windll.psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            result['peakWorkingSetBytes'] = counters.peakWorkingSet
    result['engine'] = dict(version=VERSION, python=platform.python_version(), opencv=cv2.__version__)
    save_json(out / 'result.json', result)
    progress('完成', 1, 1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not put arbitrary filenames/provider text into the task journal.
        print(json.dumps(dict(error=str(error)[:800]), ensure_ascii=True), flush=True)
        sys.exit(1)
