# 标尺、尺寸提示与公共控件验收

实际 Electron 项目已补齐标尺、选中对象尺寸提示和画板尺寸浮层，24 个界面文件的 65 处原生下拉改为共享 Select。原启动入口指向 `app/release/composition-controls/win-unpacked/Tugou.exe`，继续使用原 preview-data。

## 验收范围

- 标尺以当前画板左上角为原点，跟随平移/缩放，支持负坐标和自适应刻度；仅生成视口范围刻度，React.memo 避免形状编辑时重复渲染标尺。
- 选中形状、图片或文字后显示像素尺寸，跟随变换；旋转后按对象边长计算，不把外接矩形当作实际尺寸。选框操作沿用既有变形、缩放和旋转。
- 顶部预设、新建画板、右侧尺寸预设复用同一个锚定浮层。保留四个预设、自定义、尺寸校验、同步缩放、取消和单次撤销，支持 Esc 与焦点返回。940×640 窗口内标题和应用按钮可见。
- “同时缩放画板内容”保留原有宽高分别缩放逻辑；不是改变画板比例后仍承诺内容等比缩放。
- 共享下拉统一深浅主题、选中态、键盘和长列表搜索，继承 fieldset 禁用状态，保留原有字符串值和 onChange 回调。超过 50 项启用虚拟列表；避免在组件 render 中测量 DOM 宽度。
- 本轮组件化的是公共选择控件及合成辅助界面，没有重写所有业务模块，也没有新增依赖、权限或网络请求。

## 组件入口

| 组件 | 文件 | 复用范围 |
|---|---|---|
| Select | app/renderer/select.jsx | 24 个界面文件、65 处选择控件 |
| BoardSizeControl / BoardSizeForm | app/renderer/board-size.jsx | 顶部预设、新建、右侧尺寸 |
| CanvasRulers | app/renderer/canvas-chrome.jsx | 活动画板坐标辅助 |
| CanvasSelection / SelectionSizeBadge | app/renderer/canvas-chrome.jsx | 选中对象的变换边框和尺寸 |
| rulerTicks / selectionMetrics | app/core/workspace-geometry.cjs | 可独立验证的刻度、旋转尺寸计算 |

采用现有 Ant Design 6.6.6 的 [Select](https://ant.design/components/select/) 与 [Popover](https://ant.design/components/popover/)，共用平台主题。公共按钮、输入、数字字段和工具浮层继续沿用现有组件。

## 验证证据

证据目录：`app/test-results/composition-controls/`。

- `unit.txt`：201 项逻辑测试全部通过，覆盖新增刻度负坐标/缩放/数量上限和旋转尺寸。
- `desktop.json`：最终源码 153 项检查通过；`package-check/packaged.json`：最终 ASAR 内 153 项检查通过。二者使用独立数据及输出目录，errors=[]，无 failure。
- `../platform-win32.json`：五工作区切换、工程与原生菜单基础回归通过。
- 桌面检查包含多画板、跨画板移动、文字、六种形状、锁定、蒙版/笔刷、保存重开、撤销重做及 PNG 导出。
- 新增专项覆盖尺寸浮层校验/预设/Esc/焦点、下拉搜索与键盘选择、继承锁定、深浅主题和最小窗口；截图逐张检查。
- `delivery.json`：10 个构建文件与实际 dist、ASAR 的 SHA256 一致，24 个原工程 JSON 哈希未变。旧 dist 和启动脚本留在 before/，旧 shape-tools 包保留。
- 可视对照：`F:/婚礼请柬/设计/标尺与公共控件优化-20261024/效果与验收.html`。截图来自实际应用的隔离验收工程。

复跑入口：`node --test test/*.test.cjs`；设置 `TUGOU_CONTROLS_TEST=1` 后运行 `electron test/shape-tools-desktop.cjs`。包内验收另设 `TUGOU_TEST_APP` 为新包 `resources/app.asar/main.cjs`，`TUGOU_QA_OUTPUT` 指向独立目录，并放入同套 engine.js、paint-engine.js、paint-detail-engine.js、before-composite.js、shape-engine.js 和 reference-assets 测试夹具。历史专项脚本中的原生 select 定位未逐一迁移，应使用上述当前综合入口。

## 质量自评

| 维度 | 分数 / 10 | 依据 / 改进 |
|---|---:|---|
| 功能 | 9.5 | 真实桌面操作、持久化、撤销和导出回归 |
| 代码 | 9.5 | 共享控件和几何函数，无新增依赖；变更集中于本轮范围 |
| UI | 9.5 | 原型对照、深浅主题与 1440/940 窗口检查 |
| UX | 9.5 | 下拉搜索/键盘、禁用、Esc、焦点及浮层边界通过 |
| 美术 | 9.4 | 已统一密度与主题；跨 DPI 细节待实机精修 |
| 性能 | 9.4 | 视口刻度上限、标尺复用、长列表虚拟化；真实大图长时压测待补 |
| 安全 | 9.5 | 原工程哈希未变，隔离测试，无新增权限或网络能力 |

整体 9.4/10，可交付。评分仅为本轮工程自评；跨 DPI、真实大工程长时使用、Mac 实机及个人操作手感继续保留为人工验收项。
