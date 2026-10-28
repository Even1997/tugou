# 字体图集闭环与 MCP

当前实现完整字形素材图 → 定位校正 → 轮廓提取 → UFO 源文件 → TTF/WOFF2 → 实际字体预览。外部 Agent 负责素材生成、身份及风格审阅；校正引擎不调用云端模型，不读取供应商 Key；可选本地 OCR 辅助识别。没有实现任意中文部件自动扩字。

## 运行与文件

字体模块复用桌面的 stdio MCP、TaskQueue、请求日志和文件交换目录，提供 19 条 `font.*` 命令，总目录 129 条。字体源工程独立保存在 `<workspace>/fonts/<id>`，不改变画布及其未保存状态；不能放入原子文档 batch。

独立 Windows Python 环境通过 `app/scripts/setup-font-runtime.ps1` 安装。显式提供 Python、Potrace 1.16 的解压目录、字体环境目录，和可选的 workspace 目录。脚本锁定 Python 包版本、复制追踪器及其许可，并记录运行时版本。启动时不会安装依赖。配置存在 workspace 的 `font-runtime.json`；`TUGOU_FONT_RUNTIME` 可覆盖配置。Potrace 由操作者单独配置，当前应用包没有嵌入该可执行文件；重新分发前应独立核对许可。

重任务每次启动一个隔离 Python 子进程，默认串行，超时预算按字符数有界增长（普通任务至少 180 秒，精修至少 300 秒）。真实进度为阶段与完成格数。任务取消、应用退出都只停止当前任务创建的子进程。图集候选先写不可变作业目录，再由 `font.revision.apply` 检查字体版本并原子更新工程指针。

## 字体工作台

左侧「字体」进入独立工作区：我的字体 → 新建字体 → 字符库 / 导入图集 / 校正与导出。每个字体独立保存；初始字符库提供常用 3849 字、100 中文＋52 字母、52 字母或自定义。创建时复制模板，过滤和搜索不改变映射顺序。前端不导入 TTF。

工作台取消批次与固定字数要求。参考字库可为空，分页仅控制浏览 DOM，不限定导入图字数。可点选/输入任意需要的字符复制生成提示；导入不需要 planId/page，不要求顺序或填满网格。导入记录按图片切换，默认本地 OCR。旧 `font.atlas.plan` 仍是显式模板工具，以兼容已有工程及 Agent；不再作为界面导入的前置步骤。

有效、唯一对应默认保留；重复身份只默认保留最高分的一份，其余进入复核。低于精确 1.0 分数及有警告的项单独复核，左键回看，右键确认并前进；文字输入框内保留方向键编辑，Enter 确认。可改字、裁切、排除、补字。改正字符或裁切后，有效字形自动纳入；只有不需要的字才主动排除，不再逐个勾选保留。`font.atlas.review` 保存复核草稿，`font.job.get.review` 可恢复 included/reviewed；默认保留不代表人工确认，不继承身份/风格审阅。库外有效字符在应用候选时加入库；按实际已有字形编译导出，不必完成参考库。界面「保存到字体」会依次提交草稿、处理校正、版本检查、应用候选并返回字库；失败/取消/过期版本不覆盖已保存字体。保存期间显示真实任务进度。


主进程原生图片/保存对话框限定用户选择路径，字体服务由 UI/MCP 共享同一写入队列。作业参数和来源保存在独立项目目录。平滑降档仅重算参数改变的字形；已通过的同参数结果复用。

## 本地 OCR 与人工核对

`font.atlas.recognize({projectId,fontRevision,requestId,atlasId})` 创建可取消任务。`font.job.get` 返回 `report.candidates`，包含 `character/recognizedText/score/box/warnings`；坐标是原图像素 `[左,上,右,下]`。OCR 用 RapidOCR 1.4.4（PP-OCRv4 ONNX），模型随独立 Python 包安装，运行时不上传图像、不请求 API。规则图集先检测实际空白行列，其他布局采用 OCR 检测框；取消 512 候选上限，受文件/像素预算和 TrueType 格式容量约束。不同大小写、相似符号、两种视图识别不一致及裁切碰笔画都需核对。

新识别记录以 scorePrecision=raw 保留浮点原值，不把 99.999% 四舍五入成 100% 跳过复核；没有此标记的旧记录仍需复核，旧100%显示为约100%。列表每屏 24 项，原图仅绘制当前屏和当前选中框；避免大量 SVG 节点拖慢界面。检测/识别置信度不等于真实文字正确率，不依据输入顺序猜测低置信度文字。

