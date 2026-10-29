# v0.8.3 发布验收

本版增加 Mac 自动检查与 DMG 下载，安装由用户保存退出后手动替换。发布源码标签 `v0.8.3` 指向 `c75e3f592e3f51049e1e37a81ea697eb560a171e`；Windows 与两种 Mac 均从该版本构建。Mac 不使用 Squirrel 自动安装或 `latest-mac.yml`。

## 验证证据

| 检查 | 结果与证据（相对 app/） |
|---|---|
| Node 全量回归 | 355 项通过，1 项 Windows 无法验证的 POSIX 场景跳过，`test-results/release-v0.8.3-tests.log` |
| 依赖审计 | 运行时 0 已知漏洞，`test-results/release-v0.8.3-audit.json` |
| Windows 包内设置页 | 32 项通过，渲染错误 0，`test-results/release-v0.8.3-desktop.json` |
| Windows 安装包检查 | 版本、关键源码、UI 构建、semver 运行时、固定更新源及 SHA512/尺寸/路径一致，11 项通过，`test-results/release-v0.8.3-package.json` |
| Mac 更新界面 | 14 项独立 Electron 检查，含实际 IPC、下载进度、手动打开、五种语言窄窗口和主题，`test-results/mac-dmg-update/desktop.json`；该轮在 Windows 上运行 Mac 控制器，原生证据另列 |
| Mac Apple Silicon | 16 项原生包内检查、实际程序启动/MCP 135 命令；6 项实际 DMG 完整下载、SHA256 与原生挂载检查，`test-results/release-v0.8.3-mac-final/arm64/` |
| Mac Intel | 16 项原生包内检查、实际程序启动/MCP 135 命令；6 项实际 DMG 完整下载、SHA256 与原生挂载检查，`test-results/release-v0.8.3-mac-final/x64/` |
| 公开更新与下载 | 23 项匿名检查通过：公开稳定版、10 附件、Windows 0.8.2 发现 0.8.3、Mac 双架构发现、校验清单/API 摘要/本地构建一致，以及 7 个包体和更新文件的 206 Range 下载，`test-results/release-v0.8.3-public.json` |

[v0.8.3 已公开发布](https://github.com/Even1997/tugou/releases/tag/v0.8.3)，发布时间 2026-10-29 09:55（北京时间）。Windows EXE、两种 Mac DMG/ZIP、更新元数据和三份校验清单共 10 个附件，均上传完成后才设为最新稳定版。公开下载检查按 Range 读取，不计作公网完整安装包下载。

Mac 构建及验证记录：[发布验证运行](https://github.com/Even1997/tugou/actions/runs/40801460539)。原生下载检查使用新包内的控制器、真实完整 DMG 和本机 HTTP 流；GitHub 公开下载链路另行核验，避免将本机传输误称为公网完整下载。

首次运行 [40799178720](https://github.com/Even1997/tugou/actions/runs/40799178720) 中，Apple Silicon 完整通过，Intel 的包内启动、下载和摘要校验通过，但原生挂载超过验收脚本 120 秒上限。保留该失败记录，将测试挂载上限改为 900 秒后重新构建验证；没有跳过挂载检查或修改应用代码。CI 修订提交为 `7e2765c`，发布标签不变；工作流在构建前核对应用源码与标签一致，仅允许明确列出的文档、许可收集和验收脚本差异。

主要附件 SHA256：

| 文件 | SHA256 |
|---|---|
| tugou-0.8.3-win-x64.exe | `d842f90a8b36046b9bcf72aa30f61a1fcb6c427ca95d1a3aec536b0f22329c37` |
| tugou-0.8.3-win-x64.exe.blockmap | `8996deaed8b2286c02c9ab1fc945a05ab319fbfe16a45f71845b6df7462d65ed` |
| latest.yml | `b2fce1fe2f44674648b632281abe2bc31ee8005679c0b7502e1688c0ab461f9b` |
| tugou-0.8.3-mac-arm64.dmg | `901ba068644c5fe7f1d579ce600ff510c62c2be0016c7b77da5354270a5b6be4` |
| tugou-0.8.3-mac-x64.dmg | `9591140aa744fe80ba5f923e293096d6d72bb3f84b91d0c5efb17aa10df4fd0c` |

## 边界与质量

- 自动检查/下载不需要 Apple 会员；Mac 未 Developer ID 签名或公证，仍可能出现系统安全提示。本版不移除隔离标记或关闭安全保护。
- 原生挂载使用 hdiutil；“打开安装包”的路径交接经过测试，但 Finder 用户交互、Gatekeeper 首次允许、实体 Mac 手动替换后数据保留仍待进一步验收。
- Windows 保留原有安装保护，本轮验证更新元数据、包内运行及逻辑回归；未重复 v0.8.2 已完成的隔离 NSIS 完整安装升级试验。
- 用户正在使用的实例及未保存工程未被重启、覆盖或当作测试夹具。
- 源码增量模式扫描未发现高置信密钥/私钥候选，包内未混入用户数据或测试目录；这不是完整 Git 历史安全审计。

自评：功能、代码、UI、UX 9.5/10；性能 9.3/10（大字库导致约 1 GiB 包体，慢网长时下载尚需补测）；安全 9.3/10（固定公开源、摘要校验与路径保护通过，尚无系统信任签名/公证）；美术 N/A（本轮沿用既有视觉资产）。按本版范围可交付，不宣称全部实体设备场景验收完成。
