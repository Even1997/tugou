# v0.8.4 发布验收

本版包含多页面工程、MCP 界面检查、字体按需下载、删除管理及确认按钮和配方输入修复。所有资产先放入草稿，双端检查完成后已[公开为最新稳定版](https://github.com/Even1997/tugou/releases/tag/v0.8.4)。

## 已验证

- Node 全量回归：385 项，384 通过、1 项平台限定跳过、0 失败，`app/test-results/release-v0.8.4-tests.log`。
- 运行时依赖审计：0 已知漏洞，`app/test-results/release-v0.8.4-audit.json`。
- 页面与确认按钮桌面检查 37 项、删除管理 11 项、供应商配置 40 项通过，渲染错误 0。模型接口为本地模拟，不调用收费生成。
- 本次待提交文件扫描未发现高置信 API Key、GitHub Token 或私钥候选；不等同于完整历史审计。

## 发布检查

发布源码标签 `v0.8.4` 指向 `455d71bdaa39f61fa515fd6cc16132ea7482cd7c`。原生构建：[GitHub Actions](https://github.com/Even1997/tugou/actions/runs/40826704809)。

| 检查 | 结果与证据（相对 app/） |
|---|---|
| Windows 包内页面与按钮 | 37 项通过，渲染错误 0，`test-results/release-v0.8.4-pages/report.json` |
| Windows 包内字体下载与离线导出 | 17 项通过，`test-results/release-v0.8.4-fonts/report.json` |
| Windows 包内设置 | 32 项通过，`test-results/release-v0.8.4-desktop.json`；旧测试硬编码的 136 命令已改为核对包内实际命令目录 |
| Windows 包检查 | 17 项通过，版本/源码/渲染构建一致，更新元数据大小与 SHA512 正确，无用户数据，无内置字形文件；`test-results/release-v0.8.4-package.json` |
| Windows 实际程序 | 独立空白测试目录启动实际 Tugou.exe，MCP 返回 149 命令，测试窗口已关闭；`test-results/release-v0.8.4-launch.json` |
| 云端字体资产 | 55 家族、141 字重逐项与公开字体 Release 的大小、SHA256 元数据一致 |
| Mac Apple Silicon | 原生包 16 项、字体 17 项、页面按钮 37 项、完整 DMG 下载校验及挂载 6 项通过；`test-results/release-v0.8.4-mac-arm64/` |
| Mac Intel | 原生包 16 项、字体 17 项、页面按钮 37 项、完整 DMG 下载校验及挂载 6 项通过；`test-results/release-v0.8.4-mac-x64/` |

Windows EXE 为 105,735,175 字节（100.84 MiB），v0.8.3 为 952,830,570 字节，缩小约 88.9%。首次下载的字体缓存不包含在安装包体积中。

Mac 双架构构建成功，Windows 与 Mac 共 10 个附件全部公开。发布后匿名验证 23 项通过，证据 `test-results/release-v0.8.4-public.json`：Windows v0.8.3 发现 v0.8.4，两种 Mac 架构选择正确的 DMG，公开校验清单与 GitHub 附件摘要一致，7 个包体/更新文件的 Range 下载可用。本轮公网仅做 Range 检查；Mac 完整 DMG 下载与挂载在原生 CI 的本地 HTTP 流上验证，不混称公网完整下载。

主要包体 SHA256：

| 文件 | SHA256 |
|---|---|
| Windows EXE | `5786da882bae26d93d337dbeaea03f691be4874d3526ed6acc53b073ae3be7b2` |
| Apple Silicon DMG | `3f54376214cf8f1e1fca4f0eb308dfe1db1f3802b66a6c7b92c7673df454084a` |
| Intel DMG | `549585ba46a37d93f7a439d469fda92fdc97d7903d3503aab9a5d4b3120e5f9b` |

## 已知边界

- Windows 无代码签名；Mac 只有 ad-hoc 签名，无 Developer ID 公证。Mac 更新保留手动替换安装。
- 不将 CI 结果等同于全部实体设备、Gatekeeper 人工交互、长期大工程或所有历史版本升级验收。
- 字体首次下载和更新依赖 GitHub；已缓存字体可离线使用。发布包不包含用户工程、Key、会话凭证或测试数据。
- 用户运行中的实例不作为发布测试夹具，不强制退出。
- 本轮未重复完整 NSIS 安装升级、实体 Mac 手动替换和 Gatekeeper 首次许可验收。

质量自评：功能、代码、UI/UX 9.5/10；性能 9.3/10（包体缩小 88.9%，长期大工程压力尚未覆盖）；安全 9.3/10（摘要、隔离与依赖检查通过，缺少系统信任签名/公证）；美术 N/A（沿用现有资产）。在上述边界内可交付。
