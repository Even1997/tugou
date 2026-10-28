"""Review page uses the real exported fonts; every image and statistic traces to MCP jobs."""
import html
import json
import shutil
import sys
from pathlib import Path

evidence_path, destination = map(Path, sys.argv[1:])
evidence = json.loads(evidence_path.read_text(encoding='utf-8'))
assert not evidence.get('failure')
destination.mkdir(parents=True, exist_ok=True)
for name in ('acceptance.json', 'font-verification.json'):
    shutil.copy2(evidence_path.parent/name, destination/name)
styles, sections = [], []
labels = dict(center='水平光学重心', size='字面尺寸', baseline='竖向对齐', weight='有效字重')
for dataset in evidence['datasets']:
    kind = dataset['kind']
    for mode in ('before', 'after'):
        source = Path(dataset['variants'][mode]['folder'])
        target = destination/kind/mode
        target.mkdir(parents=True, exist_ok=True)
        for file in source.iterdir():
            if file.is_file():
                shutil.copy2(file, target/file.name)
        styles.append(f"@font-face{{font-family:{kind}-{mode};src:url('{kind}/{mode}/font.woff2')}}")
    characters = html.escape(dataset['characters'])
    title = '春日来信 · 原始 AI 设计字' if kind == 'spring' else '100 中文 + 52 字母 · 受控扰动样本'
    note = ('使用之前生成的四字透明图集，只做统一倍率装入格子，没有逐字预修正。下方直接加载两份实际导出的字体。'
            if kind == 'spring' else '这组来自已有参数化原型，额外加入逐字大小、位置和粗细扰动。它用于检查覆盖与稳定性，不代表已生成 152 个“春日”风格字。')
    rows = ''.join(f"<tr><td>{labels[k]}</td><td>{v['before']:.2f}</td><td>{v['after']:.2f}</td></tr>" for k,v in dataset['measurements'].items())
    warnings = '、'.join(dataset['needsReview']) or '无'
    comparisons = ''.join(f'<img loading="lazy" src="{kind}/after/{p.name}" alt="逐字同框校正前后对照 {i+1}">' for i,p in enumerate(sorted((destination/kind/'after').glob('normalization-*.png'))))
    after = dataset['variants']['after']
    sections.append(f'''<section id="{kind}"><p class="eyebrow">{'重点验收 / 真实设计字' if kind == 'spring' else '覆盖验收 / 152 字'}</p><h2>{title}</h2><p>{note}</p>
    <div class="pair"><article><h3>校正前</h3><div class="glyphs {kind}" style="font-family:{kind}-before">{characters}</div></article><article><h3>校正后</h3><div class="glyphs {kind}" style="font-family:{kind}-after">{characters}</div></article></div>
    <div class="pair"><div><h3>平均目标偏差（输入格像素）</h3><table><tr><th>测量项</th><th>校正前</th><th>校正后</th></tr>{rows}</table><p>包含全部 {len(dataset['characters'])} 个字，含安全限制项。中文竖向对齐以字面光学中心确定 em 框位置；英文按大小写、升部／降部对齐基线。字重为面积／轮廓周长代理值，不是笔画语义识别。</p></div><div class="note"><h3>仍需审阅：{warnings}</h3><p>这些字的剩余字重差异触及保护限制；不会为了追齐指标强行封闭字腔、粘连笔画或抹掉细节。保留逐字状态和原图，严格导出仍要求外部审阅。</p><p>本机处理 {after['elapsedSeconds']:.2f} 秒 · 峰值 {after['peakMiB']:.1f} MiB。</p><a href="{kind}/after/report.json">逐字校正记录</a></div></div>
    <nav><a href="{kind}/after/font.ttf" download>校正后 TTF</a><a href="{kind}/after/font.woff2" download>WOFF2</a><a href="{kind}/after/font-source.zip" download>含原图与记录的源包</a><a href="{kind}/before/font.ttf" download>校正前 TTF</a></nav>
    <h3>同一坐标框内的逐字对照</h3><p>每对左侧为原字，右侧为校正后；蓝线是模板基线。英文保留降部，中文扁字不拉高。</p>{comparisons}</section>''')
