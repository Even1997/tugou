# Atelier 实施检查点

## 100MP内存保护补验（2026-10-21 22:11，当前优先状态）

- 当前空闲内存不足，不能完成100MP新模型推理。atelier-detail-memory-guard.py流式生成有效100MP PNG，实际已装worker在271ms明确拒绝，未加载模型/生成结果，原图hash不变。报告atelier-detail-memory-guard.json、说明atelier-detail-memory-acceptance.md；不是完整成功路径或低VRAM验证。
- 首次复用历史大图时文件不存在，失败记录留在guard-100mp，不作验收；有效结果在guard-100mp-valid。无产品改动/安装/收费请求/其他进程关闭，目标active，新保护证据计进展，no-progress=0。不要原样重复这项测试；余下需要资源余量、未覆盖真实素材/视觉模型/供应商协议和正式窗口交付条件。

## 125%/150%缩放补验（2026-10-21 22:08，当前优先状态）

- 新增atelier-scale.e2e.cjs，使用真实第十四批候选服务及既有花束任务，两个设备缩放×两个窗口共4组通过；工具/下拉命中、模式切换、按钮可见、工程/任务列表不变，截图目视。没有新推理/收费API。证据atelier-scale-acceptance.md及两个JSON/四PNG。
- 独立Electron强制DPI且关闭GPU，只证明页面缩放；系统多屏拖动、原生窗口按钮及全部页面不在范围。无产品改动，不重打包，候选和正式状态不变。QA服务59263已结束，Electron均退出。此轮有新验收进展，连续无进展数0；禁止原样重复测试当作下一轮进度。

## 第二款云端模型已排除（2026-10-21 22:03，当前优先状态）

- atelier-sunburst-size.cjs隔离读取密钥，仅内存改用已列出sunburst；一次2048²请求HTTP200仍1254²，无自动重试，原始图和报告保留。全阶段累计4次。原图和返回均目视，纯色色块/背景增加纹理、猫眼毛发重绘，功能8.5/美术8.8未过，不打包产品。
- 报告atelier-live-upscale-sunburst.json，说明atelier-sunburst-acceptance.md。进程98132已退出，QA加密Local State删除；22:03两旧工程/15资源/凭据复核一致，正式仍第十批。候选仍第十四批Paz74-5XQWo3pjM9rkxdv。
- 新增atelier-delivery-status.md作为当前状态入口，TODO旧首段已校正。完整目标active，后续不再原样重测这两款模型2K/4K、不猜协议或补视觉模型名。此次是排除替代通道的新证据，旧连续无进展计数不沿用。

## 第十四批精细主体识别候选（2026-10-21 21:54，当前优先状态）

- 明确真实旧IS-Net问题：花束浅底主体保留64%、纹理底0.29%。新增精细通用BiRefNet FP16 worker，模式随任务保存；有精细组件的新任务默认detail、旧无模式任务保持standard。6图core筛查旧2/6新6/6，5.38–6.14s，原RGB/尺寸保护；不改历史全Alpha实验结果。
- 实际4K(4096×2731)透明保护7.52s，约1118万像素全部RGB/Alpha上界断言；新模型GPU采样约9.86GiB。内存保护2GiB+图像缓冲/提交14GiB+缓冲，首次4GiB保守门槛被本机3.3GiB空闲拦截，按实测通用模型约1GiB工作集修正。不是专用matting模型，也不宣称100MP/低显存通过。
- 真实venv取消没有遗留进程，原run逻辑不需改。真实DML加载后取消127ms、worker/launcher退出；等待worker3ms。12项工具回归、类型/Python/安装PS解析、build通过。
- 新候选D:/CanvasStudioDetailQA/CanvasStudio-win32-x64，build Paz74-5XQWo3pjM9rkxdv。最终包实际Electron模式切换/生成/入库/重开、1300/960截图目视、真实服务重启均通过。证据atelier-detail-cutout-acceptance.md及相关JSON。未新增CSS或依赖。
- 已新增模型/worker/MIT/model-card到D:/CanvasStudioRuntime/segmentation，旧IS-Net hash60920...一致，旧配置未变；原2工程/15资源/密钥复核通过。正式仍第十批隐藏，未更新。QA服务30162/73220和测试/推理均结束。
- 用户继续后的新审计为实质进展，goal已实时读为active；旧blocked计数不沿用。后续继续真实AI能力/更多照片和正式交付，不能回到等待柔光。精细新模型已采用且可交付有界增量，美术/性能9.3，完整目标未完成。新脚本测试目录含指向真实运行库的junction，不可递归清理。

## 用户已明确默认主体提取口径（2026-10-21，当前优先状态）

- 用户回答柔光“看用户”，正常流程是识别主体后抠出。已将默认验收改为主体完整/背景去除/真实细节；外围柔光不强制保留，也不按低Alpha统一删除。见atelier-cutout-criteria.md。
- 原9图原Alpha还原、固定标记等记录继续保留，不能用其0/9或实验8.5分直接代替普通主体抠图验收；亦不能反向宣布模型通过。后续按主体区域/背景/真实细节/可选效果分别评估。客观显存和真实API尺寸问题继续有效。
- 柔光偏好已解答，不再列为等待条件，不再追问。仅更新验收文档与审计注释，无模型/API请求、源码/依赖/安装包更改。此前连续无进展记录为历史，不能在新用户澄清后直接沿用为新的阻塞审计。

## 固定前景／背景标记路线排除（2026-10-21 19:44，当前优先状态）

- 在新隔离脚本atelier-guided-matting-proof.py中复用PyMatting，用明确几何标记、不读取真值生成trimap，测试768²薄纱三背景。种子/原图保护通过，但0/3透明度筛查通过，12.406–21.708秒；美术8.5、性能9.0未过，不增加产品入口。日志保留Cholesky重试警告，没有新的依赖或模型下载。详见atelier-guided-matting-evaluation.md和results.json。
- QA45049已正常退出，launcher26656/实际python31112均结束。上一轮36720正式进程仍响应隐藏，19:44实际只读验证旧2工程/时间戳、15资源、密钥均一致，正式amyk6OypARE8BiyQjaxPU/候选eNMKEaN7IDIBsYcy8IG7U。公共配置图像key/model已存在，analysisModel仍空；原供应商能力问题/柔光偏好尚未回复，不重问、不收费重试。readiness-guided-matting.json为本次实证。
- 本轮是新方法可行性排除进展，目标active。当前可用自动模型及这两种trimap路线均未过，先等待已询问的实际画质保留目标/供应商信息与正式开窗；不要继续凭空新增模型试验或把已失败算法包装成产品。后续自动续轮若没有新证据/条件，按真正无进展审计累计，达到三次阈值设置blocked，不能无限写重复状态。

## 专用 matting 可运行，但画质与显存未通过（2026-10-21 19:38，当前优先状态）

- 新增已知Alpha9图基准（情侣/花束/解析薄纱，各3背景），通用/portrait/专用matting均实测；严格筛查0/9，并非等于主体提取全不可用。柔光保留目标已询问未答，原API协议问题亦待回复，不重问。见atelier-alpha-benchmark.md。
- 专用FP16已成功：文件形状推断 + ORT transformer转换器修正Cast，36.625s。489658479字节，SHA9e2757b2118c60d085dc0109fd8b23e29543fdc20598c0455ad727aa63f808fc，路径D:/CanvasStudioBiRefNetQA/BiRefNet-matting-local-fp16-ort-file-shapes.onnx。没有FP32数值等价证据。前两种checker通过但实际加载失败的转换不得使用/重复尝试。
- 实际3图各2次推理，加载3.857s、首次2.481s/后续.863–.874s；全部原图/RGB/Alpha保护通过。前景颜色估计三图全部目视，猫须改善，男士仍细黑线，美术9.2未过。9图半透明误差下降但仍未过。证据matting-fp16-results/alpha-benchmark/foreground/conversion。
- 新资源追踪31采样：专用GPU11250.5MiB、共享1442.4MiB、进程树工作集4711.6MiB/私有13707.2MiB；性能9.0未过，不默认集成。profile41kernel均DirectML，不据此归咎CPU回退。首次采错venv启动器已修正并重跑；原无效记录保留。QA Python4文件语法、PowerShell解析通过。所有下载/转换/推理进程已结束。
- 本轮没有产品改动、打包、安装或收费API；最新候选仍第十三批eNMKEaN7IDIBsYcy8IG7U，正式第十批等待用户稍后开窗。目标active，本轮有新模型/测量进展，无连续阻塞计数。后续不再只换模型重复三图：需要明确柔光验收目标、实拍半透明依据或实质资源优化方法；云端尺寸/异步/视觉模型和正式交付仍为外部门禁。

