# v0.8.15 发布验收

已公开为 [最新稳定版 v0.8.15](https://github.com/Even1997/tugou/releases/tag/v0.8.15)，代码、Windows x64 和 Mac arm64 / x64 安装包全部发布，范围见 [版本说明](../releases/v0.8.15.md)。版本与标签一致，三平台包内检查、附件摘要及匿名更新入口验证完成。

## 代码与 Windows

- 发布源码 / 标签：`5611c8e` / `v0.8.15`；后续提交仅记录发布证据，应用源码不变。
- 全量逻辑 530 通过、1 项平台跳过；37 个本次变更文件高置信密钥候选扫描无命中，生产依赖审计 0 漏洞，不代表完整历史秘密审计。
- Windows 包体与更新清单 59 项通过；149 个已跟踪生产文件逐字节一致，渲染资源与本次构建一致。未包含用户工程、测试结果或按需字体二进制。
- 包内 PPT MCP 68、四角圆角 34、阴影边框 42、更新提醒 60，共 204 项桌面检查通过，渲染错误 0；真实 EXE 启动、保存、凭据加密与辅助进程另 5 项通过。
- 本轮包内大纲、原生 Mac 窄窗口、真实 PNG 与四角效果截图已查看。测试使用隔离 profile 与模拟模型服务，不调用付费生成，未重启用户窗口或改动其工程。

证据：`app/test-results/release-v0.8.15-unit.log`、`release-v0.8.15-package.json`、`release-v0.8.15-source-check.json`、`release-v0.8.15-windows/summary.json`、`release-v0.8.15-update-prompt.log`、`release-v0.8.15-executable.log`。

## Mac 原生验收

- Apple Silicon [独立复验流程](https://github.com/Even1997/tugou/actions/runs/42387440701) 成功，24 份报告共 791 项通过，渲染错误 0；DMG / ZIP 完整性、架构、ad-hoc 签名、真实程序启动、完整 DMG 下载与原生挂载通过。
- Intel [原生复验任务](https://github.com/Even1997/tugou/actions/runs/42386549277/job/128449924633) 成功，同样 24 份报告、791 项通过，渲染错误 0；原生启动、签名 / 架构、下载与挂载通过。
- 首轮两个 Mac 架构的新增 PPT、阴影、PSD、修图、完整 MCP 均通过；旧局部生图的 48 项功能断言通过，但最终零控制台错误断言捕获一次 `ResizeObserver loop completed with undelivered notifications`，首轮未放行。
- 两架构的完整复验均未重现该警告，没有修改应用源码、测试或屏蔽日志。该观察保留，不将重试通过描述为根因已修复，后续关注 Mac 窗口尺寸变化。
- Apple Silicon QA 分支 `cf9bd45` 与标签仅差 `.github/workflows/release-mac.yml`：单架构矩阵、独立并发组及本架构校验清单。Intel 重跑原流程。原双架构流程因保留首轮 arm64 失败状态显示失败；arm64 由独立成功流程验收，Intel 已验收附件手工上传，不将整体失败状态描述为全部成功。

证据：`app/test-results/release-v0.8.15-mac-arm64-final/`、`release-v0.8.15-mac-arm64-final-summary.json`、`release-v0.8.15-mac-x64-final/`、`release-v0.8.15-mac-x64-final-summary.json`。首轮失败报告与日志也已保留。

## 公开更新与下载

10 个附件齐全；发布前 12 项核对通过，三份 SHA256 清单与 GitHub 附件摘要一致，Windows 更新清单 SHA512 与实测安装包一致。公开后 23 项匿名检查通过：Windows 从 v0.8.14 发现 v0.8.15，Mac 两架构发现各自正确 DMG，7 个安装 / 更新文件的公开 Range 下载成功，Windows 附件摘要与本机构建一致。

开启自动检查的用户会在启动或每 30 分钟检查时发现新版；跳过旧版本不会屏蔽本版，不代表服务器即时推送。安装需用户确认并保留保存保护；升级后重连 MCP。

证据：`app/test-results/release-v0.8.15-prepublish.json`、`release-v0.8.15-public.json`、`release-v0.8.15-public.log`、`release-v0.8.15-complete-metadata.json`。

| 安装包 | 字节 | SHA256 |
| --- | ---: | --- |
| Windows x64 EXE | 113112900 | `90b19f82f3c55a848a50e31355744222316c0b646bc9b0ab39f10c07e86fbd2c` |
| Mac arm64 DMG | 120416278 | `87f5748d02add194067c32addce24f1a4b143fe6b89e5ee0dd0c27d78e6996a9` |
| Mac x64 DMG | 126029247 | `857a6ab26ae6a904dfbee864d11c0cf690f1c01b67845d8d6926be0677f74edf` |

## 质量自评

| 维度 | 评分 | 证据与未达 9.5 的改进点 |
| --- | --- | --- |
| 功能 / 代码 | 9.5/10 | 530 单元、三平台包内验证、源码一致性、12 项附件及 23 项公开更新检查通过 |
| UI / UX | 9.4/10 | 双主题、窄窗口、Mac 原生截图与真实 PNG 已检查；实际 Agent 的等待确认与逐页看图、实体 Mac / 高 DPI、Office 对照仍待验证，尺寸观察提示继续关注 |
| 性能 | 9.4/10 | 当前规模和 51 页大纲验证通过；低配置、复杂大文稿与大图片长流程压力仍需补充 |
| 安全 | 9.3/10 | 依赖审计、密钥候选扫描、包体摘要、受限导出、凭据加密验证通过；Windows 商业签名和 Apple 公证尚未提供 |
| 美术 | N/A | 本轮发版未新增美术资源，界面视觉计入 UI |
| 整体 | 9.4/10 | 在上述验证边界内合格、可交付，不宣称所有环境已经验证 |

功能体验仍待用户确认的项目继续保留在 pending-test；发布不等于用户已确认所有交互。当前用户窗口与未保存工程未重启或修改。
