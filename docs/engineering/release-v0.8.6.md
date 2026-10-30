# v0.8.6 发布验收

范围：工具顶部导航与素材侧栏、中文输入修复、生图参数和隐藏画幅说明、生成张数输入、拉线菜单修复与纯图片查看器。已公开为[最新稳定版](https://github.com/Even1997/tugou/releases/tag/v0.8.6)，Windows x64 和 Mac arm64／x64 安装包与更新文件齐全。

## 完成定义

根 VERSION、应用包与锁文件版本一致；全部当前代码提交并标记 v0.8.6；Windows x64 和 Mac arm64／x64 包对应同一应用源码；GitHub 草稿收齐安装包、ZIP、更新文件和摘要后公开为最新稳定版；匿名确认 Windows 更新清单与 Mac DMG 发现及下载入口。用户正在运行的开发预览和未保存工程不用于发布测试，也不强制退出。

## 已有改动验收

| 范围 | 证据（相对 app/） |
|---|---|
| 工具导航、上传、同步对比和蒙版 | 193 项，`test-results/tools-ui/desktop-report.json`、`test-results/tools-upload/desktop-report.json`、`test-results/comparison-view/desktop-report.json`、`test-results/cloud-paint/desktop-report.json` |
| 中文输入法 | 29 项，`test-results/canvas-ime/desktop.json`；真实 Chromium 输入法事件，不以重复字符串过滤代替修复 |
| 生图界面与 MCP | 37 项，`test-results/image-settings/desktop.json`；包含模型规则、重试快照、画幅说明和原始提示词保留 |
| 纯图片查看器 | 24 项，`test-results/canvas-image-viewer/report.json` |
| 拉线菜单 | 18 项原生事件及 18 项逻辑检查，见 [专项验收](canvas-link-menu.md) |

以上为实现阶段的隔离检查，不混称本次全部重跑；外部模型调用均为本地模拟。字体、工具组件继续按需下载。完整细节见各专项工程文档。

## 发布包与公开更新

应用标签 `v0.8.6` 对应提交 `076b4d6057c4aa4c0a596f152a160163a375f189`。提交前对 54 个待提交文件进行高置信秘密候选及私有路径检查，未发现候选；证据 `app/test-results/release-v0.8.6-secret-scan.json`，范围不包括完整历史审计。

Windows 安装器已公开发布，105,776,083 字节（100.88 MiB），SHA256 `c2385884514971cf1bc0774bcede698cdeead5eaf5d13f16b06552c224a3125a`。包体与更新文件 31 项核对通过：版本、改动核心源码、渲染产物、公有更新源、latest.yml 路径／大小／SHA512 一致；未打入用户状态或完整字形文件。证据 `app/test-results/release-v0.8.6-package.json`。未重复运行已通过的本地功能回归，也未覆盖安装到用户实例。

[第二轮原生发布工作流](https://github.com/Even1997/tugou/actions/runs/41010398678) 全部成功。两个架构各通过 102 项包内检查：基础渲染／原生图片模块／编辑／MCP 16 项，字体下载／字重／离线导出 17 项，页面与确认按钮 37 项，同步对比／本地上传 26 项，完整 DMG 下载／校验／挂载 6 项。渲染错误为零。架构、ad-hoc 签名、ZIP 完整性和真实程序 MCP 启动同时通过；新包为 150 条 MCP 命令。Windows 未交叉编译 Mac 包。

证据分别在 `app/test-results/release-v0.8.6-mac-arm64-final/` 与 `app/test-results/release-v0.8.6-mac-x64-final/`。检查了原生 Mac 窄窗口截图，顶部工具、素材侧栏和同步对比布局正常；不等同于实体触控板与原生输入法人工验收。

| 包 | 字节 | 大小 | SHA256 |
|---|---:|---:|---|
| macOS arm64 DMG | 113,038,424 | 107.80 MiB | `76bf4186b03a1c710977ad4c47b021f57637d11121a96835b02ed3c9c1b43bf9` |
| macOS x64 DMG | 118,484,326 | 113.00 MiB | `8ba63aabef25fcba72c20539726c4702f35be7b7a525b81152cf406e2860c7e8` |

首轮 [原生 CI](https://github.com/Even1997/tugou/actions/runs/41008125668) 中，Intel 已通过 6 项 DMG 下载／挂载检查，随后清理仍在写入的 Electron userData 临时目录触发 ENOTEMPTY，异步清理异常令进程未退出，最终取消该轮。原始日志与证据保存在 `app/test-results/release-v0.8.6-intel-first.log` 和 `release-v0.8.6-mac-x64-first/`。`fb4f781` 仅修复发布验收脚本：活动测试目录留待临时 CI runner 回收，保留全部功能断言和挂载检查，应用代码与标签一致。

## 公开更新检查

所有平台共 10 个附件齐全后才公开为 Latest，随后 23 项匿名检查通过，证据 `app/test-results/release-v0.8.6-public.json`：实际 Windows NsisUpdater 从 v0.8.5 发现 v0.8.6；Mac arm64／x64 更新控制器选中各自 DMG；SHA256 清单与 GitHub 附件 digest 一致；Windows 更新文件同时匹配本地构建。7 个安装包／更新文件公开 Range 下载成功。

Mac 完整 DMG 下载与挂载使用 CI 本地 HTTP 流；公网本轮验证 Range 下载，不混称公网完整安装包下载。没有覆盖安装用户实例；发布期间通过只读 MCP 确认原实例工程 revision、撤销及对象计数未变。

## 质量自评

| 维度 | 评分 | 依据与剩余改进 |
|---|---|---|
| 功能／代码 | 9.5/10 | 包与标签一致、两架构原生流程和公开更新检查通过；不承诺所有供应商参数遵循 |
| UI／UX | 9.4/10 | 深浅主题、窄窗口及原生 Mac 截图检查；实体输入法、触控板和系统缩放待补 |
| 性能 | 9.3/10 | 安装包维持按需资源方式，Windows 100.88 MiB；大量不同大图和长期大工程压力待补 |
| 安全 | 9.3/10 | 暂存文件秘密候选、包体私有路径、SHA512／SHA256 和公开来源核对；Windows 未签名、Mac 未公证 |
| 美术 | N/A | 本轮发布既有界面，不新增美术资产 |
| 整体 | 9.4/10 | 上述范围内可交付，未把自动化等同完整实机或覆盖安装验收 |

## 风险与剩余验证

Windows 未代码签名，Mac 仅 ad-hoc 签名、未公证；保留手动替换 DMG 的更新方式。供应商不遵守请求尺寸的情况不会自动裁剪或额外收费重试。实体 Mac 原生输入法／触控板、长期大工程与大量不同大图的压力检查仍待补，不把自动化结果称为完整实机验收。