## 完整1024 FP16模型可运行（当前优先状态）

- 本轮取得不同于Lite的实质模型进展：onnx-community/BiRefNet-ONNX固定534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67的model_fp16.onnx，489666272字节，发布sha3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09已匹配。位置D:/CanvasStudioBiRefNetFullQA，README/预处理/MIT均保留，download34469结束。不要重复下载或再做本地转换。
- proof.py新增FULL模式（不能与LITE/CPU同开），实际DML输入float32/[1,3,1024,1024]，加载5.249s，三图各两次0.492–0.607s，尺寸/RGB/Alpha/源文件保护通过。峰值工作集951.1MiB、私有提交11667.6MiB，非显存测量。进程已正常结束。stderr存在constant-folding警告但推理全过，不能说没有警告。
- 已看全部白/黑底原结果及一次foreground_ml颜色估计；男士细亮边改善但略黑，猫须仍损失，美术9.2未过。foreground脚本增加FULL模式，新Alpha下0.191/.062/.092秒，Alpha/不透明RGB保持。未改默认运行库、未集成/打包。证据atelier-birefnet-full-results.json、foreground.json、evaluation.md。
- 下一步必须扩大为已知Alpha合成背景误差/头纱装饰等样本，并补推理峰值显存及与编辑器共同运行资源；不再只重复三图调参。正式36720仍响应隐藏，第十三批eNMKEaN7IDIBsYcy8IG7U仍待安装。目标active，本轮为进展，无连续阻塞计数。云端协议/视觉模型问题仍待用户回复，不重复询问。

## 渲染追踪校正（当前优先状态）

- 上一轮诊断为进展，本轮取得调用记录和实际滚轮输入证据，仍为进展，无连续阻塞计数。trace最长380ms几乎全部为验收scrollIntoView触发的ScrollLayer；Layout/UpdateLayoutTree/Paint累计82/82/65ms，不能声称500卡片重复布局是主因。无产品改动。
- atelier-thumbnail-profile.cjs增加TRACE/WHEEL/VISIBLE模式，Chromium Input.dispatchMouseEvent隐藏窗口两轮0→3420px通过，首轮部分磁盘缓存最长任务57ms，重复轮无50ms以上任务。证据atelier-thumbnail-trace.json/wheel.json；native sendInputEvent隐藏窗口未滚动，不能算通过。可见窗口尝试缩略图超时、截图Current display surface not available for capture，atelier-thumbnail-visible.json保持失败。详见atelier-thumbnail-investigation.md，不外推可见人工验收。
- QA服务16813（PID34348）已停止，最后隐藏输入测试78184完成，先前可见65452已停止。没有模型请求/产品包/正式数据改动。不要重跑相同滚动诊断；核心剩余仍为画质/供应商能力/视觉模型/正式开窗安装。抠图若继续，只调查不同的可运行完整精度模型产物或方法，不再对同三图重复Lite调参；可考虑核查已发布的完整模型低精度ONNX是否能绕过本地转换内存门禁，但未经验证不能承诺。

## 冷缩略图定位（当前优先状态）

- 新诊断证据明确冷热差别：独立空缓存跳转1305–1541ms，长任务最长567ms；同窗口相同滚动热缓存0.7–1.3ms，无长任务。源码冷缩略图串行队列；不能声称唯一根因，需调用栈才能量化。证据atelier-thumbnail-profile.json / atelier-thumbnail-investigation.md。
- 编码effort0试验22图704→576ms但有顺序缓存偏差、RGB变化，未接受为产品优化。保留原编码和串行内存约束。新测试studio-thumbnail-encoding.mjs及atelier-thumbnail-encoding.json。不要原样重复本轮压力或编码试验。
- 无产品改动/新包，最新候选仍eNMKEaN7IDIBsYcy8IG7U，正式仍第十批隐藏待用户稍后开窗。新D:/CanvasStudioThumbnailQA/atelier-qa/resources为指向原QA resources的junction，不能递归清理；其余目录为本轮隔离缓存/工程。服务27571与测试59297已结束。目标active，本轮诊断提供新证据为进展；完整目标仍不满足。

## 500 张独立 4MP 素材验收（当前优先状态）

- 上一轮修复为进展，本轮完成此前缺少的独立大像素素材验收，也为进展。总目标active，无连续阻塞计数。新脚本 desktop/tests/atelier-large-library.e2e.cjs，证据 atelier-large-library.json / atelier-large-library-acceptance.md。
- 第十三批候选真实服务下500张像素内容不同的2048² PNG，共393633812字节；lazy响应113542字节/31ms，首屏36缩略图。三轮75滚动+一次重开，浏览仅缩略图，选中原图逐字节一致。全测试Electron+Next私有峰值742MiB，38秒样本，冷缩略图P95 1011ms/UI心跳最长944ms，不能称无限时长或500层同时合成通过。
- 仅新增验收脚本/文档，无产品代码改动或新包；正式36720仍响应隐藏，候选eNMKEaN7IDIBsYcy8IG7U未安装。用户稍后开窗/供应商协议问题不再追问。QA3439进程32596（session76852）与测试34447已结束。保留QA大素材供后续复用，避免重复生成占磁盘。
- 当前剩余实质门禁仍为抠图画质（Lite9.0/原8.8）、真实云端目标尺寸/禁用异步API、缺视觉分析模型，以及正常开窗后的安装；不要用更多同质小测试替代这些门禁。冷缓存约1秒等待是本轮识别的性能改进点，若继续独立工作应先调查原因而非原样重复压力测试。

## 本地批量离页修复（当前优先状态）

- 复现并修复本地批量离开工具页后继续提交：image-tool-panel.tsx 每次提交前检查 alive，与云端一致。真实候选 Electron 红绿验收：旧包2次提交失败，新包1次通过；已接受任务完成/重开保留/普通2张批量通过。类型及构建通过。
- 最新候选第十三批 `eNMKEaN7IDIBsYcy8IG7U`，`D:/CanvasStudioBatchQA/CanvasStudio-win32-x64`；正式仍第十批，进程36720响应隐藏，用户稍后开窗，不重问或强制结束。未调用模型API，未替换抠图模型。
- 新脚本 desktop/tests/atelier-batch-navigation.e2e.cjs，证据 atelier-batch-navigation-before.json / atelier-batch-navigation.json / atelier-batch-navigation-acceptance.md。QA3439服务本轮结束时停止；旧23624为本轮已确认的QA服务，已停止。完整目标active，本轮有实质修复，无连续阻塞计数；仍待供应商协议/视觉模型回复和抠图画质改进，不重复同条件收费试验。

## 真实增强/放大与异步限制（2026-10-21 18:36，当前优先状态）

