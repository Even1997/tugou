# 完整 BiRefNet FP16 隔离验证

## 产物与预处理

采用 [onnx-community/BiRefNet-ONNX 固定版本](https://huggingface.co/onnx-community/BiRefNet-ONNX/tree/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67)，这是基于 ZhengPeng7/BiRefNet 的完整通用模型转换，不是之前的 Lite512 或专用 matting checkpoint。模型卡标注 MIT，上游许可证和模型卡保留于 `D:/CanvasStudioBiRefNetFullQA`。

- `onnx/model_fp16.onnx`：489666272字节；与发布的 LFS SHA256 `3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09` 完全一致。
- 固定模型卡/预处理配置一并保存；1024×1024 BILINEAR、ImageNet mean/std、输出 sigmoid；实际输入接口仍为 float32，权重为 FP16。
- 复用既有 `atelier-birefnet-proof.py`，增加明确的 `STUDIO_BIREFNET_FULL=1` 隔离模式。未执行远端代码、未重新本地转换模型、未改默认 IS-Net 运行库。

## 实测与视觉检查

`atelier-birefnet-full-results.json`：DirectML + CPU provider 可用，加载5.249秒，两张既有人物图及CC0猫照片各推理两次，耗时0.492–0.607秒，全部通过尺寸、源RGB、源文件哈希、Alpha不超过原Alpha的断言。进程正常退出，没有触发内存保护。

进程峰值工作集951.1MiB，峰值私有提交11667.6MiB。二者含义不同，**不能将私有提交当作物理RAM或显存，也不能称只需1GB内存**。本次未采集推理峰值显存；运行前RTX3060总显存12288MiB、已用728MiB。完整模型的共享资源压力明显高于Lite，生产集成前仍需验证与编辑器共同运行及大图/取消。

已逐张查看白底/深底预览：人物发丝比Lite更丰富，主体完整；低清男士轮廓仍有细亮边，猫的部分细须仍缺失。不能只凭6次推理宣称画质完整通过。

复用 PyMatting `estimate_foreground_ml` 对这次新Alpha做一次前景颜色估计，`atelier-birefnet-full-foreground.json`记录0.191/0.062/0.092秒（不含冷启动）。保留Alpha和完全不透明区域RGB；已逐张查看结果，男士亮边明显减弱，但深背景边缘略有黑线，猫缺失的细须没有恢复。它仅能修正颜色污染，不能补回错误/缺失的Alpha。输出保留于 `foreground-estimate`，没有接入产品或宣称替代原始像素。

## 评分与下一步

| 维度 | 分数 | 依据及剩余项 |
| --- | --- | --- |
| 功能实验 | 9.4 | 完整FP16实际可运行；尚未接入队列、取消和桌面 |
| 代码 | 9.4 | 复用隔离脚本与安全门禁；产品适配未实施 |
| 美术 | 9.2，未通过 | 薄发丝/猫须/边缘仍有损失，只有3图，无Alpha真值 |
| 性能 | 9.3 | 单张速度可用；私有提交较高，峰值显存/大图并行编辑未验证 |
| 安全 | 9.5 | 固定版本/发布哈希/许可证核验，离线推理，原文件不变 |
| UI / UX | N/A | 本轮没有产品界面改动 |

下一步采用具有已知Alpha的透明素材合成不同背景，补足误差与发丝/头纱/装饰等覆盖，并检查真实编辑器共同运行资源，不能继续只围绕同三图调参。若画质未过，保留候选，不静默替换默认模型。正式仍为第十批隐藏窗口，最新候选第十三批未安装；本轮没有打包、模型API请求或正式配置修改。
