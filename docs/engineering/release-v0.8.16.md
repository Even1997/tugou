# v0.8.16 发布验收

已公开为 [最新稳定版 v0.8.16](https://github.com/Even1997/tugou/releases/tag/v0.8.16)，Windows x64、Mac arm64 / x64 安装包与更新资源全部发布。本版包含画布多图对比、联动 / 独立调整、Ctrl＋滚轮统一缩放、提示词悬浮预览及中英文 README 更新，详见 [版本说明](../releases/v0.8.16.md)。

## 代码与 README

- 发布源码 / 标签：`f4f52a0` / `v0.8.16`；后续 `41a5b36` 仅修正两个桌面验收脚本的包内入口路径，生产源码未改变。
- 根 VERSION、package.json、lockfile 和安装包版本一致。CHANGELOG 保留空的 Unreleased；中英文 README 的版本、功能说明、安装链接、语言切换、居中 Logo 与本地文档链接均核对通过，GitHub 文件摘要与提交一致。
- 全量逻辑检查 530 项通过、1 项平台跳过；本次变更文本的高置信密钥候选扫描无命中，不代表完整历史秘密审计。

## Windows

- 包体与更新清单 165 项检查通过：生产源码 / 构建资源逐字节一致，包内版本正确，无用户工程、测试结果、配置凭据或按需字体二进制。
- 包内多图对比 45、提示词预览 22、更新提醒 60，共 127 项桌面检查通过，渲染错误 0；真实 EXE 的启动、保存、凭据加密与辅助进程另 5 项通过。
- 两项新功能还使用与 Mac 一致的相对包路径复验通过；测试使用隔离数据目录，不调用付费生图，不重启用户窗口或改动其未保存工程。

证据：`app/test-results/release-v0.8.16-unit.log`、`release-v0.8.16-readme.json`、`release-v0.8.16-package.json`、`release-v0.8.16-windows-summary.json`、`release-v0.8.16-executable.log`、`release-v0.8.16-relative-path.log`。

## Mac 原生验收

- [双架构发布流程](https://github.com/Even1997/tugou/actions/runs/42484062194) 完整成功，arm64 / x64 各 26 份报告、858 项通过，渲染错误 0。
- 两架构均检查原生二进制架构、ad-hoc 签名、DMG / ZIP 完整性、真实程序启动、完整 DMG 下载及原生挂载；包括现有 PPT / 图层 / MCP / 字体 / GIF / 更新和本次新增交互。
- 多图对比与提示词预览在两架构分别通过 45 / 22 项；Windows 和 Mac 的双主题、窄窗口、两列细看与悬浮内容实际截图已核对。
- [首轮流程](https://github.com/Even1997/tugou/actions/runs/42483562086) 在发现新增验收脚本直接使用相对 require 路径后主动取消；修正仅涉及测试入口，之后完整重跑成功。未修改产品源码、移动版本标签或屏蔽控制台错误。

证据：`app/test-results/release-v0.8.16-mac-arm64/`、`release-v0.8.16-mac-x64/` 及对应 `*-summary.json`。

## 公开更新与下载

十个附件齐全；公开前 12 项核对通过，三份 SHA256 清单与 GitHub 附件摘要一致，Windows 更新清单 SHA512 与实测 EXE 一致。公开后 23 项匿名检查通过：Windows 从 v0.8.15 发现 v0.8.16，Mac 两架构发现正确 DMG，七个安装 / 更新文件的公开 Range 下载成功，Windows 附件摘要与本机构建一致。

证据：`app/test-results/release-v0.8.16-prepublish.json`、`release-v0.8.16-public.json`、`release-v0.8.16-public.log`。开启自动检查后，用户将在启动或每 30 分钟检查时发现新版；跳过旧版本不屏蔽本版，安装仍需确认。Mac 使用 DMG 手动替换，升级后重连 MCP。

| 安装包 | 字节 | SHA256 |
| --- | ---: | --- |
| Windows x64 EXE | 113120840 | `8d2a9fdb1b7d73ab2f0fcd7c4c7e363a6cff665a9fa993d0d29590e7d59bbd1f` |
| Mac arm64 DMG | 120385189 | `628354f767fc74f1068bc80d6f8e714dcbe11eaadf3077d11d16f06f5aaf6bf2` |
| Mac x64 DMG | 126010885 | `10113e970f8d88ffb862d94c3a72c6907a412644b90ae0f9ff88113200c77f01` |

## 质量自评

| 维度 | 评分 | 验证与改进点 |
| --- | --- | --- |
| 功能 / 代码 | 9.5/10 | 全量逻辑、三平台包内检查、源码与版本一致性及公开更新验证通过 |
| UI / UX | 9.4/10 | 双主题、窄窗口与实际截图已核对；真实方案图和触控板手感、高 DPI 仍待用户确认 |
| 性能 | 9.4/10 | 十图对比及完整回归通过；低配置、超大原图与长时交互压力仍待补充 |
| 安全 | 9.3/10 | 变更密钥候选扫描、包体隔离、凭据保护和公开摘要验证通过；Windows 商业代码签名与 Apple 公证尚未提供 |
| 美术 | N/A | 本版未新增美术资源，界面视觉计入 UI |
| 整体 | 9.4/10 | 在上述验证范围内合格、可交付 |

发布不等于用户已确认所有交互，体验待确认项继续保留在 pending-test。
