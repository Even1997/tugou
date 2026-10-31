# 生图并发调度与验收

## 问题与实现

原 `TaskQueue.execution` 是所有任务共用的执行链，不同生成台会依次运行；生成台的多张图片又只发送一个 `n=多张` 请求，无法控制供应商内部是否串行。修复同时解除这两处限制。

- `core/tasks.cjs` 为图片工作流、配方和角度生图提供可调的同时运行任务数，默认 8、范围 1–32。文本、本地工具及其他任务继续使用原串行链；`execution` 只用于等待所有任务结束，不再作为生图的执行锁。
- `core/image-api.cjs` 使用 `p-limit@7.2.0` 的可变 `concurrency` 限制全局实际图片请求，默认 8 路，所有调用方共用。任务数与图片请求数分别受同一设置限制，多个生成台不会把总请求数相乘；超过上限按队列等待。当前 Node 24 / Electron 42 可通过 `require(...).default` 加载该依赖。
- `core/workflow-service.cjs` 将生成数量拆成独立 `n=1` 请求，JSON 与参考图 multipart 均保留提示词、尺寸、质量和参考素材。原有单台 1–15 张输入范围不变；并发数是多个生成台共用的额度，不是单次生成张数。
- 使用 `Promise.allSettled` 收集结果，按提交顺序编号，不按网络返回先后改写节点。部分失败或供应商请求超时时成功图片仍入库，任务面板说明成功／失败数量；全部失败保持可显式重试。用户主动取消仍停止发布结果。重试沿用原请求快照，不自动重发收费请求。
- 取消会立即结束等待并阻止队列内尚未发出的请求，正在请求的连接收到取消信号；供应商可能仍对已提交请求计费。每个图片请求使用独立关联信号，避免 15 张图片在同一信号上堆积监听器。
- `core/generation.cjs` 将图片资源的原子写入串行化，避免同时返回相同字节、同一 SHA 文件名时发生 Windows 替换冲突。网络请求仍然并发。

设置 → 模型连接新增“图片生成并发数”，提供 1–32 选项，默认 8，支持五种界面语言和设置搜索。`preferences.json` 保存 `imageConcurrency`，主进程只接受该范围的整数。启动恢复设置，保存成功后同时修改现有任务队列与 HTTP 限流器：调高立即补位，调低不取消正在运行的请求，只暂停新请求直到腾出足够额度。

MCP 的 `generation.start`、`task.cancel`、`task.retry` 沿用现有参数、实时 revision 和 requestId 幂等保护，无需客户端更改配置。任务日志和请求快照不新增供应商 Key，也不记录原始错误响应。

## 验收证据

所有检查均在隔离数据目录和本地 HTTP 测试接口执行，没有使用用户工程、真实 Key 或付费 API。桌面检查使用独立目录的最新界面产物和本次后端源码；未执行发布打包，也未重启用户运行实例。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 旧版问题复现 | 响应未释放前，无法同时收到四个请求，专项按预期失败 | `app/test-results/generation-concurrency/baseline.log` |
| 并发专项 | 15 项通过：1／8／16／32 路上限、运行中调高／调低、四路请求、第五张等待、多台与本地工具隔离、参考图、15 张相同图片、取消、部分失败／超时、显式重试与配方 | `app/test/generation-concurrency.test.cjs`、`core.log`；超时丢失成功结果的修复前复现见 `deadline-before.log` |
| 完整逻辑回归 | 434 项：433 通过、1 项平台跳过、0 失败 | `app/test-results/generation-concurrency/regression.log` |
| Windows Electron 与 MCP | 24 项界面／并发检查与 3 项完整重启检查通过；UI 修改后 8 个请求同时到达，重启后恢复 32 路并将另外 13 个请求留在队列；两台分别从 MCP 和实际鼠标按钮同时启动 | `app/test/generation-concurrency-desktop.cjs`、`desktop.json`、`desktop-reopen.json`、`desktop-stdout.log` |
| 编辑与结果保护 | 乱序响应保留编号、原占位节点与连线；单台取消不影响另一台；部分失败保留 2/3 图片；未保存文本、撤销／重做、15 张结果及并发设置保存重开通过 | 同一桌面报告；`four-in-flight.png`、`four-results.png`、`partial-warning.png` |
| 设置与兼容 | 默认值、1–32 整数校验、落盘与恢复、五语言、深浅主题和 1024 × 768 窗口通过 | `app/test/settings.test.cjs`、`settings-concurrency-dark.png`、`settings-concurrency-light-small.png` |
| 安全与异常 | 无意外渲染错误、无额外重试；运行时依赖审计 0 已知漏洞 | `desktop.json`、`audit.json` |

桌面报告单独记录 Chromium 的瞬时 ResizeObserver 通知，不将其计为生图业务错误。测试只给本地 HTTP 请求附加序号以对应提交位置，因为并发连接到达服务端的次序本身不固定；真实请求参数未增加该字段。

运行核心检查：`node --test test/generation-concurrency.test.cjs`。桌面检查需将最新界面产物放在 `app/test-results/generation-concurrency/ui/`（或设置独立 `TUGOU_BUILD_DIR`），清除测试进程的 `ELECTRON_RUN_AS_NODE` 后，运行 `electron test/generation-concurrency-desktop.cjs`，随后以 `--reopen` 参数验证完整进程重启。报告文件名相对于上述证据目录。

## 交付边界

本修复已随 v0.8.7 发布，安装包和原生三端检查见[发布验收](release-v0.8.7.md)；旧 v0.8.6 附件不变。源码预览需保存工程后重启，后端不能通过界面热更新替换。默认 8 路，可在设置中调整为 1–32；加载本次后端后，调整并发设置无需再次重启。供应商的限流和排队仍可能降低实际速度。原生 Mac 双架构包内并发检查已在发布阶段通过；未做外部付费并发、实体 Mac 交互和长时高分辨率压力验收；不承诺按并发数成倍提速，也不因部分成功自动增加请求。
