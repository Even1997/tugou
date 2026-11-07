# 土狗 PPT 设计标准与 MCP 接入

规范全文的唯一维护来源是 [app/core/ppt-design-standard.md](../../app/core/ppt-design-standard.md)，随应用的 `core/**/*` 打包。内容涵盖整体大纲、逐页内容、独立讲稿、候选方案对比、左规范右样例的单图方案板、自然中文文案、生图与素材工具联动，以及可编辑制作和验收。

## 获取标准

- 设计验收要求逐页调用 `ppt.preview` 获取并查看真实 PNG，修正后重新截图；同一响应提供页 ID、尺寸和 revision，每页 `ppt.present action:stop` 退出。只有元素数据或成功导出不足以证明视觉验收；仅写大纲 / 讲稿不要求截图。
- MCP 初始化 instructions 提醒 Agent 在 PPT 设计前读取完整标准，并提供主要约束摘要。
- 内置默认顺序为：写整体大纲与逐页要点 → 用户确认大纲 → 用户选择先做视觉设计或先写讲稿。讲稿分支保存 notes，不改画面、不清除内容草稿、不触发生图；设计分支确认视觉范围 → 展示方案板 → 用户选型 → 制作可编辑整稿与验收，并保留已有讲稿。完成所选步骤后询问是否继续另一项，不自动执行；已有确认与选择直接复用。普通制作请求不等于跳过确认；明确跳过视觉方案或沿用已确认设计时才省略相应步骤，局部修改不重新选型。
- `get_state` 及包含 PPT 命令的 `list_commands` 响应附带 `pptDesignWorkflow`（规范 URI 与流程提醒）；`tugou://session`、`tugou://commands` 资源返回相同提醒。这样未展示初始化指令的客户端，也能在常规发现路径中收到流程。不改变工程、revision 或已有命令参数；不含 PPT 的命令查询不附加提醒。
- `resources/list` 可发现 `tugou://design/ppt`；`resources/read` 返回规范全文，类型为 `text/markdown`。
- 仅支持工具的客户端调用 `get_design_standard {}`，同样返回完整标准。该工具只读，不接收路径或工程内容，不连接供应商。
- `prompts/get {name:"ppt"}` 返回完整标准及现有 PPT 命令使用流程。`prompts/list` 保持简短说明，避免发现时重复发送全文。

资源、工具与 PPT 提示模板读取同一份文件；修改标准后需重启 MCP 服务进程或重连客户端。已运行进程不会自动热更新。旧安装包也不会因工作区代码变更而更新，需使用包含该改动的应用版本。

标准是 Agent 可读取的交互指引，不是强制排版引擎，也不保证客户端一定遵循。询问、等待及用户答复由客户端 Agent 执行；土狗当前没有独立审批向导或代码级阶段阻断。`pptDesignWorkflow` 是规则提示，不是假定的任务阶段或用户已确认记录。读取标准不生成图片、不修改工程、不构成付费授权；执行仍使用现有版本检查和任务去重规则。

## 验证与边界

协议测试位于 `app/test/mcp-design-standard.test.cjs`，通过实际 stdio MCP 服务与 SDK 检查初始化、资源、工具、提示内容一致，以及旧资源和命令转发。规范部署在 `core` 下，不依赖仓库 `docs` 目录；v0.8.15 的 Windows 与 Mac 双架构包内验证已完成，见 [发布验收](release-v0.8.15.md)。

最初接入验证：全量测试 509 通过、1 平台跳过，日志 `app/test-results/mcp-design-unit.log`；隔离桌面 PPT MCP 33 项检查通过、渲染错误 0，报告 `app/test-results/presentation-mcp/report.json`，日志 `app/test-results/mcp-design-desktop.log`。覆盖全部 22 条 PPT 命令及实际预览、导出、保存重开；新增检查规范读取不改变工程或 revision。协议测试另验证未知资源及路径参数被拒绝、桌面离线仍可读取规范、独立复制 core 后无需 docs 即可提供全文。仅使用隔离测试工程，没有付费生图或修改用户工程。

默认交互流程补充验证：6 项协议与重连测试通过；新 stdio MCP 进程连接当前桌面，状态、PPT 命令目录、会话资源和提示模板均返回正确流程，工程 revision、dirty 及对象数量保持不变。5 项检查记录见 `app/test-results/ppt-workflow-live.json`。这是规则传达与兼容性验证，不替代实际 Agent 等待用户回答的行为验收。

三套候选样图的重新打磨、用户选型和跨主题效果验证继续列入 TODO，接入规则不表示这些视觉工作已经验收。