核对后传 `font.atlas.process({atlasIds:[atlasId],mapping:{jobId,glyphs:[{character,box}]},background:"light",merge:true,normalization:{},...})`。服务校验识别任务所属项目/图集/来源哈希、字体版本、有效单字符、重复字及原图边界；不能与透视 alignment 混用。选中裁切先放到标准字框，再执行已有校正、应用及字体导出。候选不会自动应用；原图/识别记录/确认后的映射/旧字体均保留。已有同字符将在应用候选时替换。

Windows 验证：`app/test-results/font-ocr/acceptance.json`。乱序 152 字受控样本检测 150 个候选，其中 133 个身份与位置匹配；经参考真值核对完整 152 字映射后导出 TTF/WOFF2。用户粗圆 12 列原图检测 256 个候选，187 个满足置信度/唯一性/字库约束的候选通过校正与导出；这不是 187 字身份人工验收。语义误认、漏框仍可能发生，不能宣称全自动识字正确。

## 输入合同

调用 `font.atlas.plan` 取得模板和 JSON 映射；默认每格 384px，可选 256–512px，根据 16 MP 上限自动分页。模板包含四个不同 ID 的 ArUco 标记，格子内没有会混入轮廓的网格线。每格的字符、框、em 像素尺寸、原点和基线都写入映射；字体采用 1000 UPM、上升部 900、下降部 -300。中文保留相对格子位置；英文保留同一缩放和基线，仅计算两侧各 48 单位的字宽留白，变换写入记录。

来源图片应按模板绘制深色字、浅色背景，或提供真实透明背景。支持静态 PNG/JPEG/WebP，单图不超过 32 MiB / 16,000,000 像素。保留定位标记；背景模式必须明确选择 `light` 或 `alpha`。识别模式无需定位标记或固定比例，但装饰背景、粘连和复杂海报不保证正确分割。

自动检测四角标记，估计透视变换；最大标记残差不得超过 2.5px。缺标记、重复标记或形变超限返回 `NEEDS_ALIGNMENT`。也可提供整张模板的左上、右上、右下、左下角坐标；这属于显式指定，不标为自动检测。

不按连通块面积删除小点、不补笔、不填洞；提取结果记录连通块、孔洞和可疑小区域。空格子、越界笔画或超出字体指标会产生 `needs_review` 报告，并禁止应用候选。字形身份来自调用者给定的格子映射，几何通过不等于字符正确。

## 调用顺序

### 可选逐字校正（atlas-2）

`font.atlas.process` 可传 `normalization:{}` 开启重心、大小、基线、字重四项处理；省略该字段仍只做图集定位及描图。`center/size/baseline/weight` 可分别关闭。目标采用 1000 UPM：`cjkExtent` 默认 720、`capHeight` 默认 720、`xHeight` 默认 500；可选 `strokeWidth` 指定有效字重，否则按本批中文／英文分别取中位数。

- 中文等比缩放最长边，扁字不拉高；横向光学中心和竖向 em 框位置以边框中心 65%＋墨迹重心 35% 对齐。英文保留大小写、升部／降部、i/j 的点，并做有限光学边距。`center` 控制横向对齐，`baseline` 控制竖向对齐。
- 字重为墨迹面积／轮廓周长的稳定代理值，不是自动识别每一横竖。轮廓偏移不超过 1.5 输入像素、有效字重的 20%，并保护连通块、字腔、粗细对比；遇保护限制保留剩余差异并标记 `needs_review`，不强行把设计字磨成等线体。
- 大小校正保持等比，倍率限制 0.6–1.6；细字腔可用不超过四分之一像素的栅格相位调整保留。无法安全处理时保留原字及诊断。不会补笔、识别错字、消除风格差异或自动认可字符身份。
- 逐字 `normalization` 记录前后边框、重心、字重、拓扑、变换、偏移及剩余偏差；`normalization-*.png` 是同一坐标框的前后对照，可通过原生 MCP 图片读取。记录随源包导出。候选应用与严格导出的审阅门禁保持不变。

