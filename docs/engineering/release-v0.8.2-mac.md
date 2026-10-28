# v0.8.2 macOS 补充发行验收

在已有 v0.8.2 Release 增加 Apple Silicon arm64 和 Intel x64 的 DMG、ZIP 及独立 SHA256 校验文件。应用逻辑沿用 v0.8.2 标签；Mac 构建补充 libvips 二进制包 README 中的组件许可声明，不改 Windows 发行附件。

构建提交：`3a9e5edd12acf3034c3b99b1ce99e176c0f6dcda`。最终检查见 [GitHub Actions](https://github.com/Even1997/tugou/actions/runs/40726962054)。Intel 首次验收成功后保留附件；ARM 因 runner 容量不足被取消排队，单独重试后通过，未重复构建 Intel。两个架构的最终包内 16 项检查、实际应用启动和 MCP 连通性均通过。

## 发布结果

流水线成功结束，[v0.8.2 稳定版](https://github.com/Even1997/tugou/releases/tag/v0.8.2) 已新增以下四个安装文件和两份 `SHA256SUMS-mac-*.txt`，原 Windows 安装器摘要保持不变。

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| tugou-0.8.2-mac-arm64.dmg | 1041597062 | 85522e87f5cfedc4814065681341bcb30f4d5252c2ab5aa3ab27e3ae462046df |
| tugou-0.8.2-mac-arm64.zip | 1146925147 | e7ef885305f437d77621b7dafb1ab33b0b8cfa2848805e567d8f53213120b9de |
| tugou-0.8.2-mac-x64.dmg | 1047162114 | 5ef0e748e3a484b9357fab5572ed5045fa013a55d4526e270b7e0f9455c51eae |
| tugou-0.8.2-mac-x64.zip | 1153627317 | ba7cc7af6cba7b6e5acce43356a24fc04b3e769adb37d2bb1ec506d7f6bcd3cc |

公开访问验证未携带登录凭证：四个安装文件均返回正确 HTTP 206 字节区间及总大小，两份校验文件可读取，SHA256 与 GitHub 上传摘要相同。没有重复从公网完整下载四个包；全包完整性由 CI 的 DMG、ZIP 和 SHA256 检查验证。证据位于 `app/test-results/mac-release-public.json`；两个架构报告与日志位于 `app/test-results/mac-release-final/`，实际程序均发现 MCP 135 条命令。

## 构建与验收方式

- `.github/workflows/release-mac.yml` 由维护者手动触发。两个架构分别使用原生 macOS runner，权限默认只读；全部构建和检查通过后，发布任务才取得 Release 写权限。
- 每个任务只构建自身架构；检查 Info.plist 版本、Mach-O 架构、包内 ad-hoc 签名、DMG 完整性和 ZIP 解压完整性，并核验 libvips 许可声明进入随包声明文件。
- 包内桌面检查从最终 ASAR 加载代码与界面，使用隔离用户目录。每个架构 16 项检查：渲染来源、隔离环境、原生菜单、Mac 窗口样式、顶栏间距、原生 sharp、复制粘贴、撤销重做、MCP 编辑保存、字体枚举、系统加密可用性、设置分区、保存重载、关闭隐藏、Dock 恢复及渲染错误。
- 原生桌面报告分别记录 180 个系统字体家族、55 个内置字体家族，渲染错误为 0；截图已人工检查。没有把开发运行器的成功等同于最终程序启动成功，后者用包内 `Contents/MacOS/Tugou` 独立启动并验证 MCP。
- 曾发现验收临时目录使用 macOS `/var` 符号链接，被既有数据路径保护拒绝；测试改用 `realpath` 后的独立目录，不放宽应用路径保护。

## 发行边界

本批 Mac 包只有 ad-hoc 临时签名，没有 Apple Developer ID 签名和公证。`codesign --verify` 通过仅证明包内签名结构完整，不代表受 Apple 信任或已经通过 Gatekeeper。供手动下载安装，不发布 `latest-mac.yml`，不宣称已经具备可信自动升级链路。

原生 CI 检查不覆盖所有实体 Mac、输入法、全屏、多显示器、系统权限、真实供应商、Python/OCR/Potrace、长时间大工程压力或从旧版安装升级。下载安装后的 Gatekeeper 交互需要用户设备验证；不建议关闭全局安全保护。

质量自评按本轮手动发行范围：功能/代码/UI/UX 9.5；性能 9.3（完整字库包体较大，长时压力未测）；安全 9.3（包体与校验验证，尚缺开发者签名与公证）；美术 N/A（未改视觉资产，仅复核现有界面）。未达 9.5 的改进项继续保留。
