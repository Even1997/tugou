# 土狗桌面应用开发说明

安装使用见[项目首页](../README.md)，版本变更见[发布说明](../docs/releases/v0.8.2.md)。`app/` 是当前源码入口，Electron、React、Ant Design 与本地工具共用工程格式，无需旧 Web/Go 服务。

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

Mac 更新需要签名、公证、真机验证后的 DMG/ZIP 和更新清单。本次 v0.8.2 仅发布 Windows x64；构建配置不代表已通过 Mac 真机验收。

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