专项验收使用原始 AI“春日来信”四字素材，另以原型的 100 中文＋52 字母增加明确标注的逐字位置、大小、粗细扰动；不把后者冒充 152 个春日风格字。候选包真实桌面 MCP 38 项检查、9 项 Python 边界检查、16 项 Node 回归通过。两组 TTF／WOFF2 坐标与字宽一致、轮廓数量未丢失、源 ZIP 通过核验。152 字处理 27.525 秒、峰值 464.1 MiB，四字 0.763 秒。152 字有 8 个字重保护提示，春日组的“日”另有剩余差异待审阅。证据：`app/test-results/font-normalization-final/`。

下面是基础闭环的调用顺序：

1. `get_state`，`list_commands({domain:"font"})`，`font.status`。
2. `font.project.create({name,characters,requestId})`。名称支持中文，PostScript 名单独生成；可空白起步，不设产品字数配额；TrueType 可容纳至多 65533 个用户字形（预留空格和 .notdef），空格自动加入导出字体。
3. `font.atlas.plan({projectId,fontRevision,requestId,cellSize:384})` → `task.wait` → `font.job.get`。用 `font.artifact.preview/export` 取得模板与 `plan.json`。
4. 把素材图放到 `get_state.filesRoot` 下，调用 `font.atlas.import({projectId,fontRevision,requestId,planId,page,path,sourceNote})`。每页有独立 atlasId，保留原图及 SHA-256。
5. `font.atlas.process({projectId,fontRevision,requestId,atlasIds,background:"light"})` → `task.wait` → `font.job.get`。查看校正图、变换矩阵和逐字诊断。
6. `font.revision.apply({projectId,fontRevision,requestId,candidateId})`。只能应用完整且几何通过的候选；期间字体元数据变化会产生 `FONT_CONFLICT`。
7. `font.glyph.query` 分页读取来源、指标和检查状态。`font.build({projectId,fontRevision,requestId,mode:"draft"})` 输出字体、预览和明确的未审阅清单。
8. 外部 Agent 查看实际 PNG 后，使用 `font.review.record` 为当前字形摘要分别记录身份和风格检查。只有全覆盖且当前摘要审阅通过才能 `mode:"strict"` 导出。测试驱动中的夹具审阅只检验门禁，不代表产品会自动认可未知素材。
9. `font.artifact.export({projectId,jobId,artifactId,path})` 写出 TTF、WOFF2、源包、报告或 PNG。路径相对文件交换根目录，不覆盖已有文件。

写操作均携带当前桌面 `expectedRevision`；字体元数据写操作另外携带最新 `fontRevision`。稳定 requestId 在重试时复用，相同 ID 不同参数会拒绝。`task.wait` 取消等待不会取消任务；`task.cancel` 才停止执行。没有自动重试可能产生歧义的任务。

## 可追溯与导出

JSON 保存字符映射、原图摘要、校正矩阵、参数、审阅和版本；UFO/GLIF 保存唯一可编译轮廓及字宽，文件名按 Unicode 编号，不会发生 Windows 下 A/a 名称冲突。Potrace 使用 turdsize=0 保留小点；三次曲线通过 Cu2QuPen 以 1 字体单位误差转为 TrueType 二次曲线。

源 ZIP 包包含 UFO、构建报告、逐字处理记录、布局映射和原始图片，打包时再次验证原图摘要。TTF 和 WOFF2 回读检查 Unicode、非空轮廓与字宽；预览由实际导出的 TTF 经 FreeType 渲染，桌面验收另以 Chromium FontFace 加载实际文件。MCP 图片以 PNG 内容块返回，二进制文件使用已登记 artifactId 导出。

## 实际验收

素材来自已有原创参数化原型的 100 中文＋52 英文字母，先渲染为受控图集，再加透视、旋转、平移和缩放扰动；加工 worker 没有取得原始参考 TTF 或其轮廓。此验收证明图像加工和字体输出闭环，不证明未知 AI 图片必然写对字，也不证明部件扩字。

- 26 项 Node 逻辑／MCP 回归检查；5 项 Python 图像边界测试。
- 源码版真实 stdio MCP 与桌面检查 27 项通过；Windows 候选包使用 512px 格子，30 项通过，覆盖严格导出门禁、取消和过期候选。最终包再以 384px 格子完成 33 项检查，补验缺标记的待修正状态、诊断和拒绝应用；五个核心交付文件的源码／包内摘要一致。
- 两组均覆盖 152 字且无系统字体回退。TTF／WOFF2 轮廓和指标相同；源包 ZIP 与原图摘要检查通过。
- 384px 组处理 9.119 秒、峰值工作集 455.0 MiB；512px 组处理 11.481 秒、峰值 583.6 MiB。编译约 0.5 秒。数据是该电脑、本批素材的 worker 指标，不能外推所有字体。
- 512px 组原始二值轮廓 IoU 中位数 96.82%、最低 88.51%；允许至多一个输入像素的栅格相位误差后，中位数 97.09%、最低 94.10%。两种指标同时保存，不用容差掩盖偏移。

