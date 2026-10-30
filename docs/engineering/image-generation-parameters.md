# 生图尺寸、分辨率与质量

## 实现与边界

`app/core/image-settings.cjs` 集中定义模型能力、合法预设和校验。生成台、右侧设置、配方和 MCP 使用同一组规则；`WorkflowService`、`GenerationService` 在最终模型确定后校验，底层 `requestImages` 再做边界检查。不合法参数在请求供应商前拦截，不通过自动重试或静默降级增加费用。

- GPT Image 2.5 Sunburst／Flare：自动、低、中、高、极高、最高；GPT Image 2：自动、低、中、高。支持官方约束内的自定义尺寸。
- GPT Image 1.5／1 Mini 及旧 GPT Image 1 标识：自动、低、中、高；固定的 1024×1024、1024×1536、1536×1024。识别旧标识只是保留现有供应商配置，不代表退休模型仍可在官方调用。
- 识别官方模型名、版本快照和供应商命名空间。未知模型显示“未验证”，保留手动值，仅做格式和一亿像素安全上限检查。官方模型规则不证明第三方供应商完整兼容。
- 现有 OpenAI 兼容 Images 协议保持不变；未新增 Gemini 原生协议。已知模型参数不兼容时保留旧值并阻止生成，用户修正后恢复。

## 界面与请求

比例、自动／1K／2K／4K 档位、实际宽高与质量独立展示。分辨率由具体像素尺寸推导，不新增重复工程字段。27 个现代 GPT Image 预设均保持精确比例，满足 16 倍数、单边 3840、总像素 655,360–8,294,400、最大宽高比 3:1 的约束；4K 为档位，方图 2880×2880，横图 3840×2160。超过 2560×1440 像素量时展示模型实验范围提示。

自定义输入使用宽度、高度两个数字框，错误就近展示。生成中和上游参数继承时禁用；模型／MCP 外部编辑同步更新选中档位。旧无效值不被自动改写。输入、撤销／重做和保存重开保留文档语义。

请求继续使用 `size: "宽x高"` 和独立的 `quality`；质量为自动时省略该字段，使用服务默认值。1K／2K／4K 只是界面档位，不作为同名 API 参数发送。文生图使用 JSON，参考图编辑使用 multipart。配方增加质量字段，其快照、版本状态、生成和 MCP 编辑同步传递。

`requestImages` 在参数校验后，仅对实际发送的提示词追加画幅要求。例如所选档位最终为 1376×2064 时，自动补充“采用 2:3 竖版构图，目标输出尺寸为 1376 × 2064 像素”，并说明不要将这些要求绘制成文字。任意自定义尺寸按最大公约数计算精确比例；自动尺寸不追加。`size`、`quality` 参数照常发送，不通过提示词代替接口参数。

编辑框、配方、MCP 编译结果、请求快照及素材的提示词仍保留原文，详情与复制不会显示自动说明。JSON 和 multipart 共用同一出口；显式重试从原快照重新计算说明，每次请求仅追加一次，不回写工程。此补充只辅助供应商理解构图，无法保证供应商返回指定像素。

## MCP 与结果检查

新增只读命令 `models.imageCapabilities`，新实例总命令数为 150：

```json
{"command":"models.imageCapabilities","args":{}}
```

省略 `model` 时查询当前共享生图模型；指定 `args.model` 时查询该模型。返回 `known`、`qualityValues`、`presets`、`resolutions`、`custom`、`limits`、官方来源和兼容性说明，不返回供应商 Key。可由现有 `canvas.create/update`、`recipe.create/update` 设置最终尺寸和质量。`generation.start` 共用服务校验，不能借 MCP 绕过共享模型限制；`task.retry` 保留原请求快照的尺寸和质量。

任务上下文、素材生成元数据记录请求尺寸和请求质量。任务另存实际尺寸；与请求不符时记录提示。结果节点同时显示请求和实际像素，生成台也提示差异。右侧元数据使用“请求质量”，避免误称已验证实际画质。原始图片字节保留，不拉伸、裁切或自动重新生图。旧结果的节点提醒可直接依据其已保存的请求尺寸计算。

