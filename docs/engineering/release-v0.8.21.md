# v0.8.21 发布验收

Windows x64、macOS Apple Silicon 与 Intel 安装包已在 GitHub 公开。标签 `v0.8.21` 指向合并提交 `722bee3`，根版本、桌面包和锁文件一致。 [发布页](https://github.com/Even1997/tugou/releases/tag/v0.8.21)

## 验证结果

- 591 项逻辑测试通过，1 项 POSIX 专用测试在 Windows 按平台跳过。
- Windows 通过 168 项包体检查，实际程序以隔离配置启动。局部编辑 49 项、画布平移 39 项、云字体 22 项、自定义字体 27 项均通过，专项报告中无渲染错误。另完成 65 项原位文字和 26 项富文本检查。
- macOS 两种架构各通过 28 份报告、930 项检查，包括原生启动、DMG 下载与挂载、PPT 和图层操作、字体下载与离线导出。 [macOS 构建与验收](https://github.com/Even1997/tugou/actions/runs/44786229994)
- 多画板样例重测中，2,560 图层的合成与绘制中位数约 38 ms，基线约 199 ms。640 图层样例选中约 87 ms，合成器调用 0 次，切换画板至绘制完成约 689 ms。11 组画面像素和分块 PNG 导出与基线一致。

## 发布处理

v0.8.20 候选版的 Apple Silicon 回归两次触发 `ResizeObserver` 错误，Windows 的同一生成路径也复现。v0.8.21 将节点尺寸测量合并到下一动画帧，按原断言重新验证。最终 Windows 与两种 macOS 安装包的局部编辑用例均通过。候选版保留在草稿中。 [原合并](https://github.com/Even1997/tugou/pull/1) · [发布修复](https://github.com/Even1997/tugou/pull/2)

公开前 12 项附件检查通过，三份 SHA256 清单和 10 个附件齐备。Windows EXE 为 114,087,769 字节，SHA256 为 `13dc412e53e8ca9d37ef609f26157de245e975d7fcb4951c7a00dd44bea260c7`。Windows 安装器未做商业签名，Mac 程序采用 ad-hoc 签名。

公开后 23 项匿名检查通过。Windows 更新器从 v0.8.19 识别到新版，两种 macOS 更新器各取得对应 DMG，7 个安装及更新文件可分段下载，附件摘要与清单一致。

复测证据在 `app/test-results/release-v0.8.21/`、`release-v0.8.21-package.json`、两份 `release-v0.8.21-mac-*-summary.json`、`release-v0.8.21-prepublish.json` 和 `release-v0.8.21-public.json`。实体 Mac、高 DPI 与真实大工程的长时间操作仍需复测。
