# v0.8.22 发布验收

Windows x64、macOS Apple Silicon 与 Intel 安装包已在 GitHub 公开。标签 `v0.8.22` 指向合并提交 `4056b21`，根版本、桌面包和锁文件一致。 [发布页](https://github.com/Even1997/tugou/releases/tag/v0.8.22) · [合并记录](https://github.com/Even1997/tugou/pull/3)

## 验证结果

- 拖动优化通过 51 项相关逻辑测试和 141 项 Windows 源码桌面检查。像素比 1 和 2 下均验证松手坐标、一次撤销、拖动不安排自动保存，以及预览与完整合成像素一致。 [专项记录](../progress/pending-test.md#图层与画板拖动预览)
- Windows 最终包通过 168 项包体检查和 5 项隔离启动及保存检查。安装器为 114,088,070 字节，SHA256 为 `6c8f9b6a124ec431ad0bcd095b2694bf39413206f080bedbea6b35719ae9b329`。
- macOS 两种架构各通过 28 份报告、930 项检查，包含架构与签名、原生启动、DMG 下载和挂载。 [macOS 构建与验收](https://github.com/Even1997/tugou/actions/runs/44855802946)

公开前 12 项附件检查通过，三份 SHA256 清单与 10 个附件齐备。公开后 23 项匿名检查通过，Windows 与两种 macOS 的更新器均从 v0.8.21 发现新版，7 个安装及更新文件可分段下载。

Windows 安装器未做商业签名，Mac 程序采用 ad-hoc 签名。实体 Mac 和真实复杂工程中的持续拖动性能仍需实测。验收证据位于 `app/test-results/layer-drag/`、`app/test-results/release-v0.8.22-*.json` 和 `app/test-results/release-v0.8.22-mac-*-final/`。
