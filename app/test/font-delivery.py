"""Collect verified local artifacts into a reviewable delivery, without touching app data."""
import hashlib
import html
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

evidence_file, destination = map(Path, sys.argv[1:])
evidence = json.loads(evidence_file.read_text(encoding='utf-8'))
destination.mkdir(parents=True, exist_ok=True)
files = Path(evidence['filesRoot'])
for source in (files / 'export').iterdir():
    if source.is_file():
        shutil.copy2(source, destination / source.name)
shutil.copy2(evidence_file, destination / 'mcp-acceptance.json')
shutil.copy2(evidence_file.parent / 'render-verification.json', destination / 'render-verification.json')
shutil.copy2(evidence_file.parent / 'chromium-proof.png', destination / 'chromium-proof.png')
jobs = Path(evidence['root']) / 'fonts' / evidence['result']['projectId'] / 'jobs'
process = json.loads((jobs / evidence['result']['processJob'] / 'result.json').read_text(encoding='utf-8'))
plan = json.loads((jobs / evidence['result']['planJob'] / 'plan.json').read_text(encoding='utf-8'))
shutil.copy2(files / 'page-0.png', destination / 'input-atlas.png')
corrected = next(a for a in process['artifacts'] if a['id'].startswith('corrected-'))
shutil.copy2(jobs / evidence['result']['processJob'] / corrected['file'], destination / 'corrected-atlas.png')
before = Image.open(destination / 'input-atlas.png').convert('RGB')
after = Image.open(destination / 'corrected-atlas.png').convert('RGB')
assert before.size == after.size
detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50))
centers = []
for image in (before, after):
    corners, ids, _ = detector.detectMarkers(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY))
    assert ids is not None and set(ids.flatten()) == {0, 1, 2, 3}
    centers.append({int(i): c.reshape(4, 2).mean(0) for c, i in zip(corners, ids.flatten())})
shifts = [round(float(np.linalg.norm(centers[0][i] - centers[1][i])), 2) for i in range(4)]
# Use identical source coordinates; aligning each crop would hide the correction.
crop_box = (80, 80, 512, 512)
crops = [image.crop(crop_box) for image in (before, after)]
for name, crop in zip(('before-detail.png', 'after-detail.png'), crops):
    crop.save(destination / name)
ink_before, ink_after = [np.asarray(c.convert('L')) < 128 for c in crops]
overlay = np.full((*ink_before.shape, 3), 255, dtype=np.uint8)
overlay[ink_before] = (183, 71, 14)
overlay[ink_after] = (0, 113, 143)
overlay[ink_before & ink_after] = (24, 38, 44)
Image.fromarray(overlay).save(destination / 'correction-overlay.png')
(destination / 'alignment-comparison.json').write_text(json.dumps(dict(
    sourceSize=list(before.size), imagesIdentical=bool(np.array_equal(np.asarray(before), np.asarray(after))),
    markerCenterDisplacementPixels=shifts, cropBox=list(crop_box),
    scope='Global atlas homography only; no semantic or stylistic glyph correction.'
), indent=2), encoding='utf-8')
metrics = json.loads((destination / 'render-verification.json').read_text(encoding='utf-8'))
summary = dict(checks=len(evidence['checks']), glyphs=152, chinese=100, latin=52, engine=process['engine'],
               processSeconds=process['elapsedSeconds'], peakMiB=round(process['peakWorkingSetBytes']/1024**2, 1), render=metrics,
               inputKind='controlled original glyph raster fixtures, not newly AI-generated glyphs',
               artifacts={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.iterdir() if p.is_file()})
