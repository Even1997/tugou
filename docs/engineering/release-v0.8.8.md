# v0.8.8 发布验收

范围：画板右键与批量原尺寸保存、可见水印修复和元数据清理工具，详见[版本说明](../releases/v0.8.8.md)。

完成定义：VERSION、应用包和锁文件均为 v0.8.8；当前代码提交并打标签；Windows x64 与 Mac arm64／x64 附件来自同一应用源码；EXE／blockmap／latest.yml、两架构 DMG／ZIP 与 SHA256 清单齐全后公开为最新稳定版；检查公开下载、版本与更新发现。

实现阶段证据沿用[画板保存验收](artboard-image-export.md)和[清理工具验收](cleanup-tools.md)，本次不混称全部回归重跑。Mac 新清理组件的安装／处理以及大批量超大图压力待专项验证。

发布状态：已公开为[最新稳定版](https://github.com/Even1997/tugou/releases/tag/v0.8.8)，源码标签对应 `8eae799`，Windows x64 与 Mac 两架构附件齐全。使用隔离输出目录，不覆盖安装用户当前实例，不触发外部模型生成。

## 包体和来源

46 个待提交文件未发现高置信秘密候选，见 `app/test-results/release-v0.8.8-secret-scan.json`；不等同完整历史秘密审计。根 VERSION、应用包和锁文件统一为 v0.8.8，README、CHANGELOG 和版本说明同步更新。

Windows 安装包及更新文件 24 项核对通过：检查真实 ASAR 的后端、清理组件目录、三平台锁文件和界面入口，排除用户数据、测试结果和字体二进制；`latest.yml` 的版本、路径、字节数及 SHA512 均与 EXE 一致。组件仍按需下载，没有将 Python、工具二进制或完整字体打进主包。证据：`app/test-results/release-v0.8.8-package.json`。

| 包 | 字节 | 大小 | SHA256 |
|---|---:|---:|---|
| Windows x64 EXE | 105,836,486 | 100.93 MiB | `cc7f59fafb17ec32e40c0760ca8a2d8e35ea060df7a434d4bbf08382265a5f21` |
| Mac arm64 DMG | 113,010,926 | 107.78 MiB | `b3b8fb25df45be3c4cba47aed93f6c3644f2bdd3a4d1b84bad0beadd7c5e2270` |
| Mac x64 DMG | 118,599,554 | 113.11 MiB | `06527c4b85fc3b18e23c4052fd775b4511b1b1695f69086a548a9aea1c145edd` |

## Mac 原生发布检查

[GitHub Actions](https://github.com/Even1997/tugou/actions/runs/41259656671) 两架构及上传全部成功，应用源码与标签一致。每架构 175 项原生检查通过：基础渲染／原生图片模块／编辑／MCP 16 项，字体下载与离线导出 17 项，页面确认 37 项，并发／设置 24 项，进程重启 3 项，更新说明 46 项，同步对比 26 项，DMG 完整下载／摘要校验／挂载 6 项。另检查程序架构、ad-hoc 签名、ZIP 完整性和实际已打包程序 MCP 启动。

证据：`app/test-results/release-v0.8.8-mac-arm64/` 与 `release-v0.8.8-mac-x64/`，两端报告均无意外渲染错误。已查看原生窄窗口截图。上述流程未运行新清理组件的实际安装／修复专项，不将通用包体检查等同于两个新工具已在实体 Mac 完成效果验收。

## 公开更新检查

10 个附件先在草稿中收齐，核对全部 SHA256 清单和 GitHub digest 后公开为 Latest。随后 23 项匿名检查通过：真实 NsisUpdater 从 v0.8.7 发现 v0.8.8；两架构 Mac 更新器选择各自 DMG；Windows 公开附件与本地构建一致；3 份摘要清单对应全部安装包／更新文件；7 个附件可公开 Range 下载。证据：`app/test-results/release-v0.8.8-public.json`。

公网检查为 Range 请求；完整 DMG 下载和挂载在 Mac CI 本地 HTTP 流中完成。Windows 未覆盖安装用户实例；Mac 沿用下载 DMG 后手动替换，不发布 Squirrel 更新清单。

## 质量自评

| 维度 | 评分 | 验证与改进点 |
|---|---|---|
| 功能／代码 | 9.5/10 | 实现阶段证据、包内代码和标签、三平台发布附件及更新发现一致 |
| UI／UX | 9.4/10 | 实现阶段深浅主题及窄窗口、原生发布截图通过；实体 Mac 操作待补 |
| 性能 | 9.3/10 | 主包保持按需资源体积，逐张导出；大批量超大图压力待补 |
| 安全 | 9.3/10 | 文件候选秘密、包体排除、摘要和来源检查通过；Windows 未签名、Mac 未公证 |
| 美术 | N/A | 发布已有界面，本次未新增美术资产 |
| 整体 | 9.4/10 | 在上述验证范围内可交付 |
