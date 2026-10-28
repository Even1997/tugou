# v0.8.2 发布验收

版本同步根 VERSION、package.json 和锁文件；提交既有独立桌面产品改动及授权字库。根 README 重写安装、模型、字体、MCP、更新、备份和开发流程；app/README 移除已废弃的入口说明。详细用户变更见 docs/releases/v0.8.2.md。

| 检查 | 结果与证据（相对 app/） |
|---|---|
| Node 回归 | 348 通过，1 项 Windows 无法验证 POSIX 链接而跳过，test-results/release-tests.log |
| 首轮波动 | 默认高并发出现一次文本任务失败；单项及并发限制 4 的全量回归通过，未放宽断言 |
| 运行时依赖 | npm audit --omit=dev 无已知漏洞，test-results/release-audit.json |
| 正式包内设置 | 32 项通过，0 渲染错误，test-results/settings/desktop.json |
| 实际安装升级 | 11 项通过，0 渲染错误；真实 NSIS 下载/SHA512、未保存拦截、升级启动、工程/资源/设置保留及 MCP 重连，test-results/settings-update/installed-report.json |
| 进程保护 | 拒绝覆盖运行的测试程序，原进程存活，settings-update/installer-guard.json |
| 正式包检查 | 版本、关键后端和 UI 与源码一致，未混入连接文件、用户目录或测试输出，test-results/release-package.json |
| 更新文件 | latest.yml 版本、路径、952775267 字节大小、SHA512 与 EXE 一致，另提供 SHA256SUMS.txt |
| 公开更新源 | 无登录凭证的 Electron electron-updater 从测试版本 0.8.1 发现 v0.8.2；清单、blockmap、EXE 均返回有效 HTTP 206 区间响应，test-results/release-public-check.json |
| 发布边界 | 源码候选扫描未命中高置信 token/私钥模式，用户数据和运行环境被忽略；模式扫描不是完整 Git 历史审计 |
| 文档 | README 本地链接有效，平台/附加环境/功能边界与实际实现一致 |

正式产物在 app/release/v0.8.2，Windows x64 安装包约 909 MiB，须同时发布 EXE、blockmap、latest.yml 与 SHA256SUMS.txt。更新源固定为 GitHub Even1997/tugou，不包含测试 feed 或发布凭证。

发布结果：v0.8.2 已推送标签并设为 GitHub 最新稳定 Release（非草稿、非预发布），4 个附件均为 uploaded；GitHub 返回的 SHA256 摘要与本地安装器、blockmap 和 latest.yml 一致。地址：https://github.com/Even1997/tugou/releases/tag/v0.8.2 。用户明确授权后，仓库已改为公开，GitHub API isPrivate=false；匿名实际更新客户端发现新版及下载入口验证通过。

升级测试使用独立 appId、程序名、安装目录和用户数据，通过本机 HTTP 提供真实 NSIS 包，未操作用户开发预览。公开 GitHub 验证使用隔离 Electron 用户目录且未提供认证，读取真实更新元数据并访问附件字节区间；未再次完整下载约 909 MiB 的公开安装器或在用户实例上安装。全量安装、哈希校验和数据保留由前述本机升级测试验证，两部分证据分别记录。

质量自评：功能/代码/UI/UX/美术 9.5；性能 9.3（大字库体积、高并发测试波动、长期压力及既有 ResizeObserver 通知待改进）；安全 9.3（固定源、哈希和安装拦截通过，Windows 签名与 Mac 签名公证仍缺失）。按明确的 Windows 范围可交付，不宣称全平台完备。Mac 真机、历史来源复核及字体许可暂缓项继续保留。
