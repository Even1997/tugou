"""Static TrueType finishing with measured per-glyph topology protection."""
from pathlib import Path
import json
import math
import hashlib
from io import BytesIO
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen




class SamplePen(BasePen):
    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.contours = []
        self.points = []

    def _moveTo(self, point):
        self.points = [np.array(point, dtype=float)]

    def _lineTo(self, point):
        self.points.append(np.array(point, dtype=float))
        if len(self.points) > 60000:
            raise ValueError('RESOURCE_LIMIT: 字形轮廓过于复杂')

    def _qCurveToOne(self, control, end):
        a, b, c = self.points[-1], np.array(control), np.array(end)
        steps = max(2, math.ceil((np.linalg.norm(b-a)+np.linalg.norm(c-b))/2))
        if steps > 60000 or len(self.points)+steps > 60000:
            raise ValueError('RESOURCE_LIMIT: 字形轮廓过于复杂')
        for t in np.linspace(0, 1, steps+1)[1:]:
            self.points.append((1-t)**2*a+2*(1-t)*t*b+t*t*c)

    def _curveToOne(self, one, two, end):
        a, b, c, d = self.points[-1], np.array(one), np.array(two), np.array(end)
        steps = max(3, math.ceil((np.linalg.norm(b-a)+np.linalg.norm(c-b)+np.linalg.norm(d-c))/2))
        if steps > 60000 or len(self.points)+steps > 60000:
            raise ValueError('RESOURCE_LIMIT: 字形轮廓过于复杂')
        for t in np.linspace(0, 1, steps+1)[1:]:
            self.points.append((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d)

    def _closePath(self):
        points = np.array(self.points)
        if np.linalg.norm(points[-1]-points[0]) < .001:
            points = points[:-1]
        assert len(points) >= 3
        self.contours.append(points)

    _endPath = _closePath


def area(points):
    return .5*np.sum(points[:, 0]*np.roll(points[:, 1], -1)-points[:, 1]*np.roll(points[:, 0], -1))


def resample(points):
    closed = np.vstack([points, points[0]])
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    distances = np.r_[0, np.cumsum(lengths)]
    length = distances[-1]
    count = max(16, math.ceil(length/6))
    if not 0 < length or count > 30000:
        raise ValueError('RESOURCE_LIMIT: 轮廓长度超限')
    positions = np.linspace(0, length, count, endpoint=False)
    sampled = np.column_stack([np.interp(positions, distances, closed[:, i]) for i in (0, 1)])
    return sampled, length/count


def smooth_and_expand(contours, sigma, expansion):
    outer_sign = np.sign(area(max(contours, key=lambda p: abs(area(p)))))
    output = []
    for points in contours:
        points, spacing = resample(points)
        # Tiny counters keep their own radius instead of collapsing to their centre.
        radius = min(sigma/spacing, len(points)/16)
        frequencies = np.fft.fftfreq(len(points))
        kernel = np.exp(-.5*(2*np.pi*frequencies*radius)**2)
        smooth = np.fft.ifft(np.fft.fft(points, axis=0)*kernel[:, None], axis=0).real
        tangent = np.roll(smooth, -1, axis=0)-np.roll(smooth, 1, axis=0)
        normals = np.column_stack([tangent[:, 1], -tangent[:, 0]])
        normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], .0001)
        output.append(smooth+outer_sign*expansion*normals)
    return output


def draw_curves(contours, pen):
    for points in contours:
        pen.moveTo(tuple(points[0]))
        for i in range(len(points)):
            a, b = points[i], points[(i+1) % len(points)]
            c1 = a+(b-points[(i-1) % len(points)])/6
            c2 = b-(points[(i+2) % len(points)]-a)/6
            pen.curveTo(tuple(c1), tuple(c2), tuple(b))
        pen.closePath()


def topology(mask):
    count = cv2.connectedComponents(mask, connectivity=8)[0]-1
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    holes = 0
    for index in range(len(contours)):
        parent, depth = hierarchy[0][index][3], 0
        while parent >= 0:
            depth += 1
            parent = hierarchy[0][parent][3]
        holes += depth % 2
    return count, holes


