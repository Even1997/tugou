# 土狗

本地图像创作工作台：提示词模块与配方、无限画布、模型生成、素材库和图层合成共用一个桌面入口。

- 独立应用代码：`app/`（Electron、React、Ant Design、React Flow）。
- 开发：进入 `app` 后执行 `npm ci`、`npm start`；检查：`npm test`。
- 本机预览：双击 `启动土狗预览.cmd`。模型 API 在应用内统一配置。
- 构建与测试：`app/release`、`app/test-results`，位于项目所在 F 盘。
- 用户数据：保留 `app/preview-data`、`data`；工具与历史运行目录链接继续保留。

旧版 web、桌面壳、Go 服务和 Agent 源码已移出当前项目。同级 `旧版源码归档-20261023` 已由用户删除并核实不存在。示例图片保存在 `assets/studio-demo`。

[使用说明](app/README.md) · [本批验收](docs/engineering/independent-node-redesign.md) · [后续事项](docs/progress/todo.md)

Windows 本机验收；Mac 实机仍待验。

项目自有代码采用 [Apache-2.0](LICENSE)，Copyright (c) 2026 Even。再分发时依条款保留适用的 [NOTICE](NOTICE)、版权和来源声明；欢迎自愿告知商用情况，通知不是授权条件。

第三方许可不变，详见 [授权范围](app/LICENSING.md) 与 [第三方声明](THIRD-PARTY-NOTICES.md)。历史 AGPL 正文已单独保留，逐模块权属与发行合规审核尚未完成。
