# 轻量抠图候选实测（2026-10-21 18:27）

结论：找到可在当前机器实际运行的轻量候选，资源问题明显缓解；三张样本的边缘取舍未达到画质门槛，未替换现有IS-Net、未改产品代码或安装包。

## 来源与转换

- 官方[BiRefNet lite matting](https://huggingface.co/ZhengPeng7/BiRefNet_lite-matting)标注MIT，但当前官方文件树/发布列表没有对应现成ONNX。未加载远程Python代码或安装PyTorch。
- 按[ONNX Runtime官方FP16转换方法](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html)尝试转换已下载大型模型。仅在D:/CanvasStudioBiRefNetQA/converter-libs安装onnx1.17.0、onnxconverter-common1.15.0，未改产品Python依赖。原图有21976节点、无value_info，默认形状推导/转换在物理空闲1488MiB时触发1536MiB保护退出，没有产出模型。证据conversion.log/conversion-stopped.json；不要原样重跑。
- 改用[Studio Ludens的BiRefNet lite 512转换版](https://huggingface.co/studioludens/birefnet-lite-512/tree/962e67969ec6acec9c19fab76acee4f5e22e990c)，并非官方matting权重。固定提交962e67969ec6acec9c19fab76acee4f5e22e990c；98484532字节，与发布的LFS SHA256 `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516`完全一致。D:/CanvasStudioBiRefNetLiteQA保留模型、MIT许可证（ZhengPeng与Studio Ludens版权）及预处理配置。下载session99087已正常结束。
- 按此转换版预处理：RGB双线性512×512，ImageNet归一化，输出logits转sigmoid、双线性回原尺寸；保留原RGB，乘原Alpha。没有把发布者的浏览器性能或像素等价宣称当成本机证明。

## 实测证据

复用desktop/tests/atelier-birefnet-proof.py，设置STUDIO_BIREFNET_LITE=1。DirectML+CPU回退提供程序，实际输入float32/512，六次推理全部完成，退出0。模型加载4.297秒；首图首次0.594秒，此后0.096–0.105秒。进程峰值工作集467.7MiB、私有提交4032.5MiB；后者不是物理RAM或专用VRAM。不把单模型推理时间当完整桌面任务耗时。

两张原人像和Chelsea宠物均检查原文件哈希、原尺寸、全部RGB保留、Alpha不增和0–255范围。结果在D:/CanvasStudioBiRefNetLiteQA/results-physical-guard；仓库证据atelier-birefnet-lite-results.json。已目视白底/深色底并与原IS-Net结果对照：人像头发外的大块白灰残留和宠物背景残留减少，但细发丝/胡须有所削减，男士轮廓仍有细亮边。没有真值Alpha，不报准确率。

进一步复用产品已有“去白色杂边”处理两人像：91/30ms，Alpha全量不变，276413/49333个完全不透明像素RGB不变。暗底细白边下降，但部分轮廓转黑，不宜默认启用。证据atelier-birefnet-lite-edges.json和white-fringe-*目录。

另用已有隔离PyMatting对Lite/IS-Net输出做foreground颜色估计，不改Alpha，完全不透明处RGB保持；Lite三图0.199/0.061/0.094秒（含写图，不含Python冷启动）。边缘有改善但失去的发丝无法恢复；IS-Net估计仍保留白灰背景残留。结果foreground-estimate/isnet-foreground-estimate，仓库atelier-birefnet-lite-foreground.json；均未接入产品。

18:26:44正式只读复验通过：build仍amyk6OypARE8BiyQjaxPU，2旧工程内容/时间戳、15素材资源、凭据与备份不变，本地工具正常。最新第十二批候选UaH5o0YgMACcUjYkVuQUA继续保留，用户稍后开窗再更新。所有下载、转换和推理任务均已结束；没有用户图片上传或新收费请求。

## 质量自评

| 维度 | 分数 | 依据与不足 |
|---|---:|---|
| 功能（候选推理） | 9.4 | 六次实际推理及像素保护通过；尚非产品队列/取消/安装验收 |
| 代码（验证脚本） | 9.4 | 复用运行库和守护，精确摘要，语法通过；资源采样不是硬上限 |
| UI / UX | N/A | 没有产品界面改动，候选未提供用户入口 |
| 美术 | 9.0 | 比现有部分边缘更干净，但细发丝缺失、亮/黑边仍未达9.3 |
| 性能（候选推理） | 9.4 | 当前三小图稳定低工作集；高分辨率细节与长时/冷启动整任务未验 |
| 安全 | 9.5 | 固定版本/发布摘要/许可、隔离安装，无上传，正式数据复核一致 |

本轮为实质性兼容性与画质证据，目标继续执行，不能称抠图高质量完成。后续不应只围绕三张图继续堆试验：保留可运行候选与已知画质限制，优先完成其余真实云端工具、尺寸/异步协议与分析模型验证；抠图下一次应带更广泛边缘样本或明确的新方法再推进。