def render(face, char):
    x0, y0, x1, y1 = face.getbbox(char)
    width, height = x1-x0+32, y1-y0+32
    if min(width, height) <= 32 or width*height > 16000000 or max(width, height) > 6000:
        raise ValueError('FONT_VALIDATION: 空字形或字形范围超限')
    canvas = Image.new('L', (width, height), 0)
    ImageDraw.Draw(canvas).text((16-x0, 16-y0), char, font=face, fill=255)
    return (np.array(canvas) >= 128).astype('uint8')


def refine(job, out, progress, artifact):
    source = Path(job['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest() != job['sourceSha256']:
        raise ValueError('SOURCE_CHANGED: 字体摘要不一致')
    smoothing, bold = job.get('smoothing', 14), job.get('bold', 4)
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
           or not 0 <= v <= maximum for v, maximum in [(smoothing, 24), (bold, 12)]):
        raise ValueError('INVALID_ARGUMENT: 精修参数超限')
    original = TTFont(source, recalcTimestamp=False)
    if 'glyf' not in original or any(t in original for t in ('fvar', 'COLR', 'SVG ')):
        raise ValueError('UNSUPPORTED_FONT: 仅支持静态黑白 TrueType 轮廓')
    cmap = original.getBestCmap() or {}
    characters = list(job['characters'])
    if not 1 <= len(characters) <= 65533 or set(map(ord, characters)) != set(cmap)-{32}:
        raise ValueError('CHARSET_MISMATCH: 字体字符集须与待处理范围一致（空格除外），超过 TrueType 字形容量时需拆为多个字体')
    if len(original.getGlyphOrder()) > 8192:
        raise ValueError('RESOURCE_LIMIT: 字体内部字形超过 8192')
    unit = original['head'].unitsPerEm/1000
    glyphset = original.getGlyphSet()
    contours, names = {}, list(dict.fromkeys(cmap[ord(c)] for c in characters))
    for name in names:
        pen = SamplePen(glyphset)
        glyphset[name].draw(pen)
        if not pen.contours or sum(map(len, pen.contours)) > 120000:
            raise ValueError('FONT_VALIDATION: 空轮廓或字形复杂度超限')
        # Work in 1000/em so parameters mean the same across font UPM sizes.
        contours[name] = [p/unit for p in pen.contours]
    source_face = ImageFont.truetype(BytesIO(source.read_bytes()), 1200)
    expected = {}
    for i, char in enumerate(characters):
        mask = render(source_face, char)
        expected[char] = topology(mask), int(mask.sum())
        progress('检查原始字形', i+1, len(characters))
    options = list(dict.fromkeys((s, b) for s in (smoothing, smoothing/2, smoothing/4, 0)
                                 for b in (bold, bold/2, bold/4, 0)))
    choices = dict.fromkeys(names, 0)
    font = TTFont(source, recalcTimestamp=False)
    for tag in ('DSIG', 'fpgm', 'prep', 'cvt ', 'hdmx', 'LTSH'):
        if tag in font:
            del font[tag]
    family = job['name']+' Refined'
    psname = (''.join(c for c in job['name'] if c.isascii() and c.isalnum()) or 'Tugou'+job['sourceSha256'][:8])+'-Refined'
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16):
            value = psname if record.nameID == 6 else family
            record.string = value.encode(record.getEncoding(), errors='replace')
    output = out/'font.ttf'
    drawn, validated = {}, {}
    for attempt in range(len(options)):
        for name in names:
            if drawn.get(name) == choices[name]:
                continue
            drawn[name] = choices[name]
            params = options[choices[name]]
            if params == (0, 0):
                font['glyf'][name] = original['glyf'][name]
                continue
            pen = TTGlyphPen(None)
            paths = [p*unit for p in smooth_and_expand(contours[name], *params)]
            draw_curves(paths, Cu2QuPen(pen, max_err=.35*unit))
            font['glyf'][name] = pen.glyph()
        font.save(output)
        face = ImageFont.truetype(BytesIO(output.read_bytes()), 1200)
        failed, records = set(), []
        for i, char in enumerate(characters):
            name = cmap[ord(char)]
            cached = validated.get(char)
            if cached and cached[0] == choices[name]:
                records.append(cached[1])
                continue
            mask = render(face, char)
            before_structure, before_area = expected[char]
            after_structure = topology(mask)
            delta = int(mask.sum())/before_area-1
            applied = options[choices[name]]
            passed = after_structure == before_structure and -.025 < delta < .14
            if not passed:
                failed.add(name)
            records.append(dict(character=char,codepoint=f'U+{ord(char):04X}',
                                smoothing=applied[0],bold=applied[1],inkAreaChange=round(delta,6),
                                beforeTopology=list(before_structure),afterTopology=list(after_structure),
                                topologyPass=after_structure==before_structure,
                                limited=applied!=(smoothing,bold),unchanged=applied==(0,0)))
            if passed:
                validated[char] = (choices[name], records[-1])
            progress(f'平滑加粗检查 · 第 {attempt+1} 轮', i+1, len(characters))
        if not failed:
            break
        for name in failed:
            choices[name] += 1
            if choices[name] >= len(options):
                raise ValueError('FONT_VALIDATION: 无法保留原字形结构')
    else:
        raise ValueError('FONT_VALIDATION: 精修未收敛')
    final = TTFont(BytesIO(output.read_bytes()), recalcTimestamp=False)
    # Widen clipping limits only; preserve advances, bearings and layout baselines.
    final['OS/2'].usWinAscent = max(final['OS/2'].usWinAscent, final['head'].yMax)
    final['OS/2'].usWinDescent = max(final['OS/2'].usWinDescent, -final['head'].yMin)
    final.save(output)
    if final.getBestCmap() != cmap or final['hmtx'].metrics != original['hmtx'].metrics:
        raise ValueError('FONT_VALIDATION: 字符映射或字宽改变')
    final.flavor = 'woff2'
    final.save(out/'font.woff2')
    web = TTFont(out/'font.woff2')
    if web.getBestCmap() != cmap or web['hmtx'].metrics != final['hmtx'].metrics or any(
        web['glyf'][n].getCoordinates(web['glyf'])[0] != final['glyf'][n].getCoordinates(final['glyf'])[0]
        for n in names):
        raise ValueError('FONT_VALIDATION: WOFF2 回读不一致')
    artifacts = [artifact(out,'font.ttf','font/ttf'), artifact(out,'font.woff2','font/woff2'),
                 artifact(out,'input.ttf','font/ttf')]
    before, after = [ImageFont.truetype(BytesIO(p.read_bytes()), 86) for p in (source, output)]
    for start in range(0, len(characters), 32):
        subset = characters[start:start+32]
        image = Image.new('RGB', (1280, 70+math.ceil(len(subset)/4)*152), '#faf9f5')
        draw = ImageDraw.Draw(image)
        draw.text((24,20),'Actual TTF / each pair: BEFORE -> AFTER / '+family,fill='#465469')
        for i, char in enumerate(subset):
            x,y = 20+i%4*320, 165+i//4*152
            for dx, face in [(0,before),(150,after)]:
                draw.text((x+dx,y),char,font=face,fill='#172434',anchor='ls')
            draw.text((x,y+20),f'U+{ord(char):04X}  BEFORE       AFTER',fill='#67788a')
        filename = f'comparison-{start//32}.png'
        image.save(out/filename)
        artifacts.append(artifact(out,filename,'image/png'))
    report = dict(version='outline-1',glyphCount=len(characters),parameters=dict(smoothing=smoothing,bold=bold,units='1/1000 em'),
                  sourceSha256=job['sourceSha256'],sourceJobId=job.get('sourceJobId'),
                  topologyPass=sum(r['topologyPass'] for r in records),metricsUnchanged=True,woff2RoundTrip=True,
                  limitedCount=sum(r['limited'] for r in records),unchangedCount=sum(r['unchanged'] for r in records),
                  identity='unverified',style='unreviewed',glyphs=records,
                  validation='1200px FreeType, threshold 128, 8-connected components and nested holes; not semantic validation')
    (out/'refinement.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    artifacts.append(artifact(out,'refinement.json','application/json'))
    return dict(report=report,artifacts=artifacts)



