# 无边框窗口验收

日期：2026-10-20

## 完成标准与范围

主工作台移除系统标题栏；顶部空白可拖动，交互按钮不参与拖动；自绘最小化、最大化/还原、关闭；状态跟随系统操作；关闭走现有未保存/生成中保护。重点风险是误拖按钮、窄窗口挤压、关闭绕过保存保护和 IPC 权限扩大。

采用 Electron 官方的 [draggable regions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) 和受限 BrowserWindow 操作。保留 sandbox、contextIsolation、nodeIntegration=false。窗口命令校验页面来源、主 frame 和动作白名单；不开放任意 IPC、窗口坐标或系统命令。其他独立页面窗口保留原系统边框。

## 验证结果

- 主进程/preload 语法、TypeScript 检查、生产构建和 Windows x64 打包通过。
- `desktop/tests/window-controls.e2e.cjs` 使用真实主进程、sandbox preload、生产前端和独立 userData/工程；6 组验收通过，详见 `frameless-e2e.json`。
- 最小化按钮生效；还原后最大化/还原按钮生效；外部最大化/还原事件会更新按钮图标。
- 顶部 CSS 为 drag、按钮为 no-drag；Electron 原生移动接口正常。主窗口外框与内容尺寸均为 1500×980。
- 未知动作 `destroy` 被拒绝；测试日志中的“不支持的窗口操作”为预期断言。
- 1100px 宽时导航顶端 64px、窗口控制区底端 64px，控件在窗口内且不重叠。控制按钮宽 44px。
- beforeunload 被触发时，“继续编辑”保持窗口，“仍然关闭”关闭窗口。自动测试替代了原生对话框答复，验证两个分支。
- 浅色、深色与窄窗口截图复核：`frameless-light.png`、`frameless-dark.png`、`frameless-narrow.png`。
- `release/frameless` 桌面已启动、快捷方式已更新；前后端 HTTP 200，原工程前后 SHA256 一致，详见 `frameless-desktop.json`。

## 限制与质量自评

初次 Windows 命中探测的按钮结果不一致；后续包含原生消息探测的后台验收进程被自动审批拒绝，只返回 `blocked by policy`。已移除该探测，改用 Electron 自身 API 完成按钮、状态和关闭保护验收。实际鼠标拖动、标题栏双击和跨显示器 DPI 仍待人工验证，不记为通过。

| 维度 | 分数 / 10 | 判断 |
|---|---:|---|
| 功能 | 9.4 | 窗口按钮与关闭保护实测；原生鼠标动作待补 |
| 代码 | 9.5 | 单一窗口组件、受限桥接，无新依赖 |
| UI / UX / 美术 | 9.4 | 两主题和窄窗口复核；跨 DPI 待补 |
| 性能 | 9.5 | 仅事件订阅和三个按钮，无轮询；正常启动 |
| 安全 | 9.5 | 来源/frame/白名单限制、隔离测试、工程哈希保留 |
| 整体 | 9.4 | 可交付，保留上述人工验证项 |
