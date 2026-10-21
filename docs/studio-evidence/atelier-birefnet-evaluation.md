# BiRefNet 精细抠图评估：首次推理未通过

18:27补充：大型模型FP16转换也触及资源保护；另外的社区Lite512 FP16模型已成功完成六次推理，但细发丝/轮廓质量仍未达标，未集成。详见 `atelier-birefnet-lite-evaluation.md`，不能把本页大型模型失败泛化为全部BiRefNet均无法运行。

## 18:15实际运行结果（优先于下方历史）

完整模型和原运行库不变，未重新下载。将未实测的6GiB静态余量改为隔离进程资源监测后，实际加载并尝试推理：

- 第一次DirectML：加载5.659秒；进程私有提交量从3896MiB升至12897MiB，工作集仅1779MiB、系统仍空闲3298MiB，触发初设4GiB私有提交保护而退出。记录D:/CanvasStudioBiRefNetQA/results/guard-stop.json。**私有提交量不是实际物理内存或专用显存，不能据此称占用13GB RAM。**
- 修正保护指标后DirectML：加载4.577秒，首次运行DmlFusedNode_15_51报8007000E“内存资源不足，无法完成此操作”，无完成图。无法单凭错误码区分GPU分配与系统内存分配，不能宣称硬件永久不支持。
- CPU对照：加载4.962秒；19.2秒时系统物理空闲354MiB、可用提交12179MiB，进程工作集5249.6MiB/私有提交6784.5MiB，低于1GiB物理余量触发退出。D:/CanvasStudioBiRefNetQA/results-cpu/results.json与guard-stop.json；samples为空，无推理耗时或画质分数。500ms采样有瞬时超限，非硬资源上限。
- 当前脚本开始要求4GiB物理余量，运行中低于1GiB物理或2GiB提交余量、超过16GiB私有提交或180秒即结束自身QA进程，不操作用户应用。两次实际推理均未完成，产品仍使用原IS-Net；不应不改条件再运行本候选。
- 18:15:45验证测试进程已结束、系统物理空闲约5.54GiB，正式2工程/15资源/凭据不变，本地工具正常。下一步评估官方轻量或低精度候选，先确认许可、格式和推理兼容，再测画质；不能仅降低内存保护反复试跑。

本候选功能/美术无法评分为合格，性能不适合当前可用资源条件；产品照片美术仍8.8/10。下方保留准备阶段历史。

模型已下载完成，验证脚本尚未进入推理，未替换产品的 IS-Net。用户稍后打开正式窗口，已验收的第十一批安装包继续保留。17:38重新只读核验发现已有可连接的生图配置，详见atelier-live-provider-acceptance.md，不再将整个API通道笼统标为未配置。

候选是[官方 BiRefNet matting ONNX](https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1)，972667742字节；[官方模型卡](https://huggingface.co/ZhengPeng7/BiRefNet-matting)标注MIT。下载目录D:/CanvasStudioBiRefNetQA，保存上游release元数据和MIT许可。上游release没有digest；下载完成后记录本地SHA256用于复现，不能冒充上游独立校验值。

`desktop/tests/atelier-birefnet-proof.py` 依照[官方ONNX教程](https://github.com/ZhengPeng7/BiRefNet/blob/main/tutorials/BiRefNet_pth2onnx.ipynb)，使用已有独立Python/ONNX DirectML依赖，不安装PyTorch、不上传素材。原始两人物照片与CC0 Chelsea宠物图分别运行两次，检查RGB和输入字节不变、尺寸一致、Alpha不超过原值，记录加载/推理耗时和本进程内存，生成白底/深色底对比。

验收顺序：下载完整性与来源 → 内存余量 → 实际推理和边缘目视 → 与IS-Net对比 → 仅在改善明确时接入产品并验收取消/大图/保存恢复/UI。没有真值蒙版，不把范围/像素断言当成画质证明。仍需头纱、细发丝、浅色衣物等更广泛素材。

17:18独立检查：Python语法通过，Windows内存计数函数正常，系统空闲2.89GiB。实验在加载前保守要求6GiB余量，属于QA保护策略，不是测得的最低要求；不结束其他应用。模型下载尚未完成，尚无推理耗时/峰值/画质结果。

17:36下载完成，curl退出0、972667742字节与官方release一致。SHA256为`6065d27c615ea27308f5b88598dd8db116eb07436c7a323ca40d13b2866c309e`，已固定在隔离验证脚本，防止后续文件发生变化；它是首次可信HTTPS下载的本地记录，不是上游发布的独立摘要。元数据为D:/CanvasStudioBiRefNetQA/download-complete.json。实际启动脚本在模型加载前因2.9GiB空闲内存被保守门禁拦截，没有ONNX推理结果。所有下载进程已结束。

质量状态：当前产品照片抠图美术仍为8.8/10、未通过；该候选功能/性能/美术待实测，代码仅静态检查，不能评分为交付。UI/UX为N/A（本轮没有产品界面改动）。安全边界：本地隔离、官方HTTPS来源、保存许可、无上传；集成与完整校验尚待完成。