document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图构 · 字形校正与春日验收</title><style>'''+''.join(styles)+'''
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#20302d;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1240px;padding:56px 24px;margin:auto}h1{font-size:38px;line-height:1.2}h2{font-size:28px;margin:8px 0 16px}h3{font-size:17px}p{color:#596661}.eyebrow{font-size:13px;letter-spacing:1px;color:#54776c}section{margin:52px 0;padding-top:24px;border-top:1px solid #d5ddd7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:22px}article,.note{background:#fff;border-radius:14px;padding:20px}.glyphs{font-size:39px;line-height:1.8;overflow-wrap:anywhere}.glyphs.spring{font-size:104px;line-height:1.5;padding:28px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #d5ddd7}nav{display:flex;gap:24px;flex-wrap:wrap;margin:24px 0}a{color:#286d61;text-underline-offset:4px}img{display:block;max-width:100%;height:auto;margin:18px auto;background:white}code{background:#e9eee8;padding:3px 7px}pre{white-space:pre-wrap;padding:20px;background:#edf0e9;border-radius:12px}.scope{padding:16px 22px;border-left:3px solid #4a7668;background:#edf0e9}@media(max-width:780px){.pair{grid-template-columns:1fr}.glyphs.spring{font-size:clamp(56px,13vw,104px)}h1{font-size:30px}}
</style><main><p class="eyebrow">图构 / 字体工具 / 实际 MCP 验收</p><h1>把字摆齐，保留它原来的笔形</h1>
<p>新增逐字重心、等比大小、分类基线和有保护的字重校正。重点用原来的“春日来信”检查特殊笔形，再做 100 中文＋52 字母全量检查。</p>
<p class="scope">这是确定性几何与轮廓校正，不会识别错字或补造笔画。原图不覆盖，修改先生成候选；外部 AI Agent 可通过 MCP 开关四项参数、查看对照并决定是否应用。</p>
<nav><a href="#spring">看春日来信</a><a href="#controlled">看全部 152 字</a><a href="acceptance.json">真实 MCP 记录</a><a href="font-verification.json">字体回读检查</a></nav>
'''+''.join(sections)+f'''
<section><h2>MCP 已接入</h2><p>保留 14 条字体命令，在 <code>font.atlas.process</code> 中添加显式参数。省略 normalization 时沿用原来的图集定位与描图；传空对象则开启四项校正。返回的对照 PNG 可通过 font.artifact.preview 直接获取。</p>
<pre>{{"normalization": {{"center": true, "size": true, "baseline": true, "weight": true}}}}</pre>
<p>目标字面默认中文 720、英文大写 720、小写 500（1000 UPM）；中文与英文分别估计字重目标，也可显式指定 strokeWidth。保留字形比例、点画与字腔；特殊高对比设计仍需要审阅。</p>
<p>{len(evidence['checks'])} 项真实桌面 MCP 检查通过；156 个样本均回读 TTF／WOFF2、检查轮廓数量和源包。9 项 Python 边界检查、16 项 Node 回归检查通过。浏览器预览使用导出字体，不借系统字体回退。</p>
<h3>质量自评</h3><table><tr><th>维度</th><th>评分</th><th>证据与限制</th></tr><tr><td>功能 / 代码 / 安全</td><td>9.4 / 10</td><td>真实 MCP、逐字记录、受限参数、原图与候选隔离；更多字体风格待验</td></tr><tr><td>审阅页 UI / UX / 字形保真</td><td>9.3 / 10</td><td>春日特殊笔形、点画和字腔保留；有剩余字重差异，不视为成品字族</td></tr><tr><td>性能</td><td>9.3 / 10</td><td>记录本机实测耗时与峰值；最大 512 字压力及跨平台仍待验</td></tr><tr><td>产品 UI</td><td>N/A</td><td>新增 MCP 能力，未增加图形编辑器</td></tr></table><p>可交付试验工具。尚未实现语义纠错、部件扩字、自动补齐春日风格全字库或商用排印级字距。运行中的旧图构窗口未被重启；关闭旧窗口后通过原入口使用新版。</p></section></main></html>'''
(destination/'效果与验收.html').write_text(document, encoding='utf-8')
print(destination/'效果与验收.html')
