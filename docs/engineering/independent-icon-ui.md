# 图标优先 UI 验收

本批以图标替代常驻功能按钮文字，沿用现有 Ant Design Icons 和深浅主题。保留工程/内容名称、参数值、状态、错误和需要完整说明的菜单选项。

## 交付与边界

- 五工作区导航、画布/图层工具栏、节点生成/取消/重试、素材操作、引用排序、图层显隐/锁定采用统一 SVG 图标。
- 共用 Button 提供图标模式、中文无障碍名称、悬停与键盘提示；选中、展开、禁用和进行中状态继续可辨。
- 调整主按钮图标对比度、素材与配方操作排列；960px 窗口在 125% 缩放时，标题栏所有按钮仍在可见区域内。
- 当前源码构建在 `app/dist`，Windows 预览包在 `app/release/icon-ui/win-unpacked`。根目录 `启动图构预览.cmd` 已指向新版，沿用 `app/preview-data`。
- 后续用户确认已保存并关闭后，已从原预览入口对应的图标包打开新版；同时验证全景入口移除及 46 项画布交互，10 个工程/任务文件哈希未变。原运行包保留，见[预览启动验证](independent-panorama-removal.md)。

## 验证证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 五工作区 UI、两种主题、键盘提示、SVG/名称/点击区域、960px/125%、真实本地图像处理 | 源码 90/90；包内 90/90；渲染错误 0 | `app/test-results/icon-ui/desktop.json`、`packaged-desktop.json` |
| 节点生成、失败重试、取消、参数、结果引用、保存恢复 | 源码 48/48；包内 48/48；渲染错误 0 | `app/test-results/workflow-nodes/node-ui.json`、`packaged-node-ui.json` |
| 画布、节点、模块/配方、素材、图层相关逻辑 | 34/34 | `app/test-results/icon-ui/targeted-unit.log` |
| 全量逻辑测试 | 167/168 | `app/test-results/icon-ui/unit.log` |
| 已测构建、源码 dist、包内 JS/CSS/HTML 一致性 | SHA-256 全部一致 | `app/test-results/icon-ui/bundle-integrity.json` |

UI 与节点测试均使用独立测试目录及本地模拟生成服务，不调用用户配置的收费模型。新增图标复用既有依赖；UI JS 从 1,888,654 到 1,911,682 字节，增加约 1.22%。

全量测试唯一失败位于 `app/test/generation.test.cjs:46`：多角度输出节点的 x 坐标断言期待 340，当前返回 410。该测试及涉及的业务代码本批均未修改；不将全量测试宣称为通过。

截图：

- [深色画布](../../app/test-results/icon-ui/packaged-canvas-dark.png)
- [浅色素材库](../../app/test-results/icon-ui/packaged-materials-light.png)
- [键盘焦点与提示](../../app/test-results/icon-ui/packaged-keyboard-tooltip.png)
- [960px / 125% 图层工作区](../../app/test-results/icon-ui/packaged-layers-compact-125.png)

## 质量自评

| 功能 | 代码 | UI | UX | 美术 | 性能 | 安全 | 整体 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9.5 | 9.4 | 9.5 | 9.4 | 9.5 | 9.4 | 9.5 | 9.4 / 10，可交付 |

未达 9.5 的改进点：代码需单独校准既有坐标断言；UX 需真实用户确认专业图标的学习成本；性能已检查包体与交互响应，密集画布长时负载未测。Mac 实机及真实模型画质不在本次 Windows UI 验收范围内。
