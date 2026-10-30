# v0.8.6 发布验收

范围：工具顶部导航与素材侧栏、中文输入修复、生图参数和隐藏画幅说明、生成张数输入、拉线菜单修复与纯图片查看器。发布中；安装包与公开更新链路通过后再记录最终结果。

## 完成定义

根 VERSION、应用包与锁文件版本一致；全部当前代码提交并标记 v0.8.6；Windows x64 和 Mac arm64／x64 包对应同一应用源码；GitHub 草稿收齐安装包、ZIP、更新文件和摘要后公开为最新稳定版；匿名确认 Windows 更新清单与 Mac DMG 发现及下载入口。用户正在运行的开发预览和未保存工程不用于发布测试，也不强制退出。

## 已有改动验收

| 范围 | 证据（相对 app/） |
|---|---|
| 工具导航、上传、同步对比和蒙版 | 193 项，`test-results/tools-ui/desktop-report.json`、`tools-upload/desktop-report.json`、`comparison-view/desktop-report.json`、`cloud-paint/desktop-report.json` |
| 中文输入法 | 29 项，`test-results/canvas-ime/desktop.json`；真实 Chromium 输入法事件，不以重复字符串过滤代替修复 |
| 生图界面与 MCP | 37 项，`test-results/image-settings/desktop.json`；包含模型规则、重试快照、画幅说明和原始提示词保留 |
| 纯图片查看器 | 24 项，`test-results/canvas-image-viewer/report.json` |
| 拉线菜单 | 18 项原生事件及 18 项逻辑检查，见 [专项验收](canvas-link-menu.md) |

以上为实现阶段的隔离检查，不混称本次全部重跑；外部模型调用均为本地模拟。字体、工具组件继续按需下载。完整细节见各专项工程文档。

## 发布包与公开更新

待打包与发布后填入安装包版本、摘要、原生 Mac 工作流和公开更新验证结果。现有 macOS 发布工作流会在两个原生 runner 上构建、校验、执行包内检查后上传附件；不使用 Windows 交叉编译 Mac 包。

## 风险与剩余验证

Windows 未代码签名，Mac 仅 ad-hoc 签名、未公证；保留手动替换 DMG 的更新方式。供应商不遵守请求尺寸的情况不会自动裁剪或额外收费重试。实体 Mac 原生输入法／触控板、长期大工程与大量不同大图的压力检查仍待补，不把自动化结果称为完整实机验收。
