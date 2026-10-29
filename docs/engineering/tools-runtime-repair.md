# 图像工具运行链路修复（2026-10-29，未发布）

## 本轮范围与原因

当前开发预览缺少 local-runtime.json，上次组件安装已取消。本机 D:/CanvasStudioRuntime 仍有可用模型，但没有接回当前预览。
超分原先依赖抠图的 Python/ONNX 检查和图片预处理；缺少这些环境会阻断本来可独立运行的 NCNN。
界面只在打开组件弹窗后检查状态，处理成功仍可能停在原图视图。

## 变更

- 超分以 Sharp 完成方向归一、RGB 输入和原透明通道恢复，不再安装或调用 Python。
- 安装器支持分别安装超分、抠图或两者；独立保存抠图组件路径，安装任一项保留另一项配置。事务校验、取消与失败回滚不变。
- 超分仅下载约 46–52 MB，预留 256 MB；抠图保留独立 Python/ONNX 与约 490 MB 的固定模型，预留 3 GB。
- NCNN 使用自动分块，并解析 stderr 中严格匹配的百分比；设备日志不进入任务记录。停止任务仍只终止本任务进程。
- 入口直接显示组件状态、安装/修复、刷新；缺组件及已知内存不足时不允许提交。MCP tools.status 增加 readiness，image.process 使用同一后端检查。
- 完成后自动切到原图/结果对比；保留原图、历史结果、入库撤销和保存重开行为。
- 已在原配置缺失时将本机已有组件接回 preview-data/workspace，自动选到 DmlExecutionProvider；没有修改工程内容或供应商配置。

## 验证证据

- 58 项单元与回归通过：安装事务、分离安装保留配置、缺 Python 的超分、内存检查、取消、文件校验与安全解压、图像算法、云端参数/失败处理。云端采用模拟接口，未发生收费请求。
- 9 项实际原生检查通过：真实下载安装/哈希/解压/启用，无 Python 的三模型推理，半透明 PNG 像素保持，真实进度与取消后清理。
- 13 项 Electron/MCP 检查通过：缺组件前置阻断、安装默认项、UI/MCP 状态一致、真实超分入库、自动对比、内存不足的前置阻断、保存重开、零 renderer 错误。
- 界面实际将 512×768 放大为 2048×3072；检查截图布局与尺寸标签。
- 证据目录：app/test-results/tools-repair/；unit.log、native-report.json、desktop-report.json、ready.png、comparison.png。

## 开源实现参考

- Real-ESRGAN NCNN 的自动分块、CLI 参数与进度输出：https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
- Sharp 原始通道操作：https://sharp.pixelplumbing.com/api-channel/
- Upscayl 作为使用流程参考：https://github.com/upscayl/upscayl 。未复制其 AGPL 应用代码。

## 边界与待验收

- 精细抠图模型已安装，但当前 Windows 可提交内存低于现有保护阈值。本轮验证了 UI/MCP 预先拒绝，没有宣称成功完成该环境下的抠图推理；未下调安全阈值。
- macOS 原生安装、Vulkan/MoltenVK 与设备驱动仍需真机验证。无支持显卡时明确提示，不把普通插值冒充 AI 超分。
- 未实测真实云端付费编辑接口；不能据此宣称全部工具与所有供应商均可用。
- 本轮未发布版本或重启用户实例。

## 自评

功能、代码、安全 9.5/10；UI/UX、性能 9.4/10（仍需 Mac 真机、长时大图及内存充足时的精细抠图复测）。美术 N/A：沿用现有工具界面，无新美术资产。结论为可交付，未将跨平台或精细抠图实测列为已完成。
