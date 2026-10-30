# 无限画布文档索引

## 项目介绍

- [快速开始](overview/quick-start.md)
- [功能介绍](overview/features.md)
- [Docker 部署](overview/docker.md)
- [第三方 GitHub 提示词仓库](overview/third-party-prompt-repositories.md)

## 操作手册

- [画布节点操作手册](canvas/canvas-node-manual.md)
- [画布快捷键](canvas/canvas-shortcuts.md)

## 开发文档

- [v0.8.6 发布说明](releases/v0.8.6.md)
- [v0.8.6 发布验收](engineering/release-v0.8.6.md)

- [图像工具顶部导航与素材侧栏](engineering/tools-navigation-materials.md)
- [中文输入法标点重复修复与验收](engineering/canvas-ime-input.md)
- [生图尺寸、分辨率、质量与 MCP 验收](engineering/image-generation-parameters.md)
- [土狗设置页与更新方案（待确认）](engineering/settings-update-proposal.md)

- [字体素材图闭环与 MCP](engineering/independent-font-pipeline.md)

- [本地开发](backend/local-development.md)
- [接口响应约定](backend/api-response.md)
- [系统配置数据结构](backend/system-settings.md)
- [后端数据库说明](backend/backend-database.md)
- [画布数据结构](backend/canvas-data-structure.md)

## 商务合作

- [开源协议](business/license.md)
- [商务合作](business/business.md)

## 赞助支持

- [打赏支持](support/donate.md)

## 项目进度

- [待测试](progress/pending-test.md)
- [TODO](progress/todo.md)

## 说明

- 未登录时画布项目和“我的素材”保存在浏览器本地；登录且账号同步可用时，会同步保存到账号/云端。
- 本地直连模式下，AI API Key 保存在浏览器本地，并由前端直接请求 OpenAI 兼容接口。
