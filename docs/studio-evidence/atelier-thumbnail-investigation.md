# 大素材冷缩略图延迟定位

## 后续渲染追踪与输入校正

`atelier-thumbnail-trace.json` 为实际 Chromium devtools.timeline 追踪：最长 RunTask 380.258ms 内含379.693ms ScrollLayer，调用来自验收脚本 EvaluateScript 的 scrollIntoView；另一次249.534ms任务也含247.766ms ScrollLayer。全追踪的 Layout/UpdateLayoutTree/Paint 累计81.594/82.105/65.245ms。未证明重复布局为主因，不据此引入虚拟列表或改产品CSS。

补充 `atelier-thumbnail-wheel.json`：使用 Chromium Input.dispatchMouseEvent 连续滚轮事件，逐段断言 scrollTop 确实由0增长到720/1620/2520/3420，两轮均通过。首轮有部分磁盘缓存，最长任务57ms、96条资源请求最长50.7ms；重复轮未记录到50ms以上长任务、无新增资源请求。这是自动输入/隐藏测试窗口证据，**不是冷缓存全列表或真实可见桌面手动流畅度验收**。它纠正了将脚本大跨度跳转长任务直接外推到普通滚轮操作的判断，不代表产品经过优化。

尝试可见QA窗口时缩略图验收超时，诊断截图报 `Current display surface not available for capture`；保留 `atelier-thumbnail-visible.json` 的失败记录。不可据此认定产品坏了，也不可声称可见桌面通过。测试脚本捕获此类截图错误后仍保存失败报告。正式窗口仍由用户稍后打开，未强制唤起。相关测试及QA服务均已结束。

本轮自评：诊断功能/代码9.4（已校正输入方法；可见桌面仍未验）；性能证据9.4（有界输入、部分缓存）；安全9.5（隔离数据、无模型请求）；UI/美术改动N/A，UX人工验收未达，待桌面显示可用。不再以相同滚动测试拖延原计划核心画质/API门禁。

使用第十三批候选 `eNMKEaN7IDIBsYcy8IG7U`，独立 `D:/CanvasStudioThumbnailQA/atelier-qa` 空缓存，共享只读测试素材目录的 junction。没有删除原缓存、改动正式配置、调用模型接口或重打包。

`desktop/tests/atelier-thumbnail-profile.cjs` 通过；原始记录 `atelier-thumbnail-profile.json`：

- 首轮跳转素材100/200/300/400，显示耗时1305/1541/1523/1372ms；246条缩略图资源记录，最长约2290ms；界面长任务最长567ms。
- 同窗口第二轮相同跳转约0.7–1.3ms，没有记录到50ms以上长任务。第二轮资源表仍含上一轮迟到请求，**不能**将其最大请求耗时当作热缓存请求耗时。
- 源码 `image-resources.js` 将冷缩略图生成串行化，避免多个100MP图同时解码；缓存读取直接返回。请求排队与界面长任务都有证据，尚未用CPU调用栈量化各自占比，因此不声称唯一根因。

对照试验 `web/tests/studio-thumbnail-encoding.mjs` 使用20张4MP图案及人物透明图/猫照片，比较相同尺寸和质量参数的 WebP effort 4/0。22张合计704/576ms，输出100340/115266字节，Alpha一致，最大逐图RGB平均差2.444/255。默认版本先运行，较快版本可能受操作系统热缓存影响；**这不是严格速度排名或画质验收**。参数意义依据[Sharp 官方文档](https://sharp.pixelplumbing.com/api-output/#webp)。记录 `atelier-thumbnail-encoding.json`。

结论：本轮不修改产品编码质量或放大解码并发；收益有限且未完成画质/内存权衡验证。缓存后的有限滚动可用，冷缓存等待仍作为改进点。若继续优化，应先采CPU调用栈或做可见区域优先队列评估，不能简单提高全局并发。本轮QA服务和Electron已结束。

| 自评维度 | 分数与边界 |
| --- | --- |
| 功能 / 性能诊断 | 9.3：已区分冷热缓存并发现长任务，尚无调用栈归因和产品改善 |
| 代码 | 9.4：只新增隔离脚本；编码对照顺序存在已披露的偏差 |
| 安全 | 9.5：保留串行内存约束、原图与原缓存，无外部调用 |
| UI / UX / 美术改动 | N/A：未改产品界面或像素处理，不能据此声称体验/画质提升 |

这是一项诊断交付，不是全计划完成或性能优化完成。正式安装、云端高分辨率/异步协议、视觉分析模型和抠图画质仍按原门禁处理。
