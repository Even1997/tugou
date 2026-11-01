# 两个独立清理工具：实现与验收

已收录 v0.8.8，Windows 实现验收通过，用户确认与 Mac 新组件专项待补。基于独立桌面项目 `app/`，未改旧 Web/Go 服务。

## 使用入口

- 工具 → 智能工具 → **可见水印修复**：下载工具后，选择自动识别、框选区域或涂画区域。涂画应用后点击开始处理；框选／涂画采用显示方向的原图像素坐标，修复半径 1–20 px。复杂纹理可能模糊，自动结果标记 cleaned / partial / unvalidated，不承诺视觉无痕。
- 工具 → 基础处理 → **元数据清理**：先查看字段，点击开始处理；输出保持原格式，报告已移除与仍残留字段。ICC、方向和必要编码字段保留，不把它们误报为未清理内容。
- 两者独立手动下载，云图标／圆形进度／取消／继续下载复用现有交互。没有下载时不会自动安装；只有点击下载或继续下载才联网。下载后离线处理。原图保留，输出进入共享素材库，可并排、滑动等对比并导出。
- 自动识别及框选可批量处理，逐项验证同一参数。涂画仅处理当前图，避免误把一个蒙版应用到其他素材。

安装位置、体积、固定版本、许可和限制详见 [组件说明](../../app/runtime/cleanup-tools/README.md)。水印工具 Windows 实测环境约 518 MiB，连 Python 和缓存共约 1.1 GiB，预留 2 GiB；ExifTool 独立下载约 10.9 MB，安装约 33 MiB。依赖不会进入主安装包。没有网络时不能首次下载。

## 实现与边界

`core/cleanup-tools.cjs` 管理独立运行环境、安装和执行；复用 `runtime-files` 的下载哈希、路径/解压验证及 `local-process` 的超时和子进程取消。激活前验证组件，取消激活回滚配置；重试须显式点击，缓存保留。ExifTool 禁用外部配置加载，Python 使用隔离模式，OpenCV CPU 路径不隐式下载模型。

`core/image-tasks.cjs` 复用持久化任务、历史快照、蒙版资源、结果入库与取消机制。元数据清理比较解码像素、ICC、方向及 PNG Gamma/sRGB/色度信息；检查失败不入库。水印工具按 EXIF 的显示方向修复，归一化源快照和结果尺寸，不改写原文件。支持静态 PNG/JPEG/WebP；水印限 2400 万像素及 8 位 RGB/普通灰度输入，CMYK、16 位和灰度 ICC 输入需先转换。元数据工具不移除像素内的隐形标记。

MCP：

1. `get_state`，然后 `list_commands` 查询 `tools` 和 `image`。
2. `tools.status` → `cleanup.watermark / metadata` 的 installed/ready；MCP 不触发安装。
3. `image.metadata({id})` 查看当前工程素材的字段，最多返回 200 项，值做长度限制。
4. `image.process({ids, requestId, settings:{operation:'metadata'}})` 清理元数据。
5. 水印用 `operation:'watermark'`、`mode:'auto'|'region'|'mask'`；region 指定 left/top/width/height；mask 指定当前素材对应的 alpha 蒙版 maskId。`requestId` 防重复提交。
6. `task.wait/get/cancel/retry` 和既有素材查询／导出命令共用。

## 完成定义与验证

验收标准：两个入口均真实处理；首次手动下载、可取消重试；原图未改；选区外像素和 alpha 保留；元数据不重绘；旋转图片位置一致；结果可对比且 MCP 可调用；无渲染错误。全部 Windows 验收在独立测试数据目录进行，没有修改用户工程、重启用户窗口或调用付费模型。

| 验证 | 结果与证据 |
| --- | --- |
| 相关逻辑回归 | 52/52 通过，涵盖清理参数/MCP、任务、运行环境、安全下载与既有图像处理；`app/test-results/cleanup/regression.log` |
| Windows 真实组件 | `cleanup-native.cjs` 首次实际下载安装两个组件；最终 37 项通过。PNG/JPEG/WebP 的 GPS、XMP、作者字段；像素/ICC/方向/透明度、PNG Gamma/sRGB 和尾部数据、CMYK 拒绝；框选/蒙版范围；EXIF 2–8；未检测到原字节返回；取消与临时目录清理。`native-report.json` |
| 真实水印样例 | 上游 2048×2048 Gemini 可见水印样例，当前锁定组件约 3 秒，返回 cleaned 和检测框；`detected-watermark.png`。这是单样例结果，不能外推到所有图案与背景 |
| Electron + MCP | 最终 17 项通过：两入口独立下载状态、圆形进度、取消不自动继续、失败重试、真实元数据查看/处理、MCP 框选处理/幂等、真实鼠标涂画/应用/处理、960×720 浅色布局。无渲染错误。UI 下载时序模拟，实际下载由上一项覆盖。`desktop-report.json` |
| 视觉检查 | 已打开查看 `metadata-after.png`、`watermark-result.png`、`cleanup-narrow.png`，报告可见，现有对比工具保留，窄屏控件无横向溢出 |

运行相关逻辑测试：`node --test test/cleanup.test.cjs test/automation-coverage.test.cjs test/local-ai.test.cjs test/local-ai-status.test.cjs test/local-readiness.test.cjs test/runtime-install.test.cjs test/runtime-files.test.cjs test/image-tools.test.cjs test/raster-tasks.test.cjs`。

`node test/cleanup-native.cjs` 会明确下载组件到测试目录，首次需网络；`electron test/cleanup-desktop.cjs` 使用独立 profile，依赖上述实际组件及 `test-results/cleanup/dist` 的测试界面产物。未打发布安装包。

## 质量判断与剩余项

[ExifTool PNG 文档](https://exiftool.org/TagNames/PNG.html)说明尾部附加数据需显式删除；本实现使用 `-Trailer:All=` 并用实际附加内容验证。

Windows 当前范围可交付：功能 9.4、代码 9.5、UI/UX 9.4、性能 9.3、安全 9.4（10 分制）；美术 N/A，本次复用现有界面，无新增视觉资产。低于 9.5 的改进点：补更多复杂背景修复样本与长时/大图性能测量，增加组件安装中断的原生平台压力测试，完成 Mac Intel/Apple Silicon 真机下载与交互验收。

Mac 已提供独立锁文件、平台归档、Perl 路径和 Python 运行分支，依赖解析通过；**本轮没有 Mac 原生运行证据，不等于双端验收完成**。离线原生进程未做抓包断网专项；处理路径无下载调用，Python 模型联网开关关闭。后续发布前应补上述平台和网络隔离检查。