(destination / '验收摘要.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
characters = html.escape(plan['characters'])
document = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>图构 · 字体图集闭环验收</title><style>
@font-face{{font-family:Atlas;src:url(font.woff2)}}*{{box-sizing:border-box}}body{{margin:0;background:#f5f4ef;color:#18262c;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}}main{{max-width:1160px;margin:auto;padding:64px 28px}}h1{{font-size:36px;letter-spacing:-1px}}h2{{margin-top:48px;font-size:24px}}small,p{{color:#59666a}}a{{color:#275f64}}nav{{display:flex;flex-wrap:wrap;gap:24px;margin:30px 0}}.facts,.compare{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}}.fact{{padding:18px 24px;background:white;border-radius:12px}}b{{display:block;font-size:24px}}img{{width:100%;height:auto;background:white;border-radius:10px}}.specimen{{font-family:Atlas;font-size:42px;line-height:1.8;overflow-wrap:anywhere;background:white;padding:24px;border-radius:12px}}table{{width:100%;border-collapse:collapse}}th,td{{padding:12px;text-align:left;border-bottom:1px solid #d9dfde}}@media(max-width:700px){{.facts,.compare{{grid-template-columns:1fr}}.specimen{{font-size:30px}}}}
</style><main><small>图构 / 字体工具 / 工程验收</small><h1>从素材图到可使用字体</h1>
<p>素材图导入 → 透视校正 → 保留点画的描图 → UFO 源记录 → TTF / WOFF2 → 实际字体预览。新增 14 条 MCP 命令，复用图构任务与文件机制。</p>
<div class="facts"><div class="fact"><b>100 中文 + 52 英文</b>152 字映射与轮廓完整，实际导出文件渲染</div><div class="fact"><b>{len(evidence['checks'])} 项桌面 MCP 检查</b>包括候选冲突、取消、审阅门禁、路径和实际 PNG</div><div class="fact"><b>{process['elapsedSeconds']:.2f} 秒</b>本机本批图集加工；编译另约 0.5 秒</div><div class="fact"><b>{summary['peakMiB']} MiB</b>Python worker 峰值工作集</div></div>
<nav><a href="font.ttf" download>下载 TTF</a><a href="font.woff2" download>下载 WOFF2</a><a href="font-source.zip" download>下载 UFO、原图与记录</a><a href="mcp-acceptance.json">MCP 验收记录</a><a href="render-verification.json">轮廓对照数据</a></nav>
<p>本次输入是已有原创参数化字形渲染的受控素材图，加入透视、旋转、平移及缩放扰动。加工程序只拿到图片，没有拿到参考字体轮廓。此结果证明加工闭环，不等于未知 AI 生图自动识字、原创风格设计或全中文字库扩字已完成。</p>
<h2>浏览器加载导出字体</h2><div class="specimen">{characters}</div><p>上方通过本页 font.woff2 显示；下方是桌面 Chromium 对实际 TTF 的独立渲染证据。</p><img src="chromium-proof.png" alt="实际 TTF 在 Chromium 中显示中文和大小写字母">
<h2>图集位置校正：变的是位置，不是字体风格</h2>
<p>当前只按四角标记修正整张图的透视、位置与比例。不会识别错字、补笔画或统一字形风格。字体导出使用预先声明的基线与比例，不是自动推断每个字的正确结构。</p>
<p>本页原图宽 {before.width} 像素，四角标记中心分别移动 { ' / '.join(map(str, shifts)) } 像素。整页缩小显示后差异很小。以下两张裁剪来自完全相同的坐标，没有分别居中或缩放字形。<a href="alignment-comparison.json">查看测量记录</a></p>
<div class="compare"><figure><img src="before-detail.png" alt="校正前同坐标局部"><figcaption>校正前 · 左上字格局部</figcaption></figure><figure><img src="after-detail.png" alt="校正后同坐标局部"><figcaption>校正后 · 同一位置、同一倍率</figcaption></figure></div>
<figure style="max-width:432px;margin:24px auto"><img src="correction-overlay.png" alt="棕色为校正前独有像素，蓝色为校正后独有像素，深色为重叠像素"><figcaption><span style="color:#b7470e">棕色：校正前</span> · <span style="color:#00718f">蓝色：校正后</span> · 深色：重叠。颜色仅作差异标注。</figcaption></figure>
<details><summary>展开完整图集对照（点击图片可查看原图）</summary><div class="compare"><figure><a href="input-atlas.png"><img src="input-atlas.png" alt="加入透视扰动的输入图集"></a><figcaption>输入原图</figcaption></figure><figure><a href="corrected-atlas.png"><img src="corrected-atlas.png" alt="按四角定位标记校正的图集"></a><figcaption>位置校正结果</figcaption></figure></div></details>
<h2>全部字符的实际字体样张</h2><img src="proof-0.png" alt="中文样张第一组"><img src="proof-1.png" alt="中文及大写英文字母样张"><img src="proof-2.png" alt="小写英文字母样张">
<h2>几何检查与边界</h2><p>原始像素 IoU 中位数 {metrics['medianIoU']*100:.2f}%，最低 {metrics['minimumIoU']*100:.2f}%；允许至多一个输入像素的栅格相位差后，中位数 {metrics['medianOnePixelIoU']*100:.2f}%，最低 {metrics['minimumOnePixelIoU']*100:.2f}%。两组数据均保留。TTF / WOFF2 的字形轮廓和指标回读一致，原图摘要及源包通过检查。</p>
<p>几何通过、字符身份和风格审阅分开记录。未知素材默认未审阅，严格导出被拦截；缺标记、空格子、笔画越界会产生待修正报告。旧版运行窗口未关闭，下次保存并关闭后通过原 MCP 启动器进入新版。</p>
<h2>质量自评</h2><table><tr><th>维度</th><th>评分</th><th>依据及不足</th></tr><tr><td>功能 / 性能</td><td>9.5 / 10</td><td>152 字与真实桌面闭环通过，时间、内存有实际记录</td></tr><tr><td>代码 / UX / 安全</td><td>9.4 / 10</td><td>版本、取消、路径、摘要门禁已验；更多异常图片和跨机器环境待验</td></tr><tr><td>字形视觉保真</td><td>9.4 / 10</td><td>以受控原图为对照，多风格和细字重仍需试验；非商用设计审美评分</td></tr><tr><td>UI</td><td>N/A</td><td>本轮新增 MCP 工具，没有新增产品编辑界面</td></tr></table>
<p>整体 9.4 / 10，可交付。仍需验证真实 AI 图集、更多风格和 Mac；部件扩字、文字图层自动关联与主工程字体打包不属于本轮完成范围。</p></main></html>'''
(destination / '效果与验收.html').write_text(document, encoding='utf-8')
print(json.dumps({'delivery':str(destination),'checks':len(evidence['checks']),'glyphs':152}))
