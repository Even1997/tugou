# v0.8.24 发布验收

标签 `v0.8.24` 指向 `e6d309e`。根版本、桌面包版本和锁文件一致。GitHub 已将其列为最新稳定版。 [发布页](https://github.com/Even1997/tugou/releases/tag/v0.8.24)

- Windows x64 从标签的独立工作区按锁文件安装依赖后打包。核对包内源码、5 项隔离启动与保存检查、37 项页签回归，以及 `latest.yml` 的版本、路径、大小和 SHA512。安装器为 114,059,670 字节，SHA256 为 `9554e0e79046ac12c949947af4b63b9d4129cdcb3974d1ed8f45b77dbd5794ce`。
- macOS arm64 与 x64 均通过包内回归、架构和签名核对、原生启动，以及完整 DMG 下载和挂载。两个架构均提供 DMG 和 ZIP。 [macOS 构建与验收](https://github.com/Even1997/tugou/actions/runs/45008503755)
- 公开前核对 10 个上传附件和三份 SHA256 清单。公开后，六个安装和更新附件均可匿名分段下载，Windows 最新更新清单返回 `0.8.24`。
- Windows 安装器无 Authenticode 签名。macOS 使用 ad-hoc 签名，尚未进行 Apple 公证。
