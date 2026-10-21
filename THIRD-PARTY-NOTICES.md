# 图构 Studio 来源说明

本地开发版本基于 tigerowo/infinite-canvas，保留原项目代码、品牌入口与许可证。修改版本遵循 AGPL-3.0，源码随本工作区提供。分发修改版时应按原许可证提供对应源码及通知。

- 原项目：https://github.com/tigerowo/infinite-canvas
- 图层结构参考：https://github.com/robbietilton/Compositor
- Compositor 的 Swift/Metal 编辑器未移植；当前图层渲染使用 Konva / react-konva。
- 魔棒四邻域扫描填充参考 `Compositor/Rendering/WandPixels.c` 的扫描线实现，改写为 TypeScript；沿用下方 MIT 版权与许可。
- 涂抹携色、液化推移参考 `Document/SmudgeLiquify.swift`；图章固定取样、逐笔模糊与修复边界匹配分别参考 `CloneStamp.swift`、`BlurTool.swift`、`HealPixels.c` 的行为，使用本地 Canvas/TypeScript 实现，沿用下方 MIT 版权与许可。
- 平滑与 Shift 直线参考 `Document/EditorSession+Brush.swift`；内容感知填充参考 `Rendering/PatchPixels.c` 的多尺度 PatchMatch、纹理匹配及边界色调适配，改写为本地 Web Worker / TypeScript，并加入一致纹理块匹配。局部取样与填充范围合计限制 400 万像素，原图仍保留原分辨率。沿用下方 MIT 版权与许可，未移植 Metal。
- Electron、Konva、React、Next.js、MCP SDK 等依赖许可证保留在各自软件包中。
- 调整图层与六类图层特效的参数及作用范围参考 `Compositor/Document/LayerAdjustment.swift`、`LayerEffects.swift`；当前用 TypeScript/Canvas2D 实现色调查表、曲线插值、欧氏距离描边和分块滤镜，不包含 CoreImage/Metal 移植。沿用下方 MIT 版权与许可。
- 示例图片来自用户本地婚礼请柬素材，未授权作为公共模板分发。
- 本地超分可选运行时来自 https://github.com/xinntao/Real-ESRGAN （20220424 Windows 发行包）和 https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan 。独立安装，不包含 Atelier 逆向代码；模型遵循 Real-ESRGAN 的 BSD-3-Clause，ncnn 包装器遵循 MIT，完整许可保存在运行时目录。下载脚本固定官方发行地址及 SHA256。该哈希是本次官方 HTTPS 下载的固定值，不代表上游签名认证。
- 本地抠图使用 ONNX Runtime DirectML（MIT）及 IS-Net，模型从 rembg 官方发行资源下载并固定 SHA256；预处理/归一化参考 rembg 的 MIT `DisSession`（Copyright (c) 2020 Daniel Gatis）。DIS 项目代码许可为 Apache-2.0；DIS5K 数据集另有使用条款，本工具不分发训练数据。模型与 Python 环境独立安装，相关许可随运行时保存；推理阶段不调用网络。

## Compositor MIT notice

MIT License

Copyright (c) 2026 Wonder Assembly LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## BiRefNet 精细主体识别（可选本地模型）

模型：onnx-community/BiRefNet-ONNX，固定版本 534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67，SHA256 3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09。仅本机推理；安装时校验模型并保留模型卡。

MIT License

Copyright (c) 2024 ZhengPeng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

