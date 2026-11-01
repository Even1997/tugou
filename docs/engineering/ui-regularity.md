# 整体界面规整与验收

本轮沿用现有视觉风格，以边界对齐、稳定间距、信息层级清楚和窄窗口可用为验收标准。修改本地源码，未打包或发布。

## 检查与修复

先用隔离 Windows Electron 工程截图，再修改并复验。以下为本轮七个页面检查，截图来自真实渲染器；测试素材为仓库示例图片。

| 页面 | 观察与处理 | 前后对比（1040 px） |
| --- | --- | --- |
| 1. 提示词与配方 | 左侧模块列表和右侧配方留白不一致；组合模块原来都写“文本”，难以区分。统一面板间距、调整编辑区比例，改成展示真实模块名的勾选行。 | [修改前](../../app/test-results/ui-regularity/before/1-prompts-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/1-prompts-light-1040.png) |
| 2. 画布 | 统一左栏宽度与列表间距；文本素材用清楚的文字图标；修复选中后打开检查栏时按旧画布宽度定位，造成节点部分遮挡的问题。 | [修改前](../../app/test-results/ui-regularity/before/2-canvas-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/2-canvas-light-1040.png) |
| 3. 合成 | 检查图层、画板和属性区；当前示例无阻挡问题，保留适合编辑器的布局。未改合成算法。 | [修改前](../../app/test-results/ui-regularity/before/3-layers-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/3-layers-light-1040.png) |
| 4. 工具 | 统一素材栏和设置区留白；缩略图、名称、时间、尺寸分层；预览标题单独一行，避免窄窗口按钮零散换行。 | [修改前](../../app/test-results/ui-regularity/before/4-tools-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/4-tools-light-1040.png) |
| 5. 素材 | 名称与时间作为一组；详情字段与操作区间距收紧，按钮有序排列；940 px 下调整详情栏，保留素材双列。 | [修改前](../../app/test-results/ui-regularity/before/5-assets-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/5-assets-light-1040.png) |
| 6. 字体 | 检查字体页当前列表和空状态的对齐与滚动，无需额外改变独立字体工作区。未覆盖每个字体编辑流程。 | [修改前](../../app/test-results/ui-regularity/before/6-fonts-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/6-fonts-light-1040.png) |
| 7. 设置 | 左栏跟随统一宽度；标题、内容边距和设置行密度收敛；复验外观、模型连接、快捷键三个子页。 | [修改前](../../app/test-results/ui-regularity/before/7-settings-light-1040.png) · [修改后](../../app/test-results/ui-regularity/after/7-settings-light-1040.png) |

左侧主内容栏共用 248 px，窗口不超过 1150 / 1000 px 时分别使用 230 / 216 px；右侧按实际内容保留不同宽度。图片完成／上传时间继续沿用上一轮实现。

## 验证证据

- 73 项 Windows Electron 桌面检查通过，0 个渲染错误：[机器报告](../../app/test-results/ui-regularity/after/report.json)，[验收脚本](../../app/test/ui-regularity-desktop.cjs)。
- 七个主要页面分别覆盖浅色 1440×960、1040×760、940×680 和深色 1440×960，共 28 张页面截图；另有 5 张工具／设置子页截图。
- 检查文档与侧栏横向溢出、主侧栏宽度、时间单行显示、节点完整定位；交互覆盖模块勾选与撤销、键盘焦点、素材筛选与详情、工具素材切换及设置开关。
- 21 项素材、配方和工作流节点逻辑测试通过：`node --test test/materials.test.cjs test/recipe-workflow.test.cjs test/workflow-nodes.test.cjs`。
- 全部使用隔离工程；未操作用户真实工程，未请求收费生图或更改模型凭据；未新增依赖、网络请求或后台轮询。

## 质量自评与边界

分数为本次范围内的主观交付评估，不代表跨平台认证。

| 维度 | 分数 | 依据／改进点 |
| --- | --- | --- |
| 功能 | 9.5/10 | 73 项桌面检查、21 项逻辑回归通过。 |
| 代码 | 9.5/10 | 沿用组件和主题，主要调整 CSS；定位仅等待布局稳定，不改文档数据。 |
| UI | 9.5/10 | 七页、浅深色和三档窗口检查；宽度、间距、信息分组统一。 |
| UX | 9.5/10 | 模块可辨识、键盘焦点可见、节点不被检查栏遮挡。 |
| 美术 | 9.5/10 | 保留既有主题与图标体系，收敛密度和层级，无新视觉资产。 |
| 性能 | 9.4/10 | 无新增后台任务；尚未做海量素材／长时间拖动压力测试。 |
| 安全 | 9.5/10 | 生产改动限界面；验收使用隔离目录，无凭据或外部生成请求。 |

结论：本轮可交付。后续需补 Mac 原生界面、系统文字放大和真实大工程检查；当前结果不表示全部弹窗、字体制作流程或完整无障碍符合性均已验收。
