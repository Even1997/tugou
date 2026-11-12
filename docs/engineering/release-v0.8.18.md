# v0.8.18 发布验收

已公开为[最新稳定版 v0.8.18](https://github.com/Even1997/tugou/releases/tag/v0.8.18)，Windows x64、Mac arm64 / x64 安装包及更新资源全部发布。更新内容见[版本说明](../releases/v0.8.18.md)。中英文 README 同步更新，明确各模块自由使用、图层与 PPT 新布局、原位文字编辑和选区格式。

## 代码与版本

源码标签 v0.8.18 对应 d7a3fef；VERSION、应用 package.json 和 lockfile 均为 0.8.18，CHANGELOG 保留空的 Unreleased。后续提交仅调整文档和发布验收脚本，生产应用与标签无差异，未移动标签。用户已明确授权三平台构建与发布；使用隔离工程与输出目录，未覆盖安装用户当前实例。

## Windows

26 份报告、969 项检查通过，渲染错误 0。覆盖包内源码/构建字节一致、更新 SHA512、真实 EXE 启动与凭据保护、实际安装包文字选区/保存重开/PPTX、PPT MCP、特效、PSD、照片调色、缩放、圆角、更新弹窗、页面、多图对比、字体下载与离线导出、并发、保存、GIF、画布平移和局部编辑。已查看真实包内文字选区截图。

EXE 为 114084853 字节，SHA256 db0b71dcda0370e33e6a93752a70f93c8c828623adbf7ced72d17be9367afe87。EXE、blockmap、latest.yml 和 SHA256SUMS-win.txt 已上传，附件摘要与本地验收产物一致。证据：app/test-results/release-v0.8.18-windows-summary.json 及对应目录。

## Mac 原生验收

[原生 Mac 工作流](https://github.com/Even1997/tugou/actions/runs/43223708627) 两架构与发布任务均成功。Apple 芯片 28 份报告、923 项检查，Intel 28 份报告、923 项检查通过，渲染错误 0。包括原生架构、ad-hoc 签名、DMG/ZIP 完整性、真实程序启动、完整 DMG 下载和原生挂载，以及包内业务检查。已查看 Mac 深色窄窗口与字体控件截图。

证据：app/test-results/release-v0.8.18-mac-arm64-final/、release-v0.8.18-mac-x64-final/ 与两份 *-summary.json。原生 CI 使用软件渲染，不替代实体 Mac 的 GPU、触控板、输入法或高 DPI 验收。

## 排障记录

前轮取消与失败流程不计为通过，原始日志和报告保留在本版 test-results 中。修订 QA 以当前工程菜单、按需展开的属性栏和单一 PPT 右侧面板为入口，保留像素、参数、保存、撤销、锁定与错误断言。照片调色直接等待真实保存队列，消除检查保存按钮后再点击的竞争。

局部编辑首次 Mac 运行曾出现 ResizeObserver 警告或隐藏的笔刷指针；测试原先反复隐藏/显示窗口。后续保持窗口可渲染、启用测试焦点并等待布局帧，Windows 49 项及最终 Mac 原生检查完整通过，未过滤控制台错误，未为通过测试改动生产代码。一次本地生成夹具连接失败的运行也未计入通过；后续同一进度与终态断言通过，不据此推断生产网络问题已复现或修复。

## 公开更新与下载

10 个附件齐全后，公开前 12 项核对通过：三份 SHA256 清单与 GitHub 附件摘要一致，Windows 附件对应实测构建。随后公开为 Latest，23 项匿名检查通过：Windows 从 v0.8.17 发现 v0.8.18，Mac 两架构选择各自 DMG，7 个安装/更新文件公开 Range 下载成功。

公网检查为 Range 下载；完整 DMG 下载与挂载在原生 Mac CI 中完成。证据：app/test-results/release-v0.8.18-prepublish.json、release-v0.8.18-public.json 及对应日志；README 和版本/链接 60 项文档检查通过。

## 质量自评

| 维度 | 评分 | 验证与改进点 |
| --- | --- | --- |
| 功能 / 代码 | 9.5/10 | 三平台包内检查、版本/源码一致性、保存重开、导出与公开更新通过 |
| UI / UX / 美术 | 9.4/10 | 浅深和窄窗口截图已核对；高 DPI、实体 Mac 操作和实际 Office/WPS 重开待补 |
| 性能 | 9.3/10 | 连续编辑、并发及原生回归通过；复杂长文与低配置长期压力待补 |
| 安全 | 9.3/10 | 凭据保护、包体排除、附件摘要及更新保护通过；Windows 商业签名与 Apple 公证尚未提供 |

整体自评 9.4/10，可交付。人工体验待确认项继续保留在[待测试](../progress/pending-test.md)，不将本次原生 CI 等同于全部实机与长期验证。