证据：`app/test-results/font-mcp/acceptance.json`、`app/test-results/font-mcp-package/acceptance.json`、`app/test-results/font-mcp-final/acceptance.json` 及同目录 `render-verification.json`。构建及运行环境可复现脚本在 `app/test/font-*.{cjs,py}`，参考素材生成器仅属于测试，不参与正式加工。

## 仍需验证

真实 AI 图集对模板的遵循率、多种字体风格、复杂背景、极细笔画、商用品质字距、完整中文字库与部件组合、Mac 环境。字体工程目前独立保存和导出，尚未把字体资源自动关联到图构文字图层／主工程跨机器包。当前提供独立字体工作台与 MCP 闭环，不提供逐点贝塞尔编辑器。

## 轮廓平滑与加粗

`font.outline.refine` 对静态黑白 TrueType 字体做确定性轮廓精修，无需生图或供应商 Key。用于图集编译后的独立导出阶段，不替换 UFO 源版本，也不沿用旧版本的身份／风格审阅。

1. 取得当前 `get_state.revision`、`font.project.get.fontRevision`。
2. 调用 `font.outline.refine({projectId,fontRevision,requestId,jobId,smoothing:14,bold:4})`，`jobId` 指向本工程已完成的构建／精修任务。也可用 `path:"input.ttf"` 代替 `jobId`，导入文件交换根目录内的 TTF；两者必须二选一。输入会立即复制并保存 SHA-256，原文件不变。
3. `task.wait`／`font.job.get` 查看阶段与完成字数，`task.cancel` 取消。失败不改变当前源版本；同 requestId 重放不会重复处理。
4. 用 `font.artifact.preview` 查看 `comparison-0.png` 等分页对比（每对左原始、右精修，均由实际 TTF 渲染）；用 `font.artifact.export` 导出 `font.ttf`、`font.woff2`、`input.ttf` 和 `refinement.json`。

参数单位为千分之一 em，不依赖输入字体 UPM：`smoothing` 范围 0–24，`bold` 范围 0–12，0 关闭对应处理。默认值针对有颗粒的圆润字体；书法、尖角或刻意粗糙风格需降低平滑力度。path 输入字符集须与工程一致；jobId 按来源实际覆盖范围处理（空格除外），最多 4096 字、32 MiB；不支持可变字体、彩色字体、CFF 或字体集合。

算法按轮廓弧长重采样、周期平滑，再沿法线加粗并转回 TrueType 曲线。逐字以 1200px FreeType 渲染，检查二值连通块和嵌套字腔数量及墨迹面积增幅；不满足时先降低加粗、再降低平滑，最终可保留原字形。`limitedCount`、`unchangedCount` 与每字实际参数明确反馈保护结果。两项均为 0 时保持轮廓坐标；保持 cmap、字宽、基线指标，另校验 WOFF2 轮廓往返。处理不识别错字，拓扑数量检查不等同于笔画语义正确或全字号可读性。

测试入口：`app/test/font-outline-test.py`（边界与保护）、`app/test/font-outline-desktop.cjs`（真实 stdio MCP、导出、Chromium 加载；通过环境变量提供 256 字原始 TTF 和字符清单）。

## 已保存字形预览

`font.glyph.preview({projectId,characters})` 是只读接口，每页最多256个字符；返回当前源版本 `sourceRevision` 和已有字的 `character/path/advance`。Python使用UFOReader与SVGPathPen读取实际保存的轮廓，先检查每个GLIF摘要，不以系统字体冒充设计字，也不要求先编译TTF。临时输出有8MiB预算，读取后删除。字体页只加载当前页，切换版本或字符筛选时丢弃过期响应。缺失字仍用参考字符；已有字显示实际轮廓与小字名称。右侧已选字形区展示前16个已保存字形供对照，不限制需要生成的字数。

一键保存目前由桌面将既有process/apply命令组合执行；MCP客户端仍可独立控制候选与应用。退出应用时未完成的校正任务中断，旧字体保留；复核草稿与已完成候选仍可读取，不把后台处理中说成已保存。
