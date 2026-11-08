<p align="center">
  <img src="app/assets/brand/logo.png" width="112" alt="土狗 Tugou Logo">
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

<h1 align="center">土狗 · Tugou</h1>

**把 AI 生图、图片处理、图层编辑、PPT 和字体创作放进同一个本地工程。**

土狗是一款桌面创作工作台。你可以手动编辑，也可以把它连接到支持 MCP 的 AI 客户端，让 AI 使用画布、生图、图片工具和 PPT 等能力。工程与素材保存在本机；云端生成和分析使用你自己配置的模型服务。

**当前稳定版：v0.8.15** · [下载安装](https://github.com/Even1997/tugou/releases/latest) · [本版更新](docs/releases/v0.8.15.md) · [更新日志](CHANGELOG.md) · [开发说明](app/README.md)

## 可以做什么

| 模块 | 主要功能 |
| --- | --- |
| 首页 | 查看工程与任务概览、继续最近创作、查看 MCP 连接引导 |
| 提示词 | 管理可复用的模块与配方，整理参考图、创作要求和视觉分析结果 |
| 画布 | 连接文字、参考图、生成台和图片工具台；结果在右侧生成独立图片节点，可继续串联或分支处理 |
| 图层 | 多画板排版，编辑图片、文字和形状；支持分组、选区、蒙版、画笔、变换、照片调色、阴影与边框，以及基础 PSD 导入导出 |
| PPT | 在同一工程创建多份文稿，编辑文字、图片和形状；支持大纲、讲稿、元素图层、共用字体、四角圆角、预览、演示和可编辑 `.pptx` 导出 |
| 工具 | 抠图、超分、缩放、裁剪、旋转、扩边、调色等图片处理，以及多图合成 GIF；支持的图片工具也可作为画布工具台连接使用 |
| 素材 | 导入、搜索、预览与复用图片和 GIF，查看来源、生成信息，管理未引用素材 |
| 字体 | 创建字体项目，导入字形图集、识别与复核字符映射、调整轮廓、导出 TTF / WOFF2，并在土狗中使用 |
| 设置 | 分别配置外观、画布交互、通知、文件存储、模型连接、MCP、快捷键和更新 |

常见流程：**提示词与参考图 → 画布生图 → 连接图片工具处理 → 图层排版或加入 PPT → 导出。** 各模块可复用同一工程的素材，图层与 PPT 共用字体库。

## 下载安装

首次使用直接下载安装包，无需克隆源码，也不需要启动 Web 或 Go 服务。

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | [下载 EXE](https://github.com/Even1997/tugou/releases/download/v0.8.15/tugou-0.8.15-win-x64.exe) |
| macOS 13+ · Apple Silicon（M 系列） | [下载 arm64 DMG](https://github.com/Even1997/tugou/releases/download/v0.8.15/tugou-0.8.15-mac-arm64.dmg) |
| macOS 13+ · Intel | [下载 x64 DMG](https://github.com/Even1997/tugou/releases/download/v0.8.15/tugou-0.8.15-mac-x64.dmg) |

[完整附件与 SHA256 校验文件](https://github.com/Even1997/tugou/releases/tag/v0.8.15)中另有 Mac ZIP。当前没有正式 Linux 安装包。

- **Windows：**运行 EXE，按安装向导操作。当前安装包没有商业代码签名，系统可能提示未知发布者，请核对下载来源和校验值。
- **Mac：**打开对应芯片的 DMG，将 `Tugou.app` 拖入 Applications 后运行。当前为 ad-hoc 签名，尚未完成 Apple 公证；首次打开若被拦截，请在确认来源后按系统「隐私与安全性」提示处理。
- **升级：**先保存工程。开启自动检查后，每次启动和运行中每 30 分钟检查新版，也可在「设置 → 更新」手动检查。发现新版会弹窗并保留更新入口；选择「跳过此版本」只屏蔽该版本，更高版本仍会提醒；安装由用户确认，Mac 需保存退出后手动替换应用。升级后请重连 MCP 客户端。

## 第一次使用

图片编辑、图层排版和 PPT 基础编辑不需要配置云端模型。需要 AI 生图、视觉分析或文本辅助时，再连接自己的模型服务：

1. 新建工程，打开「设置 → 模型连接 → 管理供应商与模型」。
2. 添加供应商，填写其提供的 API 地址和 API Key。同一供应商可保存多个命名 Key，不同 API 地址分别创建供应商。
3. 测试连接、获取或手动填写模型 ID，按用途设置图片生成、视觉分析和文本辅助的默认模型。
4. 在「画布」添加提示词、参考图片和生成台，连接输入后生成。结果会出现在右侧，任务面板可查看进度、取消或手动重试。
5. 将结果连接到超分、抠图等工具台继续处理，或在「图层」与「PPT」中使用，保存工程并导出。

图片节点支持用画笔、矩形或圆形标记局部修改区域，再交给生成台进行局部生图。是否支持图像编辑、具体模型、尺寸与质量取决于供应商；土狗不提供免费模型额度，取消本地任务也不保证供应商停止计费。

## PPT 怎么做

可以直接手动创建、编辑和演示，也可以让已连接 MCP 的 AI 客户端辅助制作：

1. **先写大纲。**按页整理标题与内容，在每页一个输入框中连续编辑，并由用户确认。
2. **选择下一步。**大纲确认后，由用户选择先做视觉设计或先写讲稿，AI 不默认同时执行两项。
3. **分别推进。**设计先确认视觉方案范围，展示方案板并等用户选择后再制作；讲稿单独保存在页面备注中，不改画面、不触发生图。已有讲稿在设计时保留。
4. **看图验收与交付。**设计后逐页检查实际截图，修正后重新截图，再保存或导出 `.pptx`；讲稿随文件进入备注，不显示在演示画面。

这是提供给外部 AI 客户端的制作规则，土狗没有内置自动完成整套流程的 Agent。详见 [PPT 设计标准](docs/engineering/ppt-design-standard.md)。

## MCP：让 AI 使用土狗

1. 启动土狗，在「设置 → MCP 与 AI 调用」启用服务。
2. 复制界面生成的通用 JSON、VS Code JSON 或 Codex TOML，加入对应客户端的 MCP 配置。
3. 保持土狗运行。AI 先调用 `get_state` 查看实时状态，再用 `list_commands` 发现命令；新建或打开工程后即可操作。

连接采用**本机 stdio**，不是远程 HTTP URL。支持标准 stdio 的 AI 客户端均可按其规范接入，不限 Codex；配置包含本机路径，请使用自己设备生成的内容。复制出的配置不包含供应商 API Key。

MCP 覆盖工程、提示词、画布、图片工具、图层与蒙版、PPT 大纲和讲稿、字体、模型与任务等能力。编辑与界面共用工程，支持实时版本检查、批次撤销和生成请求去重。`ppt.preview` 直接返回真实 PNG 图片，`ui.capture` 可截取可见应用界面；客户端需支持 MCP 图片，截图时土狗窗口需可见。

连接后，可以把这样的请求交给 AI：

> 用土狗制作一份项目汇报 PPT。先整理大纲给我确认，再让我选择先做视觉设计还是先写讲稿。需要配图时使用土狗生图，设计完成后逐页截图检查。

MCP 提供工具和规则，实际规划、询问与执行由 AI 客户端负责，不代表所有界面功能都能自动操作。接口与截图用法见 [PPT 与 MCP](docs/engineering/presentations.md)、[界面截图与导航](docs/engineering/ui-mcp.md)。

## 数据、联网与功能边界

**本机数据。**工程、资源、字体项目和任务保存在本机。安装版默认工作区如下，也可在「设置 → 文件与存储」查看实际目录；开发预览使用独立数据目录。

```text
Windows  %APPDATA%\TugouIndependent\workspace
macOS    ~/Library/Application Support/TugouIndependent/workspace
```

备份前保存并退出土狗，复制整个用户数据目录，不要只复制工程 JSON。API Key 由桌面主进程通过系统加密接口保存；调用云端模型时，提示词与参考图会发送给配置的供应商。

**本地工具。**本地 AI 组件与字体按需下载，首次获取需联网，下载并安装完成后可离线使用相应能力；云端生图和分析仍需联网。可用字体与许可见 [字体目录](app/assets/fonts/CATALOG.md)。

使用前请了解这些边界：

- **GIF：**可由多张图片制作，也可导入画布、素材库和图层；图层可播放动画、用滑动器选帧，导出 GIF 或指定帧 PNG。
- **PPT：**当前支持创建、编辑、演示与导出，暂不支持导入 `.pptx`，不嵌入字体，GIF 加入 PPT 后使用首帧；土狗截图不能代替导出后在 Office / WPS 中的排版检查。
- **PSD：**提供基础导入导出，导入时展示转换报告，不保证复杂 Photoshop 特效和文字原样可编辑。
- **字体制作：**OCR、描图与字体编译需额外配置本地环境，见 [字体环境](app/README.md#字体环境)；导出仅包含实际导入并复核的字形，不会由少量设计字自动补齐完整中文字库。

## 从源码运行

当前桌面版入口在 `app/`，使用 Node.js 22 LTS 或兼容更新版本。仓库仍保留历史 Web / Go 代码及文档，它们不是桌面版的启动依赖。

```sh
git clone https://github.com/Even1997/tugou.git
cd tugou/app
npm ci
npm run dev
```

开发预览支持界面热更新；主进程、preload 或运行依赖变化仍需保存后重启。构建、测试、字体环境和发布方式见 [桌面开发说明](app/README.md)。

## 文档、许可与反馈

- [版本说明](docs/releases/v0.8.15.md) · [更新日志](CHANGELOG.md) · [发布验收](docs/engineering/release-v0.8.15.md)
- [PPT 设计与 MCP 流程](docs/engineering/ppt-design-standard.md) · [字体目录](app/assets/fonts/CATALOG.md)
- [开发文档](app/README.md) · [文档索引](docs/index.md) · [待测试事项](docs/progress/pending-test.md) · [后续计划](docs/progress/todo.md)

项目自有代码采用 [Apache-2.0](LICENSE)，Copyright © 2026 Even。第三方代码、字体、模型与运行时保留各自许可，见 [NOTICE](NOTICE)、[授权范围](app/LICENSING.md) 和 [第三方声明](THIRD-PARTY-NOTICES.md)；历史版本的许可不因当前 LICENSE 追溯改变。

问题反馈请到 [Issues](https://github.com/Even1997/tugou/issues)，附版本、操作系统、复现步骤与脱敏截图，请勿上传 API Key 或未经授权的私人素材。
