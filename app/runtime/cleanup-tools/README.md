# 可选清理组件

土狗只内置工具目录、安装器和 JSON worker；在用户点击“下载工具”后才安装，读取状态和 MCP 调用不会触发下载。每个工具独立启用，运行时不请求云端模型。

- `metadata`：固定版本 ExifTool 13.60；Windows 下载 `exiftool-vendored.exe`，macOS 下载 `exiftool-vendored.pl` 并使用系统 `/usr/bin/perl`。归档的 SHA-256 和字节数写在 `components.json`，下载缓存与解压复用应用的安全安装实现。Windows 下载约 10.9 MB，安装约 33 MiB；预留 128 MiB。
- `watermark`：固定版本 `remove-ai-watermarks[visible]==0.52.0`，仅 `backend=cv2`。Python 3.12.12、uv 和 wheel 依赖分别固定版本/哈希；安装路径独立于抠图环境。三平台锁文件由 uv 编译，禁止源码包安装。禁止隐式下载 LaMa、MI-GAN 等权重，不引入 CUDA。Windows 实测环境约 518 MiB，Python 与缓存另占约 570 MiB；预留 2 GiB。

组件放在应用用户数据目录的 `components/cleanup-tools/`：`releases/` 为独立版本目录，`cache/` 为可重用缓存，`python-managed/` 为独立解释器。安装与验证成功后才更新 `<operation>.json`。取消不会自动重试，下载缓存保留。离线状态只能使用已下载组件，首次安装仍需网络。

## 开源来源与许可

- [remove-ai-watermarks](https://github.com/wiltodelta/remove-ai-watermarks)：Apache-2.0。土狗未复制其算法源文件；通过独立安装的上游 Python 包调用已公开的可见水印检测和 OpenCV 修复能力。安装包内上游许可证及依赖 `.dist-info` 许可文件保留。
- [ExifTool](https://github.com/exiftool/exiftool)：与 Perl 相同的 Artistic/GPL 双许可；vendored npm 分发包装为 MIT，不改变 ExifTool 本体许可。保留完整分发内容及许可。
- [uv](https://github.com/astral-sh/uv)：MIT/Apache-2.0；OpenCV：Apache-2.0；Python、Pillow、NumPy 等分别遵循各自上游许可，依赖不并入土狗源码。

独立下载不是豁免上游许可的方式。后续镜像、二进制重打包或模型替换需再次核对并保留许可与署名。

## 处理边界

仅支持静态 PNG/JPEG/WebP。水印修复支持 8 位 RGB/普通灰度输入，上限 2400 万像素，结果为 PNG、保留 alpha 与 ICC，手工区域外 RGB 不变；EXIF 方向先规范化到显示坐标。CMYK、16 位或灰度 ICC 输入需先转换为 8 位 RGB。自动模式未检测到支持的水印时返回原文件；检测结果不等于复杂背景视觉完美。

元数据清理输出原格式，不重绘，不承诺删除像素内的隐形标记。保留 ICC、方向及 PNG Gamma/sRGB/色度信息，编码/显示必需字段不计为残留；每张比较解码像素和上述显示信息，不一致则拒绝入库。可读残留字段会明确报告，原始文件始终保留。
