# v0.8.17 发布验收

完整发布验收进行中，公开入口为 [v0.8.17](https://github.com/Even1997/tugou/releases/tag/v0.8.17)，更新内容见 [版本说明](../releases/v0.8.17.md)。全部平台核对通过前，最新安装版保持 v0.8.16。

## 代码与版本

- 产品源码标签：`v0.8.17` / `3aaa47e`；根 VERSION、应用 package.json 和 lockfile 均为 0.8.17，CHANGELOG 保留空的 Unreleased。
- 后续 `fb206e9` 至 `a0a320c` 仅调整发布验收脚本与 Mac 流程。生产代码与版本标签无差异，未移动标签。
- 用户要求全部平台发布后，本轮执行安装包构建与验收；保留各功能的用户体验待确认项。

## Windows

- 构建成功，EXE 文件版本为 0.8.17，包体与更新清单 167 项检查通过；生产源码和构建资源逐字节一致，包内无用户工程、配置凭据、测试目录或按需字体二进制。
- 包内交互与真实 EXE 检查共 519 项通过，连同包体共 686 项，渲染错误 0。覆盖 PPT 缩放 / 空格平移 / 像素圆角、自动保存与切换重开、图层 / 画板右键素材入库及 PNG 透明与颜色像素、工程菜单、PSD、修图、页面管理、图片保存、更新提示安全、GIF、图片对比、素材菜单、MCP 和并发生成。
- 已核对 Windows 浅深主题及窄窗口截图。真实 EXE 启动、保存、凭据加密和辅助进程检查通过，使用隔离工程与测试素材。
- EXE 大小 113129827 字节，SHA256 `2237ccf77ce4ccb698ab53f006be9aaa66a0ddbd2c0999e0589d1a293f01e6e8`。EXE、blockmap、latest.yml 和 SHA256SUMS-win.txt 已上传，附件摘要与本地验收产物一致。

证据：`app/test-results/release-v0.8.17-package.json`、`release-v0.8.17-windows-summary.json`、`release-v0.8.17-executable.log`，以及摘要中列出的隔离桌面报告。

## Mac 原生验收

[Apple 芯片原生验收](https://github.com/Even1997/tugou/actions/runs/42578232615/job/129030680773) 已通过：28 份报告、923 项检查，渲染错误 0。已核对原生架构、ad-hoc 签名、DMG / ZIP 完整性、真实程序启动、完整 DMG 下载和原生挂载；报告与安装包已下载到本机并重新校验 SHA256。

[Intel 原生验收](https://github.com/Even1997/tugou/actions/runs/42588188210/job/129063005619) 的全部业务检查通过：28 份报告、923 项检查，页面控制台错误 0。原生架构、ad-hoc 签名、DMG / ZIP 完整性、真实程序启动、完整 DMG 下载和原生挂载均通过；本机重新计算的 DMG / ZIP SHA256 与原始清单一致，DMG 同时与原生挂载报告的哈希一致。

该流程最后的安装包上传确认请求超时，导致工作流整体状态为失败；唯一失败步骤为上传确认，不是应用检查。GitHub 已保留完整安装包与报告，本机成功取回并核对；[独立上传流程](https://github.com/Even1997/tugou/actions/runs/42592255627) 复核全部报告和产物后上传同一份文件，不重新构建或重复已通过的测试。此前应用检查中断 / 失败的流程不计为验收通过证据。

前轮验收发现的旧断言已按实际行为修正：PSD 不再依赖已删除的说明文字；更新提示通过延迟测试磁盘写入保留真实未保存保护场景；修图与 MCP 根据自动保存后的内容及历史判断；缩放动画尊重原生减少动态效果设置。栅格特效采用现有离线字体夹具，独立字体下载检查仍保留。没有屏蔽渲染错误或修改生产行为。

Intel 打包工具的官方下载返回 504 后，改用官方附件 API，并核对相同的固定 SHA256。修图桌面检查保持窗口可见、等待原生尺寸更新及完整渲染，保留 Esc 取消后的参数 / 像素恢复、居中位移、画布内容、选择、倍率和检查器不变的断言；Windows 修订脚本的 72 项检查通过。原生 Mac CI 使用软件渲染，不替代实体 Mac 的 GPU 与触控板实测。

两架构的 PPT 缩放、像素圆角、双主题及窄窗口截图已核对。证据：`app/test-results/release-v0.8.17-mac-arm64/`、`release-v0.8.17-mac-x64/` 及对应 `*-summary.json`、`release-v0.8.17-arm64-packages.json`、`release-v0.8.17-intel-packages.json`、`release-v0.8.17-intel-workflow.json`。

## 公开更新与下载

十个附件齐全，公开前 12 项核对通过：三份 SHA256 清单与 GitHub 附件摘要一致，Windows 更新清单 SHA512 与实测 EXE 一致；Mac DMG / ZIP 与两架构原生验收产物、本机重新计算的哈希一致。接下来切换最新稳定版并执行匿名更新发现及下载检查。

| 安装包 | 字节 | SHA256 |
| --- | ---: | --- |
| Windows x64 EXE | 113129827 | `2237ccf77ce4ccb698ab53f006be9aaa66a0ddbd2c0999e0589d1a293f01e6e8` |
| Mac arm64 DMG | 120365279 | `d2f7ada3ce609e18eff0015f8703f38a9f409899ee325d5c1049e48329b41cf5` |
| Mac x64 DMG | 126315450 | `bcb3e5dd4498a8597af20152d2812f12087490b656d8a0df6ff51f6eda2d73ef` |

## 待用户确认

用户交互手感、低配置复杂大文稿、高 DPI 与实体 Mac 触控板仍需实测。Windows 商业代码签名、Apple 公证尚未提供；Mac 采用 ad-hoc 签名，安装方式与前版一致。
