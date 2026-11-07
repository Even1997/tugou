# PPT 模块与验收边界

本轮按用户确认范围提供创建、编辑、查看、演示及导出 `.pptx`。导入后续再做。PPT 保存于当前工程的 `document.presentations`，一个工程可包含多份文稿；沿用工程保存、版本冲突检测、素材引用保护和撤销历史。没有新增云端协作服务。

## 界面与功能

- PPT 属性区“阴影与边框”支持外阴影 / 内阴影同时启用，颜色、不透明度、模糊（0–100 px）、距离（0–200 px）、角度（−180–180°）与边框粗细（0–200 px）；边框沿矩形 / 椭圆外框居中，阴影沿可见内容 Alpha。复用效果默认值与验证器，每元素最多一种外阴影 / 内阴影 / 边框；禁用保留参数，隐藏不输出，锁定禁止修改。
- 图层编辑器属性区复用同一效果卡片组件，继续调用既有像素引擎，支持多个效果；图层边框为沿内容轮廓的描边，仍有扩展、位置、混合等原有高级设置入口。蒙版和调整图层不新增阴影入口。
- PptxGenJS 导出后使用 JSZip 和 XML DOM 修改本次生成的 DrawingML，保持原生可编辑元素；同时写入 innerShdw / outerShdw，图片 fillRect 保持比例及完整外框、旋转中心。所用依赖均已在工作区安装，本次将 @xmldom/xmldom 0.8.15、jszip 3.10.2 显式声明为运行依赖；不解析用户提供的 XML。参考 [SVG Filter Effects](https://www.w3.org/TR/SVG11/filters) 与 [DrawingML effectLst](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.a.effectlst)。

界面标题 / 操作 / 辅助说明使用 14 / 12 / 11 px，标题图标 18 px、工具图标 14 px，按钮 28 px；卡片操作点击区 26 px。列表卡片最大宽 224 px，名称与操作同排，统一 16:9 预览框，4:3 居中完整展示；编辑左右栏 164 / 232 px，小窗口 140 / 212 px。幻灯片内容字号与导出尺寸不受界面密度影响。

- 左侧新增 PPT 导航。文稿列表支持封面、搜索、每页 12 份分页、新建、重命名、复制及确认删除。
- 新建可选 16:9 / 4:3、经典蓝 / 极简黑 / 暖橙；提供封面、内容和空白页面。
- 编辑器采用左缩略图、中间页面、右属性栏。支持文字、图片、矩形、圆形；图片可导入或选择工程素材。双击文字进入右栏编辑。
- 字体复用 FontPicker、font.library / font.face 与 loadTextFont，包含字体目录、本机字体、已发布的自定义字体和真实字重。页面、缩略图、演示使用相同 FontFace；加载失败明确标识替代字体。自定义字体资源保存在工程引用中，随工程校验和归档保留。
- 右侧属性区下方提供独立滚动的页面图层列表。页面点击与列表选择双向同步；列表从上至下表示从顶层到底层，支持上移 / 下移、显示 / 隐藏、锁定 / 解锁。锁定阻止拖动、缩放、键盘移动 / 删除和属性更改；隐藏同步编辑、缩略图、演示、PPTX 导出。全部修改沿用工程撤销与保存。没有与图层编辑器互转。
- 支持拖动、右下角缩放、旋转、数值位置尺寸、置顶置底、复制删除、文字字体字号颜色 / 粗体 / 斜体 / 对齐、背景和演讲备注；旋转缩放保持对侧角固定。
- 页面支持新增、复制、上下移动、删除；保留至少一页。编辑可撤销 / 重做，保存按钮保存整个工程。
- 预览与全屏演示共用页面渲染，支持方向键、空格、PageUp / PageDown、Home / End、Esc；备注不显示于演示页面。
- 导出为原生 PPTX 文字框、形状、图片与备注，不把整页压平为截图。保留字体名称，字重按当前导出库映射为常规 / 粗体；字体未嵌入，换设备可能替换和改变换行；GIF 取首帧。隐藏元素不导出，可见的锁定元素正常导出。
- 深浅主题与紧凑窗口沿用应用主题和控件。页面白底属于文稿自身背景，不随界面主题改变。

## 开源方案选择

| 项目 | 本轮核对与使用方式 |
| --- | --- |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | 功能和三栏编辑体验可参考；当前仓库 LICENSE 为 AGPL-3.0，本轮未复制代码或作为依赖集成。 |
| [SlideWise](https://github.com/textcortex/SlideWise) | MIT、可嵌入 React 的编辑器；评估后未引入完整编辑器依赖。 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | MIT，选用 4.0.1 处理 OOXML 导出；编辑和工程管理沿用土狗自身 React / Electron 结构。 |

依赖许可证进入构建生成的第三方声明。PptxGenJS 的 `https@1.0.0` 包仅有元数据，按其声明的 ISC 许可证和作者记录；`isarray` 许可证来自其 README。对间接依赖 image-size 使用 2.0.3 override，消除本轮发现的高危告警。审计剩余 6 项 moderate，均属于现有 electron-builder / minimatch 构建工具链，未在本轮扩大升级。

## 安全和规模边界

- 每工程最多 100 份、每份最多 200 页、每页最多 200 元素；文本、坐标、尺寸、颜色和素材引用在保存 / 导出前校验。
- 界面导出只接受本机文件选择器产生的 PPTX 一次性令牌，在异步处理前消费，重复并发使用拒绝；MCP 使用 `filesRoot` 下的相对 `.pptx` 路径，拒绝越界、符号链接逃逸和覆盖，编码完成后再校验实时 revision。
- 导出图片只读取受限资源目录的哈希命名文件，拒绝路径越界与文件校验失败；不获取任意网络图片。
- 图片输入累计最多 128 MiB，单图最多 4000 万像素，按放置次数累计最多 6400 万像素；超限明确拒绝并建议缩小图片。
- Electron 仅放行受信任本地主页面的 fullscreen 权限，其他权限继续拒绝。
- 异步图片导入在工作区卸载后不提交结果；跨页面切换或拖动期间文档发生变化时不覆盖新的编辑。

## 验证证据

MCP 本轮：`app/test-results/presentation-mcp/report.json` 29 项真实 stdio 桌面检查覆盖全部 22 条命令；`unit.log` 全量 506 通过 / 1 平台跳过；`ppt-regression.log` 原有 PPT 桌面 47 项、`ui-regression.log` 通用界面 MCP 30 项通过，三组渲染错误均为 0。验证页面与元素作用域、批次一次撤销、界面双向编辑、保存重开、视图恢复、全屏与手动翻页、PNG 和实际 PPTX、旧版本 / 错误批次 / 路径越界 / 文件覆盖保护。`preview.png` 与 `editor.png` 已查看，效果和选中图层对应。两页小样本实测读写最多 22 ms、视图打开 247 ms、导出 68 ms，含额外 get_state 往返；不作为大文稿性能保证。

阴影与边框本轮证据：`app/test-results/element-effects/report.json` 41 项桌面 / 像素通过（含既有图层引擎 20 项），`full-unit.log` 500 通过 / 1 平台跳过，最后补充重复效果 ID 拒绝后 `targeted-unit.log` 15 项通过。`app/test-results/presentations/effects-regression.log` 原有 PPT 桌面 47 项通过。均使用隔离数据目录，渲染错误 0。

`ppt-pixels.png` 的外 / 内 / 边框像素分别为 [238,51,34]、[34,187,85]、[34,51,238]，中间原色 [115,153,187] 保留；`ppt-transparent.png` 验证内阴影沿圆形图片 Alpha，不填充透明外框。`ppt-effects-light.png`、`ppt-effects-dark-narrow.png`、`layers-effects-light.png`、`layers-effects-dark-narrow.png` 验证主题和属性卡片；`effects.pptx` 为真实按钮导出样本，包含原生阴影和边框。`performance.json` 固定 20 页 / 200 矩形三效果样本导出约 107 ms、事件循环最大采样间隔 22 ms。

本次样式范围自评：功能 9.4、代码 9.5、UI 9.4、UX 9.4、美术 9.4、性能 9.4、安全 9.5，可交付；低于 9.5 项需用户实际显示 / 操作确认、Office / WPS 模糊观感对照、Mac / 高 DPI 与大图片压力验证。已验证原生文件结构，不声称已完成 Office 真机视觉一致性。

测试使用独立数据目录，不读取或修改用户工程。产物位于 `app/test-results/presentations/`。

- `compact-run.log` / `desktop.json` 的 `density`：紧凑 UI 复验 47 项通过、错误 0；窗口 1280×800 和 940×640 无横向溢出。1280 窗口卡片实测 222.39×190.72 px、标题栏高 55 px；查看 single-card-compact.png、library-light.png / library-dark.png、font-picker-light.png 和 editor-narrow.png，确认混合比例卡片底部对齐、字体和图层面板清晰。高 DPI 和 Mac 显示仍待验证。
- `desktop.json` / `desktop-run.log`：Windows 桌面 47 项通过，涵盖创建、多文稿、页面编辑、真实指针移动 / 旋转缩放、撤销重做、图片、备注、预览 / 全屏 / 退出、4:3 自适应、实际导出 / 取消、令牌并发保护、重命名 / 搜索 / 删除、保存后渲染进程重启恢复。新增真实本机 / 目录 / 自定义字体、字重与渲染一致、图层双向选择 / 排序 / 隐藏 / 锁定、实际鼠标锁定防护、导出隐藏与字体名称、字体资源和状态重开。浅深主题、940×640 和 1380×900 检查，渲染错误 0。字体缓存使用本地真实文件，发布字体使用隔离的已完成产物样本，不重新运行字体生成任务。
- `unit.log`：全量单元测试 496 项通过、1 项平台相关跳过；`ppt-unit.log`：PPT 专项 8 项通过，涵盖独立持久化、旧 revision 拒绝、复制 ID 隔离、非法数据、PPTX XML / 备注 / 尺寸 / 顺序 / 图片结构、路径 / 内容校验及资源预算拒绝，新增字体资源 / 字重 / 图层标记校验和保存、隐藏层过滤及叠放顺序。
- `settings-regression.log`：原设置界面及完整进程重启 45 项通过，包含语言、主题、启动页、MCP 连接和画布滚轮 / 吸附。
- `editor-light.png`、`editor-dark.png`、`editor-narrow.png`、`font-picker-light.png`、`library-light.png`、`library-dark.png`、`presentation.png`：截图已检查布局、字体、图层面板和演示隔离。
- `export.pptx`：真实界面导出样本，验证 ZIP 内原生元素及图片 / 备注。
- `performance.json`：本机 50 页、500 个文字 / 形状元素样本导出 29 ms，事件循环最大采样间隔 19 ms。此样本不是大图片或低配置机器的性能保证。
- `npm-audit.json`：0 high / critical，6 moderate（现有构建依赖）。

## 尚未验收和未提供

本机未发现可用 PowerPoint / LibreOffice，未声称完成真实 Office 打开、字体换行视觉比对或 Mac 原生测试。PPTX 导入、协作、动画、音视频及复杂图表不在本轮范围。PPT 当前已有创作功能已接入 MCP；用户常用客户端、Mac 与大文稿长流程仍待验收。

## MCP 调用

PPT 设计先通过 `get_design_standard {}` 或 `tugou://design/ppt` 读取 [土狗设计标准](ppt-design-standard.md)；`ppt` 提示模板包含相同规范全文和操作流程。只读标准不会触发生成或修改文稿。规则随新版 MCP 服务进程提供，旧连接需重连，旧安装包需更新；不表示 Agent 被强制执行或视觉效果已获验收。

先 `get_state`，再 `list_commands({domain:"ppt"})` 获取完整参数。写入使用实时 `expectedRevision`；批次只接受文档编辑，任一步失败不提交，成功后一次撤销。

| 能力 | 命令 |
| --- | --- |
| 文稿查询与管理 | `ppt.list`、`ppt.get`、`ppt.create`、`ppt.rename`、`ppt.duplicate`、`ppt.delete` |
| 内容草稿与显式应用 | `ppt.content.update`、`ppt.content.apply` |
| 页面管理、背景与备注 | `ppt.slide.create/update/duplicate/delete/move` |
| 文字、图片、形状、字体与图层 | `ppt.element.create/update/duplicate/delete/move/effects` |
| 编辑视图、预览和演示 | `ppt.open`、`ppt.close`、`ppt.preview`、`ppt.present` |
| 导出 | `ppt.export` |

`query_objects` / `get_object` 新增 `presentation`、`slide`、`slideElement`；页面必须指定 `presentationId`，元素还必须指定 `slideId`。`ppt.get` 默认返回文稿元数据与页面摘要，加 `slideId` 返回完整单页。元素顺序从 0 起，0 为底层；锁定后只允许修改 visible / locked。文字沿用 `font.library` / `font.publish` 的字体和资源；图片先 `asset.import`，使用返回的 `ids`。`ppt.element.effects` 替换完整效果列表，三类各最多一个，空数组清除。图层编辑器仍用 `layer.effects`，形状基础边框仍用 `layer.update`。

矩形圆角（待用户确认）：`ppt.element.create` 的 `properties` 或 `ppt.element.update` 的 `patch` 可传 `cornerRounding:100` 联动四角，或 `cornerRounding:{topLeft:100,topRight:50,bottomRight:0,bottomLeft:25}` 独立设置。仅 `kind:"rect"` 支持；每个值为 0–100 程度，实际半径 `value*min(w,h)/200`，缩放保持比例。对象必须包含全部四角；若只改一角，先读取当前对象并保留另外三个值。UI 在填充颜色下方提供联动 / 独立切换、数值框与滑块，重新联动以左上角为准，可撤销。旧 `cornerRadius` 仍表示 0–2500 px，保留已有文稿外观；MCP 设置任一参数会清除另一参数，不允许同时提交。统一圆角导出原生 `roundRect`，独立圆角导出含圆弧的原生自定义矢量，均保留边框、阴影和旋转，不转为位图。

`ppt.open` 可指定 `elementId` 同步选中页面与图层。`ppt.preview` 打开窗口预览并返回真实 PNG，窗口需可见，使用 `ppt.present {action:"stop"}` 退出。`ppt.present` 支持 start / next / previous / goto / stop；start 可传 fullscreen，实际状态读取 `get_state.presentation.fullscreen`。预览和导航不写文档；输入、拖动和其他弹窗未结束时拒绝导航，PPT 播放器自身可接收演示控制。

`ppt.export {presentationId,path:"exports/demo.pptx"}` 导出实时快照到交换目录，包含未保存编辑；不会自动保存工程。使用 `project.save` 保存，`history.undo/redo` 撤销重做。没有添加任意脚本执行或 PPTX 导入命令。

本轮自评按当前基础功能范围为可交付：功能 9.4、代码 9.5、UI 9.4、UX 9.4、美术 9.3、性能 9.3、安全 9.4。未达 9.5 项需要用户确认视觉与真实演讲体验、Office / Mac 对照、大图片和低配置测试；构建工具链中危告警单独跟进。未发布安装包，涉及主进程与 preload 的变化需要保存后重启开发预览生效。

## 内容大纲与讲稿（待用户验收）

左侧「页面 / 大纲」共用实际幻灯片顺序，支持拖动及上下移。大纲中连续浏览逐页内容，展开当前页编辑；右侧「内容 / 设计 / 讲稿」分别整理文案、元素属性和演讲备注。内容区每页只提供一个多行输入框，标题、正文、数据与配图说明自由连续编辑，不再逐块填表。已有结构化内容合并显示，内部关联仍保留。AI 和用户共用同一份工程数据。连续输入立即写入工程未保存状态，同一输入会话合并撤销；有其他修改介入时开始新的撤销记录。

`ppt.create {name,layout:"blank"}` 可创建内容阶段的空白文稿；默认 cover 保持手工创建体验。`ppt.get {presentationId}` 返回页序、标题、objective 和 contentStatus；加 slideId 返回完整 slide.content、slide.notes 与元素。`get_object(kind:slide)` 同样返回当前内容。`ppt.open` 支持 sidebar:pages/outline 和 panel:content/design/notes；通用 UI 恢复也保留页签。

`ppt.content.update {presentationId,slideId,patch:{text,objective,chartData,visuals,blocks}}` 只更新草稿。text 是可选整页自由文本（最多 2,040,000 字符，覆盖已有全部文字与说明）；包括空字符串均优先显示，省略保留，显式 null 清除。AI 在排版并核对整页内容全部落实后才能清除，页面修改、结构化草稿更新均不会自动覆盖 text。blocks 是完整文字块列表，项为 `{id?,elementId?,label,text}`；新草稿可省略 id，命令返回完整内容。已有块保留 id，绑定可编辑文字时设置 elementId。读取中的 baseText / draft 是只读同步状态，不作为命令入参。省略 blocks 保留原稿；从列表省略已关联块不会删除画面文字，删除画面文字用 ppt.element.delete。跨页关联、重复 ID / 关联、超限内容均拒绝。

`ppt.content.apply` 仅显式应用结构化文字；存在 text 整页草稿时返回 CONTENT_REQUIRES_LAYOUT，不会误用旧 blocks。保留已有位置、字号、字体、效果及图层顺序；未关联块新增基础文字框，仍需排版。核心观点、图表数据与配图需求不直接渲染。锁定的待更新文字拒绝应用；页面与草稿同时改变时返回 CONTENT_CONFLICT，MCP 读取完整元素与草稿后核对差异并确认是否覆盖。UI 自由文本交给 AI 排版，不按空行或段落强行映射现有元素。MCP 的 confirmConflicts 仅在核对差异并获得用户覆盖指示后使用。

画面修改同步未编辑的关联文字；删除、复制页面与复制文稿维护对应关系。演示和 PPTX 只使用已应用的页面元素，未应用草稿不进入画面；讲稿单独进入 PPTX notes。AI 写稿 / 重排按钮只复制含当前对象 ID 的 MCP 请求，由已连接客户端执行，不是内置生成或付费任务入口。

默认 AI 流程已同步到规范及 MCP 初始化、状态和命令发现：写大纲与逐页要点 → 确认大纲 → 用户选择先设计或先写讲稿。讲稿分支只写 notes，不改画面、不清除内容草稿、不触发生图；设计分支确认视觉范围 → 展示方案板 → 用户选型 → 制作与预览，保留已有讲稿。完成所选步骤后询问是否继续另一项；已有确认和选择不重复询问。程序提供规则和内容编辑能力，尚无自主执行该流程的内部 Agent 或代码级审批门禁。


## MCP 截图验收

`ppt.preview` 直接返回真实 PNG 图片块（`content[].type=image`、`mimeType=image/png`），并在同一响应的文本元数据中附带文稿 / 页 ID、尺寸、revision 与加载状态。读取的是当前未保存的页面元素，不包含内容草稿、讲稿或工具栏。`list_commands {domain:"ppt",search:"截图"}` 可发现入口。

先 `ppt.get` 查页 ID，再用 `run_command {command:"ppt.preview",args:{presentationId,slideId,maxSize:1440},expectedRevision}` 获取目标页。每页之后 `ppt.present {action:"stop"}` 退出，再截下一页；修正排版后重新截图。`ui.capture` 用于编辑界面，预览期间可传 region:pptSlide。窗口必须可见；maxSize 是上限，不会放大窗口像素。MCP 客户端需要支持图片内容，PNG 不是磁盘文件路径。

设计流程要求 AI 实际查看逐页截图、核对页 ID / revision、检查截断重叠与排版，记录覆盖范围；元素数据和导出成功不能代替视觉验收。仅写大纲 / 讲稿不提前制作画面。土狗截图不等于 PowerPoint / WPS 对导出文件的显示验证。

预览播放器已移入应用弹层容器，避免截图计算被编辑区父级边界误裁。修复前 16:9 页面 1216×684 被误裁为 1176×684，修复后保留完整比例；实际多页 PNG 和尺寸限制见 app/test-results/presentation-mcp/report.json。
