# v0.8.19 发布验收

GitHub 已公开 v0.8.19 为最新稳定版。Windows x64、macOS Apple Silicon 和 Intel 的安装包、更新文件及 SHA256 清单共 10 个附件。源码标签指向 `f6fc07b`，根 VERSION、应用包和锁文件的版本一致。 [下载与版本说明](https://github.com/Even1997/tugou/releases/tag/v0.8.19)

## 测试与包体

- Node 测试 588 项通过，1 项 POSIX 链接检查在 Windows 按条件跳过。同步了现有关闭窗口保存回执 `closeReady` 的覆盖清单，使用 2 路测试并发完成回归。
- Windows 通过 168 项包体和 202 项桌面检查。实际包内程序启动，工程保存重开，凭据加密检查通过。包内 48px 思源黑体的四字文字框为 196×52px，调至 72px 后位置保持。原生拖动后等待超过 10 秒，磁盘仍为原坐标。下一次内容保存写入最终位置，重开后位置和字号一致。
- macOS 两架构各通过 28 份报告、925 项检查，包含包体架构和签名校验、实际启动、DMG 下载和挂载。首次从标签触发时，检出和拉取的标签对象发生冲突。改从同一提交的 `main` 触发后，工作流核对了应用源码与发布标签的一致性。 [macOS 工作流](https://github.com/Even1997/tugou/actions/runs/44741146737)

Windows 与 macOS 桌面报告的渲染错误为 0。已查看 Windows 文字框和 Mac 窄窗口属性面板截图。大工程长时性能、高 DPI 和实体 Mac 操作继续实测。

## 公开下载与更新

正式公开前 12 项附件检查通过。三份 SHA256 清单与 GitHub 附件摘要匹配，Windows 附件与本地验收的包体一致。公开后 23 项匿名检查通过，Windows 从 v0.8.18 发现新版，macOS 两种架构各选中对应 DMG，7 个安装及更新文件可公开分段下载。

Windows EXE 为 114085137 字节，SHA256 为 `8ff8a4fcda40f9fea69725bd40a32825bfe13276896e87206605281536cd470d`。Windows 采用未签名安装器，Mac 采用 ad-hoc 签名，商业签名和公证待补。

验收报告位于 `app/test-results/release-v0.8.19/`、`release-v0.8.19-package.json`、两份 `release-v0.8.19-mac-*-summary.json`、`release-v0.8.19-prepublish.json` 和 `release-v0.8.19-public.json`。
