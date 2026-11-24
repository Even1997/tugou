# v0.8.25 发布验收

标签 `v0.8.25` 指向 `5bdcf15`，根版本、桌面包和锁文件均为 `0.8.25`。GitHub 已将本版列为最新稳定版。 [发布页](https://github.com/Even1997/tugou/releases/tag/v0.8.25)

- Windows x64 从独立标签工作区打包，核对了 ASAR 版本、核心文件和界面构建产物。隔离启动与保存检查 5 项、素材右键 17 项、MCP 64 项、PSD 19 项均通过。安装器大小为 114,067,986 字节，SHA256 为 `4bee33f2098ff9f4c2058eb700505ac8abd1267488b7708aedb1e6aded183e58`。更新清单的路径、版本、大小与 SHA512 均与安装器一致。
- macOS arm64 与 x64 均通过架构、签名与包内回归、原生启动和完整 DMG 下载挂载验证。Intel 首次验收中，PSD 测试在写盘结束前读取了工程。修正测试等待条件后，两个架构均从同一版本的应用源码完成验收。 [macOS 构建与验收](https://github.com/Even1997/tugou/actions/runs/45306175616)
- 公布前对照 GitHub 记录的摘要核对 10 个附件和三份 SHA256 清单。公布后，六个安装和更新附件均通过匿名分段下载，Windows 最新更新清单返回 `0.8.25`。
- Windows 安装器无 Authenticode 签名。macOS 包使用 ad-hoc 签名，尚未进行 Apple 公证。
