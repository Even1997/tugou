# 颜色与形状选择器优化验收

形状工具入口与菜单图标改为圆角方块，弱化菜单大面积黑底，强化当前选择。新增 `app/renderer/color-control.jsx` 共享颜色组件，9 个界面文件的 14 处原生颜色输入已替换；画板、文字、形状、渐变、画笔、调整、特效及工具使用同一浮层。

颜色支持 HEX / RGB / HSB 输入及原色/新色对照。草稿仅更新局部界面，点击“应用颜色”一次写入，取消和 Esc 不提交；支持一次撤销、锁定禁用和焦点返回。颜色触发按钮为 30×30、8px 圆角，内色块为 20×20、5px 圆角。修复通用原生 input 样式挤压 Ant Design 颜色格式和 RGB 输入的问题。复用现有 Ant Design ColorPicker，没有新增依赖或网络能力。

## 证据

目录 `app/test-results/color-controls/`：

- `unit.txt`：201 项逻辑测试通过。
- `desktop.json`、`package-check/packaged.json`：源码及最终 Windows ASAR 内各 164 项检查通过，errors=[]，无 failure；数据和输出目录隔离。
- 专项覆盖圆角方形入口、六种形状选择、主题颜色面板、HEX/RGB、应用、取消、一次撤销、Esc、焦点和 940×640 窗口边界。既有多画板、保存重开、蒙版、笔刷与导出回归通过。
- `shape-menu-refined.png`、`color-editor-dark.png`、`color-editor-rgb.png`、`color-editor-light.png`、`color-editor-compact.png` 均已目视检查。
- `delivery.json`：10 个构建文件与实际 dist/ASAR 哈希一致；25 个原工程 JSON 文件哈希未变。before/ 保留原 dist、renderer 和启动脚本。
- `启动图构预览.cmd` 已指向 `app/release/color-controls/win-unpacked/Tugou.exe`。旧包保留。
- 可视报告：`F:/婚礼请柬/设计/颜色与形状选择器优化-20261024/效果与验收.html`。

复跑方式：在 app 目录设置 `TUGOU_COLOR_TEST=1`、`TUGOU_CONTROLS_TEST=1`、`TUGOU_QA_OUTPUT=test-results/color-controls` 后运行 `electron test/shape-tools-desktop.cjs`；包内复跑另设独立夹具输出目录以及 `TUGOU_TEST_APP` 为新包 ASAR 内 main.cjs。

## 本轮质量自评

| 维度 | 分数 / 10 | 依据与改进 |
|---|---:|---|
| 功能 | 9.5 | 编辑、取消、单次撤销、持久化及原功能回归 |
| 代码 | 9.5 | 14 处复用一个颜色组件，无新增依赖 |
| UI | 9.5 | 深浅主题、圆角方块和小窗口截图检查 |
| UX | 9.5 | 明确的选中态、草稿、应用、取消及焦点 |
| 美术 | 9.4 | 本机截图已检查，跨 DPI 细节仍待实机确认 |
| 性能 | 9.4 | 草稿不触发文档合成，大工程长时压测待补 |
| 安全 | 9.5 | 隔离测试，原工程哈希不变，无新权限或网络 |

整体 9.4/10，可交付；评分仅针对本轮范围，仍保留跨 DPI、Mac 和真实工程长时人工验收。
