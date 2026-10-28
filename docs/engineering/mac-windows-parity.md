# macOS / Windows 一致性检查（2026-10-28）

本轮目标：共用创作能力、工程格式、字体和编辑命令；保留 Command / Ctrl、原生窗口按钮等系统习惯。完成定义分为源码与可在当前主机执行的回归、Mac 原生发布验收两部分。后者没有真机，不标为完成。

## 已改动

- Mac 使用隐藏标题栏和原生交通灯，顶部预留 92px；Windows 保留现有窗口控制。浅深主题、940 / 1380px 均检查无溢出。
- 原生菜单复制、剪切、粘贴、全选现在可以操作弹窗输入框；弹窗仍阻断对后方画布的操作。画布菜单转发使用对应平台修饰键。
- Mac 通过系统 AppKit 枚举字体家族、别名和非斜体字重；保留 60 秒缓存。新建文字统一使用已内置的 Source Han Sans SC，已有工程显式字体不变。不同电脑安装的本机字体清单本来就会不同。
- 字体环境新增跨平台 Node 安装脚本，检查 Python 3.12 与芯片架构、固定依赖、OCR 模型初始化和 Potrace 后再写配置。Mac 使用 bin/python3，Windows 使用 Scripts/python.exe。仅解释器文件允许 POSIX venv 符号链接，数据目录仍禁止链接和越界路径。
- 更新安装识别增加 ~/Applications；挂载 DMG 和开发预览不启用安装更新。监听 Electron before-quit-for-update，避免 Mac 更新关窗时进入普通隐藏窗口流程。
- Mac 打包最低版本明确为 13.0，保留 arm64 / x64 的 DMG 与 ZIP；Windows 保留 NSIS。未在 Windows 制作或宣称已签名的 Mac 安装包。

## 验证与证据

| 检查 | 结果 | 证据（相对 app） |
| --- | --- | --- |
| 相关 Node 回归 | 43 通过，0 失败，1 跳过 | test-results/mac-parity-unit.txt |
| Windows 真实 Electron 与 IPC | 30 通过，0 渲染错误 | test-results/mac-parity/win32.json |
| Mac renderer 平台模拟 | 30 通过，0 渲染错误 | test-results/mac-parity/mac-ui-simulation.json |
| 构建、主进程与安装脚本语法、diff 空白 | 通过 | test-results/mac-parity/ui；node --check；git diff --check |

桌面检查覆盖：菜单复制剪切粘贴、撤销重做、弹窗输入与隔离、未保存状态、内置字体实际加载、保存重开、93 个本机字体读取、上下文隔离和本机凭证加密能力。模拟测试仅修改 preload 的平台标记；其字体枚举、加密及窗口底层仍是 Windows，不能当作 Mac 实测。截图已人工查看。

跳过项是 POSIX 解释器符号链接：Windows 主机创建此类链接返回 EPERM。目录链接拒绝测试使用 Windows junction 实际通过。Mac AppKit 的枚举脚本目前仅做受控桥接对象测试；安装脚本仅模拟子进程顺序与失败路径，未执行真实 Mac 依赖安装。

## Mac 原生验收入口

在 Mac 源码 app 目录安装依赖后执行：

```sh
TUGOU_BUILD_DIR=test-results/mac-parity/ui node build.cjs
./node_modules/.bin/electron test/mac-parity-desktop.cjs
node --test test/mac-parity.test.cjs
```

字体运行环境（准备同架构 Python 3.12 和含授权文件的 Potrace 目录）：

```sh
node scripts/setup-font-runtime.cjs /absolute/path/python3.12 /absolute/path/potrace-dist /absolute/path/font-runtime
```

然后在字体页选择生成的 font-runtime 目录。脚本需联网安装锁定依赖；不会自动下载来源不明的 Potrace。跨系统迁移工程时，运行环境和系统加密凭证需在目标电脑重新配置。

发布前必须在 Apple Silicon、Intel 各验证：交通灯与全屏/关窗/重新激活、中文输入法与 Command 菜单、系统字体/字重和 PNG 导出、OCR/字体导出与本地抠图/超分、MCP 重连、Keychain、签名与公证后的实际下载和升级。特别检查超分二进制是否需要 Rosetta。当前没有这两类 Mac 环境，完整双端验收被此条件阻塞。

原生实现依据：[Electron 标题栏](https://github.com/electron/electron/blob/main/docs/tutorial/custom-title-bar.md)、[更新退出事件与 Mac 签名要求](https://www.electronjs.org/docs/latest/api/auto-updater)、[Apple NSFontManager](https://developer.apple.com/documentation/appkit/nsfontmanager)。

## 质量自评（10 分制）

| 维度 | 分数 | 说明 / 尚需改进 |
| --- | --- | --- |
| 共享功能与 Windows 回归 | 9.5 | 实际 Electron 编辑与持久化通过 |
| Mac 全链路功能 | 8.8，未验收 | 无 Mac 真机；必须完成上述原生矩阵，不能宣称双端完全一致 |
| 代码 | 9.5 | 平台分支集中、共享命令链路、失败路径与回归通过 |
| UI / 美术 | 9.4 | 现有设计保持一致；真实交通灯、Retina 字体渲染待看 |
| UX | 9.4 | 弹窗编辑与撤销正常；Mac 输入法和原生窗口体验待验 |
| 性能 | 9.3 | 保留字体缓存和按需加载；Mac 枚举延迟、连续绘画尚无测量 |
| 安全 | 9.3 | 路径限制、隔离、更新保护回归通过；签名、公证、Keychain 待真机 |

当前交付是已回归的源码修正，不是 Mac 发布验收通过。未修改用户工程、未发布安装包、未自动重启用户实例。