- 前一轮Lite为实质进展，本轮完成2次真实模型请求与认证协议核查，也为进展；总目标active，无blocked连续计数。完整需求未达，不能标完成。
- 新web/tests/studio-live-cloud-quality.mjs enhance/upscale各发送1次（已有报告拒绝重发）：同一公开CC0猫+固定文字/色块1024源图，请求1024增强/2048创意放大，26418/25999ms均返回1254方形。记录atelier-live-enhance.json/upscale.json与D:/CanvasStudioLiveQA/*-provider-output.png。默认尺寸检查均failed，不能改记录或重复发。此前live-edit也是唯一一次，总本阶段真实图像请求3次，费用未查；无用户照片上传。
- 已目视源图/两返回/增强对齐：文字布局保留，毛发/眼部/背景色调有重绘，不能称保真通过。新studio-live-enhance-recovery.mjs缓存明确缩小1024，186ms、1048576连续Alpha像素一致；无新调用。创意放大1254<2048不能恢复，不插值冒充。
- 新desktop/tests/atelier-provider-capabilities.cjs认证GET只读核查：/v1/models返回flare/sunburst但无能力参数；/v1/images/batches/models明确404 BATCH_IMAGE_DISABLED。报告atelier-provider-capabilities.json。只在独立Electron内存读取现有密钥访问配置HTTPS主机；首次独立profile解密失败后复制加密Local State进行核查，退出后QA副本已删除；原配置/密钥未变，未打开正式窗口。该脚本不生成图片。
- 已通过request_user_input_async询问供应商2K/4K和异步API说明、视觉分析模型名（无需密钥）；尚未答复，不再次问。当前API有配置且能生成，但高分辨率/异步未满足；视觉分析仍空。不要猜测image_size替换同步size，不再向禁用批量接口发收费任务。
- 正式18:35:49只读旧2工程/时间戳、15资源、凭据一致，main36720响应且隐藏；正式build amyk6OypARE8BiyQjaxPU，候选UaH5o0YgMACcUjYkVuQUA仍待用户开窗。无产品源码改动，无新包。生成sessions36159/29778、公共资源读取40549及Electron协议检查全部结束。见atelier-live-cloud-quality-acceptance.md（云端功能8.5/美术8.8未通过）。下一步先推进本地异常/批量/工程剩余验证，等待协议/模型信息；不重做同组模型试验。

## 轻量候选可运行、画质未通过（2026-10-21 18:27，当前优先状态）

- 前一轮为进展，本轮也有新实测，目标active，无blocked连续计数。用户仍稍后开正式窗口，未重新追问/强制结束，最新候选UaH5o0YgMACcUjYkVuQUA未安装；正式amyk6OypARE8BiyQjaxPU数据18:26:44复核一致。
- 原大型模型FP16本地转换亦内存保护退出，未产出：desktop/tests/atelier-birefnet-fp16.py；D:/CanvasStudioBiRefNetQA/converter-libs独立onnx1.17.0/onnxconverter-common1.15.0；conversion.log/stopped.json；不要重跑相同条件。安装59089/转换57428已终止。
- 下载并实测社区studioludens/birefnet-lite-512固定962e67969ec6acec9c19fab76acee4f5e22e990c的onnx/model_fp16.onnx，98484532字节，发布LFS SHA256 eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516匹配；MIT许可证保留。目录D:/CanvasStudioBiRefNetLiteQA。下载99087完成；没有替换产品运行库或默认IS-Net。
- 复用proof.py加STUDIO_BIREFNET_LITE=1实测3图各2次全部成功：加载4.297s、首次.594s、其余.096–.105s，工作集峰值467.7MiB/私有提交4032.5MiB（非RAM/VRAM）。RGB/原文件/尺寸/Alpha断言通过，已看全部黑白底并与ISNet比较。细发丝削减/亮边仍在，美术9.0未达标，非大图或产品验收。证据atelier-birefnet-lite-results.json。
- 已复用现有去白边工具试两图（新studio-birefnet-lite-edges.mjs），Alpha/不透明RGB保持，但边缘偏黑；PyMatting仅前景估计（新atelier-lite-foreground-proof.py，STUDIO_MATTING_ISNET可对照）也无法补回缺失细发丝。输出LiteQA/white-fringe-*、foreground-estimate、isnet-foreground-estimate。不要再把三图调参当完整质量验证，下一步优先其余真实云端工具/尺寸/异步协议；缺视觉分析模型。抠图下一步需新方法或广泛样本，不原样重复本轮模型测试。
- 本轮无产品代码修改、未重打包、收费请求0。全部推理/下载已退出。详见atelier-birefnet-lite-evaluation.md。

## 对齐大图与BiRefNet实测补验（2026-10-21 18:16，当前优先状态）

- 本轮无产品代码/包改动，第十二批候选UaH5o0YgMACcUjYkVuQUA仍待正常开窗后发布，正式仍第十批；不重新询问或强制结束。无新增外部请求。
- 新脚本web/tests/studio-generation-align-large.mjs complete/cancel全部通过：100MP合成返回显式缩到64MP，1520ms、处理峰值647MiB；全部6400万像素验证，其中4800万保护区RGBA一致，含验证峰值875MiB。100ms时取消，971ms后拒绝，峰值350MiB；原生缩放不是即时可取消。两个JSON证据atelier-align-large-*.json。
- web/tests/studio-live-edit-feather.mjs复用已收费返回：矩形sigma8软蒙版，806588零覆盖像素一致，51892羽化像素，采样边缘通道跳变4→1。已查看D:/CanvasStudioLiveQA/feather-comparison.png，硬接缝弱化但背景色差仍在，美术8.8不通过。不新增重复控件或默认羽化；现有选区工具可配置并捕获，实验Sharp与浏览器blur不等价。见atelier-alignment-quality-followup.md。
- BiRefNet现已实际尝试，不再称“未推理只因6GiB门禁”：第一次DirectML因初始私有提交4GiB保护退出（提交≠RAM）；修正为物理/提交余量保护后DirectML首次推理真实报DmlFusedNode_15_51 8007000E内存不足；CPU对照在19.2秒触发物理余量保护（仅354MiB，工作集5249.6MiB），无完成图。所有测试已结束（CPU session83688已退出），不改条件重复运行FP32本候选。源脚本保留守护；下次应评估轻量/低精度替代，不降低保护赌运行。详见atelier-birefnet-evaluation.md。
- 18:15:45正式只读复核：2旧工程内容/时间戳、15资源、凭据不变，服务/本地工具正常；物理空闲约5.54GiB，测试模型进程无残留。总目标继续active，本轮有实际大图/取消及模型兼容性证据，不标完成。剩余真实其他云端操作、异步协议、分析模型、复杂画质与正式安装。

## 第十二批候选完成（2026-10-21 18:06，当前优先状态）

- 候选 `UaH5o0YgMACcUjYkVuQUA` 在D:/CanvasStudioReviewQA/CanvasStudio-win32-x64，包含第十一批导出修复；先前Tt5Zz3dEhsLSkvdI221n9为中间候选，已被替换。正式仍第十批amyk6OypARE8BiyQjaxPU/main36720，隐藏且响应。用户稍后打开，不强制关闭/替换，不再问确认。
- 已修复模型原始图丢失：生成processor saveRaw回调在后处理前保存资源与job.rawResult；错误进入review；重启已有raw的任务也review，不自动收费重发。队列resolveSize只有显式确认且同比例更大尺寸才排队本地缩小，resolution=fit走保存的raw、不调用gateway；取消与迟到仍受保护。普通/原始图独立保存和去重、撤销重做；使用raw:ID隔离（普通job ID不允许冒号），碰撞测试先红后绿。generation-task-list复用预览组件，没有新增CSS或依赖。
- TypeScript和18项相关回归通过，生产构建/打包完成。真实缓存1254输出显式对齐1024，833280个选区外像素RGBA一致、中心蓝色，脚本约224ms，新收费0次。最终候选Electron API+UI通过：raw字节、查看保存、撤销重做、重开、确认取消、对齐、两份素材入库、重复确认不重处理；1300/960截图已查看，控制台0错误。证据atelier-generation-review.json/png、-960.png、atelier-live-edit-aligned.json。
- 实际Node候选服务停启后raw/完成图哈希不变；空API配置下仍可本地对齐，atelier-review-restart.json。最终QA session24313已主动停止；80048/97982/46062也已停止。Electron93618已退出0，构建8512、打包8980均结束。无后台测试或真实请求在运行。
- 正式只读复验原2工程内容/时间戳、15资源和加密凭据不变。原回滚D:/CanvasStudioBuild/rollback-before-alpha仍保留，未再次发布。见atelier-generation-review-acceptance.md；功能/代码/安全9.5，UI/UX9.4，性能9.3（新路径只实测1MP）；美术8.8仍不通过：已查看aligned-output.png，矩形选区背景轻微色差接缝明显，不能把几何图成功当复杂图片画质通过。
- 下步：优先利用缓存返回图研究既有任意选区/羽化如何避免背景矩形接缝，不重复收费；补新对齐路径大图内存/取消；继续真实增强/创意放大/扩图/语义蒙版及供应商异步协议。已有xymm生图配置可用，**只有analysisModel未配置**，不能回退为“API全未配置”。BiRefNet文件完整，6GiB保守QA门禁未满足，当前约5.05GiB可用；未推理，不要重复下载。当前有实现和最终包验收实质进展，目标active，无blocked连续计数。

## 下载完成与真实接口发现（2026-10-21 17:44，最高优先级）

- BiRefNet下载全部完成：972667742字节，SHA256 `6065d27c615ea27308f5b88598dd8db116eb07436c7a323ca40d13b2866c309e`。所有下载session30364/43482/66605/62333均已结束；最后62333退出0。元数据D:/CanvasStudioBiRefNetQA/download-complete.json，脚本固定此本地摘要（非上游摘要）。实际启动在加载模型前因空闲2.9GiB未达到保守6GiB测试余量而退出，尚无推理/画质结果。不要重复下载或声称模型已验收。
- **纠正API阻塞判断**：只读正式3418 config发现xymm.win、gpt-image-2.5-flare已有密钥标记；models真实连接成功，只列flare和sunburst，analysisModel为空。未改设置/未读取或打印密钥。不能再笼统说所有API未配置，只有视觉分析仍未配置，生图可继续验证。
- 一次真实Images edit已完成（session76247结束）：web/tests/studio-live-edit.mjs使用本机几何图、1024方形+蒙版、中央红圆改蓝；21484ms返回1254方形。已查看D:/CanvasStudioLiveQA/provider-output.png，语义改色成功但尺寸错误，生产finishCloudImage正确拒绝合成，未覆盖原图。独立证据D:/CanvasStudioLiveQA/live-edit.json及docs/studio-evidence/atelier-live-edit.json。不重复运行此脚本：已有报告会拒绝自动重发。此次1个真实图像请求，费用未查；原用户图片未上传，正式工程/资源/配置未改。
- 最新阻塞不是“API没有密钥”，而是尺寸协议不一致和真实更多操作待验。官方OpenAI文档确认模型支持1024×1024；不应偷偷缩放来使测试通过。发现产品后处理错误会丢掉已付费原始返回图。**下一步优先修复原始结果持久保留/查看/保存，加入明确的对齐选择后再合成，默认仍拒绝静默缩放**。涉及generation-schema.ts、api/studio/generation-queue.ts、generations.ts、cloud-image-tools.js、generation-task-list.tsx/collect-generation.ts及共享任务入口。需失败/取消/重启/跨工程/迟到结果和真实返回图缓存重用验收，先利用已有1254返回图，勿无谓收费重试。
- 供应商公开批量界面发现真实异步协议线索（尚未调用）：/v1/images/batches（POST+Idempotency-Key）、/{id}、/{id}/items、/{id}/items/{custom_id}/content?image_index=0，模型/v1/images/batches/models。参考公开JS `https://xymm.win/assets/BatchImageGuideView-Bniwloh1.js`，UI固定image_size=1K；不能推断批量模型/精确尺寸能力。来源与边界详见atelier-live-provider-acceptance.md。OpenAI Docs skill本轮已读，官方image-prompting#model-parameters已打开；未改模型选择。
- 正式main36720仍响应但窗口句柄0；用户仍稍后打开，候选FJ-KhKV-lEWkx6ufrG5CU未安装。当前无下载/推理/真实请求在运行。此轮有完整模型产物和真实接口失败证据，明确改变下一步，属于实质进展，目标active，不满足blocked条件。

## 队列超时验收补齐（2026-10-21 17:22）

- 在原测试中各补一项本地30分钟/生成10分钟超时行为验证，未改生产逻辑。拦截并主动触发实际定时回调（未等待真实30分钟），处理器故意迟到；确认收到AbortSignal、本地迟到文件清理/生成结果不发布、后续排队任务完成、失败状态持久化、重开不自动重发、本地来源快照保留。
- `node --test tests/studio-tools.test.mjs` 11/11通过，`node --test tests/studio-generation.test.mjs` 6/6通过，均在web目录；不把模拟处理器当成真实API计费或GPU进程取消验收。本轮没有新增产品功能或重打包，现有候选仍有效。
- 下载session30364经write_stdin再次确认仍运行；17:21:34已有262221824字节，继续同一下载，不重启。空闲内存约2.43GiB，专用模型仍不能在保守余量条件下加载。继续等待实际下载/内存条件，正式窗口/API待用户，不反复追问。上一轮为模型准备进展，本轮补齐关键异常证据，尚非全目标完成。

## 本地抠图模型评估（2026-10-21 17:19，当前）

- 用户仍是“稍后打开”，正式桌面与第十一批候选保持下述状态，不再请求或强制唤起；API仍稍后配置。
- 已查到官方专用 BiRefNet matting ONNX，替代泛用模型做下一次对比。官方下载URL `https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-matting-epoch_100.onnx`，精确大小972667742；release digest为空，不能宣称有上游SHA256。MIT模型卡/许可证已核对，许可证与元数据保存D:/CanvasStudioBiRefNetQA。见atelier-birefnet-evaluation.md。
- 下载在D:/CanvasStudioBiRefNetQA独立目录，exec session30364运行中，17:18:40为133033984字节；单次curl最多600秒，低速45秒退出，保留断点，无内置重试。原session58334已主动停止以移除会重用旧断点的内置重试，并从已有字节续传，不能同时重复下载。下一轮先检查session/完整大小再决定续传，别重启仍活动的下载。
- 新增desktop/tests/atelier-birefnet-proof.py，仅独立QA，沿用现有segment-python的ONNX/DirectML依赖。按官方教程BILINEAR 1024、ImageNet归一化、末输出sigmoid（不做额外minmax），对比原两人物与Chelsea。每图两次、原RGB/原文件/尺寸/Alpha不增检查、黑白底预览和进程峰值。语法及Windows内存计数函数通过；尚未推理，绝不能称画质/性能通过。
- 当前空闲内存2.89GiB，脚本在模型加载前要求保守6GiB QA余量（非实测模型最低要求）；不结束其他应用腾内存。模型下载及内存均需满足才运行。原美术8.8仍未通过；新模型未接入产品，运行库/正式数据/候选包未修改。此轮有模型筛选与验证准备进展，目标active，无连续阻塞计数。

## 第十一批候选（2026-10-21 16:59，优先状态）

- 用户明确“稍后打开”正式隐藏窗口。新包准备好后保留，不重复询问，不强制结束应用；正常关窗条件未满足时不替换正在运行的第十批。正式main36720/build amyk6OypARE8BiyQjaxPU；回滚before-alpha保持。API也仍稍后配置。
- 导出生命周期已修复：顶部取消/正在取消，格式锁定；离开工作区或切换工程取消；忙碌编码接受取消并在退场后清理，发布边界之后不删除成品。任务容量在mkdir前预留，根目录隔离。重启首次导出扫描严格UUID partial目录，只逐文件清理已知png/output；未知内容、链接、成品和活动任务保护。
- 新4项生命周期回归先失败后全绿，原2项真实候选API回归、TypeScript和构建通过。候选FJ-KhKV-lEWkx6ufrG5CU在D:/CanvasStudioExportQA/CanvasStudio-win32-x64。QA3439 session37827数据atelier-qa，Go8080可保留。真实Node3441重启测试结束，旧分块清理且成品字节一致；最终Electron顶部取消197ms、切工作区取消、取消后成功导出精确RGBA、控制台0错误，截图已查看。见atelier-export-lifecycle-acceptance.md、atelier-export-cancel.json/png、atelier-export-restart.json。
- 六轮29层100MP耐久完成且进程退出，atelier-export-endurance.json通过，320采样/321943ms，六轮完整RGBA一致，29.7–49.3秒，峰值1458MiB，UI探针407ms。闲置总650/662/732/558/495/825MiB，页面113/73/72/72/75/73MiB，GPU313/366/435/249/194/409MiB，Next131/131/134/145/134/252MiB，有回收非逐轮增长。解码验证在采样后，不能称无限时长或500独立大图。最终960布局再次取消206ms通过，截图已查看；QA37827现已停止。
- 耐久结束后已在D:/CanvasStudioMattingQA/venv安装独立PyMatting1.1.16/numpy2.2.6/Pillow11.3/scipy1.15.3/numba0.68/llvmlite0.50，原抠图runtime没改。三种自动trimap试验全部目视不合格：默认留灰边/块状边缘，高阈值破坏白衣和宠物眼睛，边界带保护内部但原蒙版背景块仍在。结果分别results、results-wide、results-boundary；当前脚本desktop/tests/atelier-matting-proof.py保留边界版，进程均结束。第三版已知前景RGB字节一致，0.446/0.140/0.208秒，但不证明画质；第一版float32/64比较false不是真实字节变化。见atelier-matting-experiment.md，明确未接入产品。
- 下一步优先评估更合适本地分割模型/人工边界约束，再做局部matting；不是继续盲目加收缩/阈值。需模型许可/下载SHA/实际资源与大图/取消验收。原美术8.8未通过；此次后处理方案8.0未通过。PyMatting官方例子和MIT链接在试验文档。真实API/供应商异步协议仍待用户配置，桌面窗口稍后打开，不重复追问。目标active，本轮有实质进展，无连续阻塞计数。所有QA进程/安装/试验已结束，正式第十批仍后台运行。

## 第十批正式更新（2026-10-21 16:43，最新状态）

- 真实人物素材发现Sharp0.35.5二值形态学不适合连续Alpha，收缩反而增长。新增回归先失败后修复，复用选区线性灰度min/max至coverage-morphology.js，前后端共用。15项回归/TypeScript/生产构建通过。
- 候选amyk6OypARE8BiyQjaxPU在D:/CanvasStudioAlphaQA。QA3439 session74653使用.tools/atelier-qa，现已停止。两人物Alpha新任务252/96ms并检查深浅底，旧GPU/抠图精确同输入缓存复用有标记。100MP半径10形态学3304ms/342MiB，全部Alpha单调检查通过；同步阶段取消可能延迟数秒。最终包工具UI全部通过，0错误。
- 最终包复杂29层/2来源/100MP实际导出54.279秒与48.718秒，重开前后RGBA全哈希一致，原尺寸；嵌套组/孔洞羽化/旋转翻转/投影/调整/文字已目视检查。正常GPU路径，Electron全部进程+Next私有内存峰值1818MiB，UI探针最大380ms。两次5秒闲置内存994/1245MiB，不能宣称长期无泄漏。证据atelier-complex-export.json/png、atelier-complex-ui.png。
- 照片视觉仍有IS-Net细发丝灰边、低清人像超分平滑，广泛美术8.8未通过；需专用细节matting及比较，不是继续盲目增大收缩。导出审计：没有用户取消按钮，重启后旧.partial目录不会清理，待修复。详见atelier-alpha-quality-acceptance.md。总目标active，本轮实质进展，未因API稍后配置重复追问。
- 正式已更新amyk6OypARE8BiyQjaxPU，stage32999/发布2767完成；完整回滚D:/CanvasStudioBuild/rollback-before-alpha含旧程序与真实profile。HTTP200、只读桌面检查2工程/15资源/加密凭据一致，工具及lazy资源正常。main36720响应但窗口句柄0。后续检查/二次唤起/写记录组合命令被自动审批拒绝，仅“blocked by policy”；已改为只读验证，没有再唤起窗口或绕过限制，用户可用原快捷方式打开。验收脚本增加STUDIO_READ_ONLY=1。文档由成功只读输出记录。QA74653已停，Go8080可保留，无真实云端请求。禁止再尝试曾被自动审批拒绝删除的旧C盘before-generation副本。

## 第九批正式交付（2026-10-21 16:15，最新状态）

- AI类别拆分代码已接：共享视觉模型识别类别、可编辑/持久化的每素材类别方案；每类独立生成黑白蒙版、复用持久生成队列；本机只用蒙版改变来源Alpha，原图RGB不变，彩色/透明/均匀/尺寸不符蒙版拒绝。全画幅结果可对齐原图层，原图保留，入库/入层去重与撤销。
- 32项相关单测、最终TypeScript、构建通过，候选Ioa8JcUZx0BxYT9fYRaHN位于D:/CanvasStudioSemanticQA。最终包semantic-ui流程通过：草稿/便携保存、独立失败重试、全量原RGB和Alpha、对齐撤销重做、迟到分析隔离、960布局；实际服务重启含语义类别恢复通过。100MP本地提取1454ms/1224MiB，全RGB哈希一致。不是实际语义画质验证。
- 最终包原四工具UI通过；正式桌面已更新Ioa8JcUZx0BxYT9fYRaHN，main22444/窗口462606响应正常。2工程/15资源/加密凭据全部一致，本地工具与lazy资源正常。完整回滚D:/CanvasStudioBuild/rollback-before-semantic含第八批程序和整个真实profile。stage88560、发布86517、核验8265均成功结束；dev11046及QA40227已停止，Go QA8080可保留。
- 这是通过Images edits要求模型返回语义蒙版，再本机提取的路径；真实模型能力/边缘/类别正确性待用户配置API验收。不得把HTTP fixture当成语义识别或美术通过；用户稍后配置，不重复询问。
- 目标active，本轮实质进展，无阻塞计数。下一步核对总计划的剩余证据，尤其本地照片/宠物/细发丝样本、复杂大工程全进程长时表现；实际供应商异步ID恢复和真实模型验收需实际连接/协议。不要反复添加已有入口或把模拟验收当全完成。语义方案保存在工程splitPlans；cloudOperation新增segment，queue按类别独立任务，mask只改变来源Alpha。详见atelier-semantic-acceptance.md。

## 第八批正式交付（2026-10-21 15:50，最新状态）

- EXIF八方向、原图字节保留、模型返回方向归一化已实现。任意文档选区按图层变换捕获为不可变PNG，支持孔洞/羽化；队列保存并恢复蒙版，选区外RGBA严格保护，空选区在远程调用前拒绝。
- 20项方向/云端/队列/选区回归、最终类型检查及构建通过。最终包Electron照片导入/缩略图/实际画面导出、旋转90度放大2倍的孔洞与羽化选区、9600像素全量结果、API蒙版Alpha、历史恢复通过；原四云端工具UI回归和实际服务重启/蒙版重试也通过。真实模型请求0次，不能作为模型画质证据。
- 正式桌面build LIRobzJ01BmBD1aC0NcVz，main33596/窗口200486响应正常，2工程/15资源/凭据均与备份一致，原快捷方式路径不变。完整回滚D:/CanvasStudioBuild/rollback-before-selection含第七批程序及真实profile。候选D:/CanvasStudioSelectionQA。dev83256/QA13602都已停止；Go QA8080可保留。
- 100MP任意蒙版本地合成：准备752ms/保护合成1665ms/峰值1095MiB，2300万保护像素完整哈希一致。不是100MP浏览器捕获或复杂全工程长时基准。详见atelier-selection-cloud-acceptance.md及selection-cloud-ui/large结果。
- 目标保持active；本轮有实质进展，无阻塞计数。剩余语义类别拆分、供应商异步ID恢复、真实通道尺寸/画质/身份/接缝、照片宠物细发丝样本和复杂全进程长时性能。用户API稍后配置，不重复询问，不自动发真实模型请求。完整蒙版历史目前保存在本机generation-jobs及resources，不包含在便携素材历史里。

## 第七批正式交付（2026-10-21 15:24，最新状态）

- 已更新原release/editor-review桌面，build76LpNkGaT7_UTgQtzC9UK，main28084/窗口10751194响应正常。2工程/15资源/加密凭据与新备份一致，本地超分/抠图和lazy素材正常。完整回滚D:/CanvasStudioBuild/rollback-before-cloud含第六批程序和完整真实profile。
- 云端增强、创意放大、AI局部修改、AI扩图已接“图片工具→云端AI”，复用共享API与generation队列。不可变来源、PNG蒙版、选区外/扩图原图区逐像素保护、来源Alpha保留、错误尺寸拒绝、原始要求/参数恢复、对比/入库/去重。来源EXIF旋转当前拒绝，不能声称完整照片方向支持。
- 21项相关回归、最终TypeScript/构建通过。最终包四工具Electron、常规/960×680布局、历史要求恢复、实际服务重启与AI操作显式重试通过；控制台错误0。100MP合成样本准备780ms/保护合成470ms/进程峰值1017MiB，64MP原图区完整RGBA哈希一致。详细范围见atelier-cloud-tools-acceptance.md。使用本机HTTP fixture；真实计费0次，不是模型画质验收。
- Candidate D:/CanvasStudioCloudQA；dev67756/候选3439 session34636均已停止，Go隔离8080仍可保留。stage84408、发布23871成功结束。C盘约5.8GB、D盘约72GB；旧第五批C盘临时副本仍保留，删除曾被策略拒绝，本轮未再尝试。
- 前一目标轮有实际进展，无阻塞计数。用户稍后配置API，不重复询问，不读取或展示密钥。总目标active。剩余：真实通道/画质/身份/接缝与支持尺寸验收、语义类别拆分、任意蒙版AI处理、供应商异步ID恢复、EXIF方向、照片/宠物/细发丝样本与复杂完整工程/长时全进程性能。不要把这七批增量等同全计划完成。
## 第六批正式交付（2026-10-21 14:53，最新状态）

- 正式桌面已更新build 7K7G7cEj46XmJg5foHrJW，main31548、窗口1445112响应正常，原release/editor-review路径和快捷方式不变。两个旧工程、15资源、加密凭据均与新备份一致，本地超分/抠图、lazy原图/缩略图正常。首次早于服务监听的检查失败，就绪后完整复验通过。
- 配方和studio-shared画布统一持久生成队列：不可变参考图/请求快照、不存密钥、同ID去重、串行/容量/超时、取消与迟到保护、重启中断不自动重发、显式重试计费确认；完成原图落本地资源，配方便携工程保留完成历史。任务记录避免重复计数，不打断正在编辑的工作区。
- 37项相关回归通过；后续5项生成断言和最终TypeScript/构建通过。最终包Electron配方/取消/重试/刷新入库/便携历史/画布共享通过；真实Node进程重启、字节保留、不自动重发通过；原GPU/批量/Alpha/LUT等UI通过，控制台错误0。均为隔离本机HTTP fixture，真实计费0次，不代表真实模型验收。
- D盘旧目录缺失后重新恢复运行库，Real-ESRGAN固定SHA和两个GPU/Alpha回归通过；ISNet固定SHA、DirectML341×512样本2.68秒通过。安装脚本增加断点续传、逐次重试、最终SHA验证；最终外置脚本已同步并检查语法/哈希。
- 当前完整回滚：D:/CanvasStudioBuild/rollback-before-generation（旧第五批程序+完整真实profile）。早期D盘回滚已不可依赖。候选在D:/CanvasStudioRegionQA；QA3439已停，Go隔离8080可保留。构建缓存junction仍指D:/CanvasStudioBuild。避免重跑已通过同版本检查。
- 清理C盘临时旧程序副本的Remove-Item操作被自动审批策略拦截，未执行；release/editor-review/CanvasStudio-before-generation仍保留（另有D盘完整回滚）。没有尝试绕过。新版功能与数据验收不受影响。
- 用户稍后配置共享API，不再询问。目标保持active。下一步：云端增强/创意放大与AI局部修改/扩图/类别拆分的真实入口、供应商异步协议恢复、照片/宠物/细节泛化和复杂大图长时验证。第六批不是全计划完成；详见atelier-generation-acceptance.md。
## 第五批正式交付（优先于下方历史状态）

- 本地透明岛/网格拆分、最多64份全画幅结果、细小区域保留、多结果入库去重/对齐/隐藏来源/单次撤销已完成。53项相关回归、最终TypeScript、生产构建通过。候选build _2ddofeS7Ne3d6ABtFjRF在D:/CanvasStudioRegionQA（无上级依赖补齐）通过拆分和区域工具Electron复验；开发版原GPU/批量/LUT等也通过。
- 100MP两大区域拆分5452ms/峰值1340MiB、抽样像素准确；C版小图全部可见RGBA重组完全一致。见atelier-split-checks.json及atelier-split-acceptance.md；不是语义识别、复杂照片或64层大图SLA。
- 正式38736正常关闭，session96860发布已完成：完整用户数据/旧程序备份D:/CanvasStudioBuild/rollback-before-split，候选复制至原release/editor-review。当前main34028、窗口586750856可见，build _2ddofeS7Ne3d6ABtFjRF。原两工程/15资源/加密凭据完全一致，lazy打开/缩略图/工具健康通过。首次检查早于服务监听而ECONNREFUSED，就绪后完整验证通过。dev11767与QA83164已停。Go QA8080可保留。
- C盘构建缓存压力已通过移动自有缓存缓解：web/.next Junction→D:/CanvasStudioBuild/next-dev；.next-release仍指向D盘。.gitignore补忽略.next-release生成物。开发与生产构建限2核，切勿大图基准与开发/构建并跑；其他Node/Electron进程不属于本任务，不可误杀。
- 总目标保持active；用户API稍后配置，不重复询问。剩余云端持久生成任务、AI类别拆分/局部修改/扩图/云端增强/创意放大与复杂大图长时验证。本地网格/连通区域不等同语义拆分。
- 后续最小入口：gateway.ts目前同步Images generations/edits；page.tsx generate只有前端Job，响应后入库；canvasModelRequest为画布同步代理。tool-queue.ts当前本地GPU队列支持多结果，但不能用它现有UI冒充云端持久任务已完成。供应商ID/协议需按实际通道确认，提交未知不能自动重复计费。

## 第四批正式交付（2026-10-21 12:58，优先于下方历史状态）

- 第四批已经发布至原release/editor-review/CanvasStudio-win32-x64，build8QAyh5jA8VA7kB4bLGylL；桌面main38736，窗口279912006可见。健康、真实lazy资源和缩略图读取、原两工程内容/15资源/加密凭据一致。完整用户数据与旧程序备份D:/CanvasStudioBuild/rollback-before-resources。快捷方式路径不变。
- 48项相关回归（resources6/editor17/selection5/model11/tools9）、最终TypeScript、构建通过。正式候选包500资源UI与新增画布原图字节引用验证通过；开发版原GPU工具和选区/对齐入层/撤销重开回归通过。详见atelier-resources-acceptance.md、atelier-resources-checks.json、atelier-resources-ui-results.json（含导航DOM样式核验）及desktop-update/window。
- 同一500资源工程：eager响应46,172,256B→lazy114,156B；热缓存open30–39ms；首屏36缩略图请求；renderer约225–243MiB（不含服务端/推理，也非旧版对照）。样本512×768 C版派生WebP不同EXIF，不是500种艺术内容或100MP复杂图层。
- dev3437与QA3439已停止。Go QA8080（先前30856）可能还在，勿误停其他进程。临时Start-Process -Wait包装和混合健康轮询/启动命令曾被自动审批拦截；改用既有直接Electron入口、独立只读验证与单独启动后均获准完成，无权限改动。
- 本轮属于实质进展，总目标保持active。用户API稍后配置，无需再次询问。下一步：自动/类别/网格辅助拆分与云端持久生成任务，AI局部修改/扩图/云端增强/创意放大；复杂大图/全进程长时性能与真实云端最终验收仍待。切勿把缩略图或统一任务UI视为整个计划完成。
- 新资源约定：dataUrl字段兼容inline或严格/api/studio/resource/<sha256>.<png|jpeg|webp>。UI open传lazy:true；默认API open仍返回便携inline给旧调用。readAsset即刻resource-store；backend工具/分析/生成/导出解析原图；新image-resources.js负责校验/并发去重/384px缓存，GET只允许本机同源。便携导出检查包含元数据的总字节数512MB，本地资源工程不等同于单文件限制。

## 第四批开发（2026-10-21，尚未正式发布）

- 最新：最终候选8QAyh5jA8VA7kB4bLGylL构建/打包、48项相关回归、最终类型检查通过。500资源UI在包上两次通过，完整响应46,172,256B→lazy114,156B，初始36张缩略图，热缓存open30–39ms，渲染进程约225–243MiB；原图逐字节/便携导出/工具/重开通过。参考UI新增画布URL解析原始字节断言通过。
- 图层/素材导航截图隐藏窗口存在局部旧帧，DOM aria-current和computed background已核实正确（资源结果JSON附navigation）；没有据此改动正常导航代码。
- dev18469和QA76778均已停止。正式5072已正常关闭；正在执行第四批发布命令session35366：完整用户数据复制到D:/CanvasStudioBuild/rollback-before-resources/user-data，移动旧程序到同目录，再拷贝候选至release/editor-review。成功后仍需健康/数据/凭据/窗口核验，不能提前说桌面更新完成。

- 正式桌面仍是第三批NOf2vhTIvdpP9p77nZraZ；本批在开发隔离数据.tools/atelier-qa验收，dev3437 session18469、Go8080。
- 资源按需加载：新增resource-url.js、api/studio/image-resources.js与resource/[name]/GET。素材导入立即存为内容哈希资源，工作台open传lazy:true，仅返回引用；素材库/画布素材库/提示词参考图使用384px磁盘WebP缩略图（串行生成、并发去重、最多约1024份缓存），原图保留。GET限制本机同源、CORP、ETag和immutable；保存/导出/工具/视觉分析/生成请求在需要时解析完整原图。便携工程导出依然内嵌原图；导入后先资源化再打开。
- 批量导入改逐张执行并防跨工程写入；500素材上限在导入/生成/结果收集前提示。更新存储测试中的假PNG为真实PNG，不能放宽图片校验来迁就旧假样本。38项相关回归（resources5 + editor17 + selection5 + model11）通过，类型检查通过后正在最终复查。
- atelier-resources-ui.e2e.cjs正在运行：500份独立内容哈希C版派生WebP（512×768，使用不同EXIF标识），测量按需请求/响应字节、滚动、原图导出、便携导出、工具输入和重开；不是500份不同美术样本。需要等最终结果，再做工具/参考图/区域UI回归与正式构建。不得将本开发状态记为桌面已更新。

## 第三批正式交付（2026-10-21 12:32，优先于下方历史状态）

- 正式桌面release/editor-review已更新NOf2vhTIvdpP9p77nZraZ；当前主进程5072、窗口句柄27464560，原快捷方式继续可用。完整回滚程序/用户数据D:/CanvasStudioBuild/rollback-before-creative，早期备份不变。原两工程内容/15资源/credentials.enc一致，atelier-desktop-update.json与atelier-desktop-window.json已记录。
- 42项相关回归、最终类型检查/构建、最终候选creative-ui通过；GPU取消、任务切换/恢复/跨工程隔离与打光Alpha/图案通过。旧工具UI在上一候选通过，此后仅修复canvasTasks把导入图片误计任务（两项新增单测）。图案/打光100MP证据已保存。
- dev3437与QA3439均已停止（最近QA session90867）；Go QA8080可能仍在。当前生产3418。发布首次健康检查恰逢启动中ECONNREFUSED，服务就绪后完整验证通过，无数据改动。
- 总目标继续active。API用户稍后配置，禁止将云端真实验收标通过。下一步独立工作：自动/类别/网格辅助拆分、素材缩略图/按需加载/缓存/大工程；云端持久生成任务、AI修改/扩图/创意增强需接入并等待真实API验证。不能以统一任务UI代替持久底座完成。
- 进一步入口：api/studio/project-storage.ts（当前资源在磁盘，open仍hydration成dataUrl）、studio/asset-library.tsx（img lazy但原图源）、api/studio/tool-queue.ts（当前单结果）、image-tools.ts/schema/面板；page.tsx generate目前同步HTTP，成功才入库，需持久生成任务。当前增量评分功能/代码/安全9.4，UI/UX/美术/性能9.3，详见atelier-local-acceptance.md。

## 第三批开发状态（2026-10-21，当前）

- 最终候选 NOf2vhTIvdpP9p77nZraZ：修复导入图片 status=success 被误计为生成任务，canvas-tasks.ts 依据实际生成标记筛选。42项相关回归、类型检查、构建通过；最终包creative-ui于04:28:24Z全通过，旧工具UI在前一候选通过（其后仅任务筛选变更）。证据atelier-creative-checks.json。
- 发布进行中：39212已正常CloseMainWindow退出，无强杀。用户数据已完整备份到D:/CanvasStudioBuild/rollback-before-creative/user-data；旧程序已移动到同目录CanvasStudio-win32-x64，新候选正复制回原release/editor-review路径，命令session60033。完成后须验证桌面与数据/凭据，尚不可宣称本批已正式安装成功。

- 最新：生产构建和候选包N4FfYzQI7Tqx4ii8cSnvF已通过。无上级依赖的D:/CanvasStudioRegionQA正式包上，atelier-creative-ui.e2e验证真实GPU取消、打光Alpha、镜像/保存、统一任务入口重复切换、重开与跨工程隔离通过。旧工具UI回归正在运行。
- 100MP边界验证通过：10000×10000合成图打光11.27秒/633MiB；C版图案输出10000×10000约1.50秒，同一进程连续运行峰值1334MiB（包含前项残留内存）。见atelier-creative-100mp.json。不能当成复杂照片SLA。
- dev3437已停止；候选包Node服务3439 session81777当前运行，数据仍隔离。正式桌面尚未更新第三批，更新前需要正常关闭、备份当前用户数据/程序，再验证新包和凭据。API仍未配置。

- 当前正式桌面仍为第二批 VvtuffIRNgvOAU1pjxG6t，39212曾为主进程；更新前重查，不停止其他应用。
- 新增use-tool-tasks.ts共用一次轮询与取消/重试，tool-task-list.tsx复用记录UI；task-overview.tsx汇总本地处理、配方生成和画布节点。footer任务数量包含三类，可从任务结果回到图片工具；重复查看同一ID用previewVersion重挂载，防止仍显示之前选过的其他结果。跨工程回包保护和轮询迟到覆盖保护已加。云端持久队列/供应商恢复尚未完成，不能将统一UI当成底座全部完成。
- creative-tools.js：线性RGB中的二维方向/径向曝光场，颜色/强度/位置/半径；透明度不变，半径外与零强度逐像素不变，不宣称AI深度重打光。图案按原尺寸或比例重复/镜像/隔列错位，间距透明，无逐瓦片对象堆积。
- 顶部组件creative-tool-controls.tsx收纳次要参数。新增checkToolMemory预检当前空闲内存，无静默降分辨率。40项相关回归与类型检查通过（17工具/区域/创意 + 23LUT/模型/同步/引用）。真实素材打光0.30秒/104MiB，4096方形图案0.41秒/405MiB；见atelier-creative-large.json。
- atelier-creative-ui.e2e.cjs首轮真实GPU取消、打光Alpha、镜像图案、统一入口/不同结果切换/保存恢复通过，正在补跨工程隔离截图。API已只读核实未配置，不重复询问用户。
- dev 3437进程session56480，隔离STUDIO_DATA_DIR=.tools/atelier-qa；构建前停止以免内存压力。C盘约1.5GB、D盘13GB，沿用D盘.next-release输出与D:/CanvasStudioRegionQA候选包目录（无上级node_modules）。正式包复验与发布尚待完成。本轮全目标继续active。

## 2026-10-21 第二批正式交付（优先于以下历史记录）

- 桌面已更新：release/editor-review/CanvasStudio-win32-x64，构建 VvtuffIRNgvOAU1pjxG6t；新候选完整包 D:/CanvasStudioRegionQA/CanvasStudio-win32-x64。该目录没有上级node_modules，区域/图片工具两组Electron复验通过；36项回归与最终类型检查通过。
- 100MP处理与构建改为顺序执行后均通过。区域工具/对齐入层/撤销/恢复可用。LUT任务轮询与素材不复制大文本。
- 实际桌面进程最近39212，窗口可见。修复desktop/main.cjs second-instance调用window.show()；隐藏启动后第二次启动显示窗口已实测，证据atelier-desktop-window.json。更新后两个工程内容/15资源/凭据一致；窗口显示后既有自动保存更新了一份工程的updatedAt，内容逐字段对比无变化。桌面日志无错误。
- 本次前的程序与完整用户数据备份 D:/CanvasStudioBuild/rollback-before-regions；更早备份 rollback-before-atelier 仍保留。C盘旧副本已移至 D:/CanvasStudioBuild/retained-local-rollback，与初始备份2539文件哈希一致。C盘约1.6GB。
- 测试dev/QA Next服务已停止；Go QA 8080可能仍在，不能误停其他应用。总目标active。下步：共用任务入口/生成任务底座、AI区域修改与扩图/自动类别拆分、图案与打光、实际API适配与创意放大、缩略图/按需加载/大工程与低内存保护。用户稍后配置API，无需反复询问。详见atelier-local-acceptance.md，当前增量9.3–9.4可交付，不称全部完成。

## 2026-10-21 正式桌面与第二批开发（最新状态）

- 第一批已安装至原桌面路径，构建 yc1KDsY5zBcEBlNATrf8Q。跨盘打包最初漏 Next 动态运行文件，D 盘上级 node_modules 掩盖问题；package.cjs 改为完整复制 Next/sharp/@img。正式 C 盘目录隔离数据再次跑工具/参考图两组 Electron 测试通过，正式桌面 API 通过。
- 正常关闭旧版后备份整个 %APPDATA%/CanvasStudio。回滚程序和用户数据位于 D:/CanvasStudioBuild/rollback-before-atelier；旧程序也保留在 release/editor-review/CanvasStudio-before-atelier。两份工程清单、15 个资源文件、credentials.enc 与备份一致。production tool-runtime.json 指向 D 盘模型/工作缓存。证据 atelier-desktop-update.json。
- 第二批开发：region-tools.js 实现选区替换、原尺寸材质平铺、完整画幅框选提取、透明扩边；选区外不变、Alpha、尺寸/偏移、取消、超大材质裁边测试通过。ToolRegionPreview 可拖选并用顶部像素参数精确修改。提取结果可沿原图层变换对齐加入，支持撤销。AI 扩图/语义自动拆分不在本批已实现项中。
- 处理记录轮询去除 LUT 大文本，原始任务快照保留；新素材 metadata 不再复制 LUT 原文。新增队列回归中。
- 第二批 Electron 区域工具验证通过：真实拖选/精确参数、辅助图快照、逐像素选区外一致、入层位置/旋转/透明度/翻转、撤销重做、保存重开。36 项回归与类型检查通过。10000×10000 合成测试图完成选区替换，约0.85秒、Node及其原生库RSS峰值630MiB；内外采样正确。证据 atelier-regions-ui-results.json / atelier-regions-large.json。合成图耗时不是复杂照片SLA。
- 曾将100MP测试与生产构建并发，导致系统内存不足，已改为停止测试服务后顺序执行；100MP单独运行通过，生产构建重跑中。第二批尚未发布。用户稍后配置真实 API；云端实测保持待验。总目标 active，不能标记全计划完成。

## 2026-10-21 更新（以下状态优先于后文历史记录）

持续目标 active。用户选择稍后在共享连接配置API；云端实测待配置，独立本地工作继续。

- 新增参考职责预设/自定义/排序/去重，职责跟随连接、按实际发送图片序列编号。工作台/画布同步回归通过；旧自由提示词不自动改写。相关文件 `reference-roles.js`、canvas generation/resource helpers、bridge、prompt workspace。
- 工具已从弹窗改成顶部参数区；批量、失败重试、提交原图快照、透明/白/黑底、适应/100%预览、组件目录检查配置。原图保留，结果带来源存素材库。
- 新增透明边缘羽化/收缩/去杂边、黑白底配对提取Alpha；不匹配输入报错。新增1D/3D Cube LUT，DOMAIN、插值/强度/Alpha/可取消/非法文件校验；3D支持2–65点、1D支持2–65536点。格式字段核对 [Three.js官方源码](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/LUTCubeLoader.js)，独立实现。相关 `cube-lut.js`、image-tools/schema/queue。
- 集成画布节点参数通过portal固定在顶部可见区域，修复底部节点参数落到屏幕外；选中节点出视口仍保留参数。普通独立画布不变。
- 31项回归通过（model11、module-sync6、references3、tools8、LUT3）；类型检查通过。Electron工具UI实测GPU/对比/入库/重开/两素材批量/边缘/Cube导入/跨站403、控制台错误0；参考UI重排/发送/屏幕内编辑职责/重开通过。证据 `atelier-tools-ui-results.json`、`atelier-references-ui-results.json`。
- 足尺1024×1536→4096×6144插画约5.54秒，同尺寸抠图约2.16秒，真实Alpha极值0/255。全设备GPU峰值2215MiB、Node RSS约224MiB；后者不含外部推理进程。证据 `atelier-large-results.json`，样本位于D:/CanvasStudioRuntime/qa-large。
- 正式旧版仍运行；主进程曾为36956，需重查。旧应用完整复制到 `D:/CanvasStudioBuild/rollback-before-atelier/CanvasStudio-win32-x64`。正式工程/数据库备份应在正常关闭旧窗口后进行；不能强杀未保存窗口。正式数据/密钥/快捷方式尚未改。
- C盘约2GB，构建改用 `.next-release` junction→D:/CanvasStudioBuild/next-release，`STUDIO_BUILD_DIR=.next-release`；D构建父目录node_modules junction指向web/node_modules。首轮编译成功、页面收集因跨盘依赖查找失败；补junction后重跑中，尚未通过发布门禁。package.cjs支持STUDIO_PACKAGE_DIR，附带setup-image-tools.ps1及tool-runtime脚本。

下一步：完成构建、隔离包验收、旧数据备份和更新；再做全局任务入口/现有生成任务统一、区域修改/扩图/拆分、图案/网格/参数打光、云端/创意增强、缩略图/按需加载/大工程。LUT大文本应从素材metadata移除、保留任务来源，避免重复膨胀。照片/宠物/细发丝、全进程树峰值、多DPI、100MP工具尚待验收。全计划未完成，不可给整个项目虚报9.5分。

## 初始检查点（历史记录）

持续目标 active；仅第一批开发，不代表全计划完成，尚未更新正式桌面。

## 当前代码

- `tool-schema.ts`：工具/任务公共类型；`tool-queue.ts`：磁盘输入/输出/清单，单任务执行、取消/重复提交/中断恢复。
- `image-tools.ts`：sharp 尺寸/裁切/平铺/饱和度锐度；Real-ESRGAN GPU 超分、IS-Net DirectML 抠图；实际尺寸/Alpha/磁盘空间校验。
- `tools.ts` + API route：仅本机认证入口；工具任务按数据目录隔离，结果存 D 盘。
- `image-tool-panel.tsx`：顶部入口、参数、原图对比、任务列表、结果入库与去重。AntD 弹层限定在原生 dialog 内，避免落到不可交互的 body。
- `desktop/setup-image-tools.ps1`：固定官方 URL/SHA256 安装运行时；`-IncludeCutout` 使用独立 Python 环境。

## 已验证

- 类型检查成功（在加入 cutout 后执行）；5 项队列/像素测试通过。取消测试用显式 barrier 消除时间假设。
- RTX3060 12GB，两种 GPU 超分模型 256×384→512×768 分别约 2.47/2.73 秒；实际 Alpha/非黑输出断言。
- IS-Net：白底人物 341×512，约 3.15 秒，DirectML provider、尺寸及背景/主体 Alpha 断言；已检查结果图。
- Electron 隔离 UI：GPU→预览→原图对比→素材库→保存→重开，原图未改变、重复入库阻止、跨站请求403、控制台错误0。

## 运行环境与复现

- 正式桌面仍 `release/editor-review`，未改变正式数据、凭据和快捷方式。
- 测试 Next：127.0.0.1:3437，数据目录 `.tools/atelier-qa`。Go QA：127.0.0.1:8080、PID 30856（进程信息需重查）；与正式数据库隔离。
- GPU/抠图模型：`D:/CanvasStudioRuntime/`，独立环境 `segment-python`（Python3.10、onnxruntime-directml1.22、Pillow11.3、NumPy2.2.6）。输入结果 `qa-gpu`。
- `node --test tests/studio-tools.test.mjs`；GPU 测试需 `STUDIO_GPU_TEST_DIR=D:/CanvasStudioRuntime/qa-gpu`，运行 `tests/studio-tools-gpu.mjs` / `studio-tools-cutout.mjs`。
- Electron QA：`STUDIO_TEST_URL=http://127.0.0.1:3437`；运行 `desktop/tests/atelier-tools-ui.e2e.cjs`，依赖 QA 前后端。

## 下一步与剩余风险

1. 第一批仍待：模型管理 UI、全局工具任务入口、失败重试/导出/撤销与重开覆盖、参数行布局；目前工具通过顶部按钮打开 dialog，尚不是最终顶部参数行。
2. 补全尺寸/半透明真实素材、边缘修整/去雾/黑白双图透明度；当前超分 RGB 与 Alpha 分别处理，边缘质量不能仅以 Alpha 存在判定。x4 模型在2x时仍使用4x中间图，100MP保护会拒绝过大输入，不静默缩图。
3. 继续共用生成任务队列与异步协议、参考图排序/角色/编号、模块同步回归；尚未改动现有生成链。
4. 后续区域修改/扩图/拆分/LUT/图案/打光/云端和创意增强/素材性能按 roadmap 执行。
5. 未进行本轮生产构建和桌面发布；C盘空间不足以盲目复制大包，发布前复查磁盘并保留回滚。
6. 模型实际下载及推理不使用用户 API；第三方模型分发条件需在对外分发前复核。GPU耗时是小样本基线，不是大图 SLA。

质量判断：当前增量代码/已测功能可继续集成；完整 UI/UX、美术和大图性能仍待验收，因此不评为全阶段通过，不宣称高质量完成。
