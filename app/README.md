# 土狗桌面应用开发说明

安装使用见[项目首页](../README.md)，版本变更见[发布说明](../docs/releases/v0.8.6.md)。`app/` 是当前源码入口，Electron、React、Ant Design 与本地工具共用工程格式，无需旧 Web/Go 服务。

## 开发

需要 Node.js 22 LTS 或兼容更新版本，依赖由 package-lock.json 锁定。

```sh
cd app
npm ci
npm run dev
```

开发预览见[安全热更新](../docs/engineering/dev-preview.md)。界面修改保留工程、撤销及未保存状态；繁忙时延迟应用，主进程/preload 修改仍需重启。`npm start` 是构建后运行，不带开发预览管理器。

## 测试

```sh
npm test
# 高核数或资源紧张的机器可限制并发
node --test --test-concurrency=4 test/*.test.cjs
```

Electron 脚本位于 `test/*-desktop.cjs`，运行前查看脚本的构建和数据目录。必须使用独立 `TUGOU_DATA_DIR`，不要把真实用户工程作为可写夹具。测试输出在 `test-results/`，不提交。Mac renderer 模拟不等于 Mac 真机验收。

## 字体环境

v0.8.4 已将字体改为按需下载，详见[字体下载与缓存](../docs/engineering/font-downloads.md)。安装包保留完整目录、字重和许可；首次使用需要联网，下载后离线使用，不安装到系统字体目录。旧版已下载的字体资源和工程保持不变。

普通排版及本机/内置字体无需 Python。图集导入、OCR、校正、描图和字体导出需要匹配当前系统/芯片的 Python 3.12，以及 Potrace 发行目录（含可执行文件、COPYING、README、AUTHORS）。

```sh
node scripts/setup-font-runtime.cjs "<Python3.12可执行文件>" "<Potrace目录>" "<新建字体环境目录>" "<实际workspace目录>"
```

脚本建立 venv、安装锁定依赖、验证 OCR 并写入环境清单。第四个参数把环境绑定到工作区；也可用 `TUGOU_FONT_RUNTIME` 指定。不要跨平台复制 venv，不要提交本机环境或用户字体数据。Python 依赖与 Potrace 按各自许可使用/分发，不能视为项目 Apache-2.0 许可的一部分。

## 构建与发布

```sh
npm run dist:win
# 在 Mac 主机上执行，配置自己的签名及公证凭证
npm run dist:mac
```

更新源在 `electron-builder.cjs` 固定为 `Even1997/tugou`。Windows 稳定 Release 必须同时包含安装 EXE、对应 `.blockmap` 和 `latest.yml`，版本、文件名、大小与 SHA512 必须匹配；另附 `SHA256SUMS.txt` 供用户核对。只有安装器而没有 latest.yml，应用不能正确发现更新。

Mac 构建由 `.github/workflows/release-mac.yml` 手动触发。tag 留空时仅构建和验收，产物保存为 Actions 附件，不修改 Release；填写已有发布标签时，构建前核对应用源码与标签一致，仅允许文档、许可证收集及发布验收脚本存在明确差异。分别在原生 arm64 / x64 runner 构建 DMG、ZIP，检查包体、原生模块、界面、MCP、字体下载/离线导出及完整 DMG 下载/挂载。发布模式在两个架构全部通过后才附加到已有草稿或稳定 Release，不覆盖现有 Windows 附件。新版本先建草稿，待 Windows 和两种 Mac 附件齐全、校验通过后再公开。

当前 Mac 包只有 ad-hoc 签名，无 Developer ID 签名和公证，不上传 `latest-mac.yml`。本版更新逻辑改为直接读取公开 GitHub Releases 的最新稳定版，按应用架构选择 DMG，验证 asset 的 SHA256 digest 和大小；流式下载支持进度与断点续传，最大 4 GiB。默认自动检查、手动下载，可开启自动下载。下载后点击“打开安装包”，保存退出，再拖入 Applications 替换；应用不会自行退出、安装或移除系统隔离标记。首次包含该功能的版本需从旧版手动安装。

发布 DMG 必须使用 `tugou-${version}-mac-${arch}.dmg`（arm64 / x64）命名，GitHub API 附件必须带 `sha256:` digest；缺失架构附件、摘要或下载失败均提示错误，不误报最新版。缓存放在用户数据目录 `updates/mac-dmg`，与工程目录分离。Mac 检查仍要求安装到 `/Applications` 或用户的 `Applications`。本地控制器与 renderer 检查不等于 Mac 原生挂载及手动替换验收；未来若要自动安装，再单独评估签名、公证和更新链路。

发布前同步根 VERSION、package.json/package-lock.json，整理 CHANGELOG 和版本说明；检查测试、许可、敏感文件及更新资源。正式 Release 应为稳定版而非 draft/prerelease。私有仓库不能供不携带 GitHub 凭证的公共客户端自动更新，禁止把发布令牌打入应用。

安装版和开发预览可能使用不同数据目录，实际路径以「设置 → 文件与存储」为准。安装器不会强制结束未保存工程，也不会在普通退出时自动安装更新。

## 代码入口

| 目录/文件 | 职责 |
|---|---|
| desktop-main.cjs / preload.cjs | 生命周期、IPC 与系统能力 |
| renderer/ | 画布、合成、字体、模型和设置 UI |
| core/ | 存储、任务、模型、MCP、字体与更新服务 |
| runtime/ | 图像/字体处理脚本与依赖清单 |
| assets/fonts/ | 内置字体、原始许可及来源 |
| test/ | 逻辑回归与隔离桌面验收 |

历史文档可能描述已移除入口；使用方式以根 README 和当前 Release 为准。许可范围见 [LICENSING.md](LICENSING.md)。

开发版 MCP 界面验收：见 [截图、导航与原视图恢复](../docs/engineering/ui-mcp.md)，包含长列表、无限画布及覆盖范围说明。

开发版多页面：同一工程管理多张画布和多份合成，详见 [项目页面与 MCP](../docs/engineering/project-pages.md)。