## 验证证据

- `app/test/image-settings.test.cjs`：27 个预设的独立比例／边界检查，模型家族／快照、质量枚举、无效参数、未知模型、JSON／multipart、原图字节和尺寸差异记录、共享模型提交前拦截、失败后按原参数重试、MCP 能力查询和配方质量。
- 加上尺寸、工作流、配方、生成、自动化与云工具回归，共 73 项通过，日志 `app/test-results/image-settings/core.log`。
- `app/test/generation-sizes-desktop.cjs`：真实 Electron 和 MCP 桥接，34 项通过。遍历 27 个比例／分辨率组合，检查右侧双向联动、质量不改变尺寸、真实键盘输入、生成禁用、MCP 拦截、撤销／重做、尺寸差异、原图保留、继承锁定、切换模型、未知模型、配方实际请求、保存重开、深浅主题和 960×800 窗口中的向下浮层／滚动可达性。
- 报告 `app/test-results/image-settings/desktop.json`；截图 `settings-light.png`、`settings-dark.png`、`quality-light.png`、`quality-dark.png`、`result-mismatch.png`。没有未捕获渲染异常。快速浮层交互记录了 4 条 ResizeObserver 测量通知，静止后不再增加，未观察到持续循环。
- 两次隔离桌面生成均走本机模拟接口，未请求真实供应商、未消耗生图费用。返回的小图用于确定性验证尺寸不符提醒和原图保护，不代表模型画质验收。
- 自动追加画幅说明：新增检查先在旧逻辑失败，再修正共用出口；31 项核心／集成检查通过，日志 `app/test-results/image-settings/prompt-core.log`。直接读取本机 HTTP 请求确认全部 27 个预设、自定义比例、自动尺寸、JSON 和 multipart；验证原始提示词、参考图职责、质量、原图字节及按原快照重试均保留。
- 扩展隔离桌面验收至 37 项全部通过，报告 `app/test-results/image-settings/desktop.json`，日志 `prompt-desktop.log`。真实 Electron／MCP 生成与配方请求包含所选画幅，节点原文、素材元数据及实际结果详情中均无自动说明；未捕获渲染异常为零，2 条 ResizeObserver 测量通知在静止后停止。未调用外部收费接口。

## 生效与待验事项

参数界面及 150 个 MCP 命令已在运行实例验证生效。本次追加画幅说明修改共用后端请求出口，仍需保存后完整重启才能载入；当前工程有未保存修改，未强制结束或刷新用户实例。隔离实例已加载并验证新逻辑。

待 Mac 实机、真实供应商是否遵守尺寸／质量、大尺寸输出与大画布持续操作验收。未知模型仍需供应商文档或实测，不能通过模型名认定其真实实现。尚未打包发布。

## 质量自评

| 维度 | 评分 | 依据与待改进点 |
|---|---|---|
| 功能／代码 | 9.5/10 | 共享规则、服务边界、MCP 与实际请求均验证，73+34 项通过 |
| UI／UX | 9.4/10 | 深浅主题、窄窗口、键盘、联动与保存恢复通过；Mac 实机待验 |
| 性能 | 9.3/10 | 小规模交互稳定，测量通知无持续循环；大画布压力与浮层测量提示仍待进一步核验 |
| 安全 | 9.5/10 | 提交前拦截、无隐式重试、原图保留、能力查询不返回密钥 |
| 美术 | N/A | 沿用现有主题和控件，无新增美术资产 |

本轮为合格可交付的本地实现，供应商效果与跨平台待验边界不因本地检查通过而消失。

## 参考依据

- [OpenAI 尺寸与质量要求](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)、[Images 请求参数](https://developers.openai.com/api/reference/resources/images/methods/generate)。
- [Infinite Canvas 尺寸表](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/lib/media-size.ts)及[请求实现](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/services/api/image.ts)：参考分层思路，采用精确比例的本项目预设。
