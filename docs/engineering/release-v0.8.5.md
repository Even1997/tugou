# v0.8.5 发布验收

发布范围：工具手动下载、局部修改与抠图完善、工具 UI、本地上传、同步图片对比、组边框与更新提醒。Windows x64 和 Mac arm64/x64 验收后，已[公开为最新稳定版](https://github.com/Even1997/tugou/releases/tag/v0.8.5)。

## 发布前检查

- Node 全量回归：412 项，411 通过、1 项平台限定跳过、0 失败；证据 `app/test-results/release-v0.8.5-tests.log`。
- 运行时依赖审计：0 已知漏洞；证据 `app/test-results/release-v0.8.5-audit.json`。
- 修正两条旧批处理测试对抠图参数的过时假设：默认参数被保留，自选轻量模型与边缘设置随批次传递；未削弱生产校验。
- 源码阶段工具 UI 114 项、本地上传 12 项、同步对比 26 项、下载生命周期 14 项检查通过。下载生命周期使用模拟传输；图片导入与基础处理使用真实本地文件。原生超分及云端效果历史证据分别保存在对应工程验收文档中，不与本次发布回归混计。
- 当前用户实例与工程不作为发布夹具，不强制退出或覆盖安装。

## 完成定义

Windows 包内功能与源码一致；安装包版本、SHA512 更新清单、SHA256 下载摘要正确；Mac 两架构原生构建及包内检查通过；GitHub 附件齐全后公开为 Latest，并匿名检查旧版发现更新及下载入口。

## Windows 已验证

源码标签 `v0.8.5` 指向 `00b9d7b60637d605b6f3fcce600bc1b213fdfe7b`。后续 `2e3f953` 仅修复 CI 测试素材与相应工作流校验例外，应用源码保持与标签一致。

| 检查 | 结果与证据（相对 app/） |
|---|---|
| 包内页面与按钮 | 37 项，零渲染错误，`test-results/release-v0.8.5-pages/report.json` |
| 包内字体下载、字重和离线导出 | 17 项，零渲染错误，`test-results/release-v0.8.5-fonts/report.json` |
| 包内同步对比与上传 | 26 项，零渲染错误，`test-results/comparison-view/desktop-report.json`；生成固定素材后重跑通过 |
| 包体与更新文件 | 24 项，版本、源码和构建一致，SHA512、尺寸和更新地址正确，无用户数据和内置字形文件；`test-results/release-v0.8.5-package.json` |
| 实际 EXE 启动 | 独立测试目录启动并连接 MCP，149 命令；测试实例已结束，`test-results/release-v0.8.5-launch.json` |
| 待提交文件检查 | 97 文件未发现高置信 Key、Token 或私钥候选；不是完整历史审计，`test-results/release-v0.8.5-secret-scan.json` |

Windows EXE 为 105,754,618 字节（100.86 MiB）；SHA256 `d3e70ab89035dbfa462c5d6219f08ca01c0f73aa035e5b293aa28773bf899737`。字体和工具组件缓存另计，安装包没有重新纳入完整字体。

首轮 Mac 对比测试因引用本机未提交图片而失败，已改为由测试自行生成固定坐标素材；生产代码未改变。第二轮 Apple Silicon 仓库拉取长时间停滞，单独重试后通过，Intel 成功结果保留。原生构建记录：[GitHub Actions](https://github.com/Even1997/tugou/actions/runs/40916980095)。

## Mac 原生验收

Apple Silicon 与 Intel 均通过：包内渲染、原生图片模块、编辑、MCP 16 项；字体下载、字重及离线导出 17 项；页面与按钮 37 项；本地上传、并排／滑动对比、同步缩放和定位 26 项；完整 DMG 下载、校验及挂载 6 项。渲染错误为零。包架构、ad-hoc 签名、ZIP 完整性和真实程序 MCP 启动同时通过。

证据分别位于 `app/test-results/release-v0.8.5-mac-arm64/` 和 `app/test-results/release-v0.8.5-mac-x64/`；检查了 Mac 的窄窗口并排对比截图。测试通过 Electron 输入事件和本地 HTTP 下载流执行，不等同于实体 Mac 触控板或公网完整 DMG 下载。

## 公开更新验证

三个平台共 10 个附件全部上传完成后才公开为 Latest。发布后 23 项匿名检查通过，证据 `app/test-results/release-v0.8.5-public.json`：Windows v0.8.4 实际更新控制器发现 v0.8.5，Mac arm64/x64 更新控制器选择正确 DMG，所有 SHA256 清单与 GitHub 附件摘要一致，Windows 文件同时匹配本地构建；7 个安装包／更新文件的公开 Range 下载成功。

Windows EXE 100.86 MiB、Apple Silicon DMG 107.86 MiB、Intel DMG 113.08 MiB。公网本轮只验证 Range 下载；Mac 完整 DMG 下载与挂载在 CI 的本地 HTTP 流中验证，不混称公网完整下载。未进行用户机器上的 NSIS 覆盖安装或实体 Mac 手动替换。

## 质量自评与边界

| 维度 | 评分 | 依据与剩余改进 |
|---|---|---|
| 功能／代码 | 9.5/10 | 全量单测与三端包内检查通过，测试素材独立；不承诺所有外部供应商兼容 |
| UI／UX | 9.4/10 | 同步对比、上传、窄窗口及 Mac 截图检查通过；实体触控板和系统文件对话框人工验收待补 |
| 性能 | 9.3/10 | 安装包保持按需资源方式；超大图持续交互和长期大工程压力待补 |
| 安全 | 9.3/10 | 依赖、秘密候选、包内容及下载摘要检查通过；Windows 未签名、Mac 未公证 |
| 美术 | N/A | 本轮发布既有功能，不新增美术资产；云端生成的自然衔接仍需用户判断 |

结论为上述边界内可交付。没有覆盖安装到用户实例；没有把 CI 结果等同于全部历史版本升级或全部系统权限场景。AI 扩图细节、精细抠图低内存限制、字体 OCR 人工复核等既有边界继续保留。
