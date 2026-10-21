# 真实增强、创意放大与异步协议验收（2026-10-21 18:36）

结论：当前配置的xymm.win / gpt-image-2.5-flare两项真实请求均返回1254×1254，未遵守1024/2048目标。增强可通过第十二批已有的明确缩小操作恢复；2倍创意放大不足目标像素，未通过，不能用插值掩盖。当前密钥的异步图片接口被供应商禁用。

## 本轮请求和证据

- `web/tests/studio-live-cloud-quality.mjs enhance`：公开CC0 Chelsea照片、固定ATELIER 2026文字和两色块，本机组成1024×1024参考；要求原尺寸增强。26418ms返回1254×1254。记录atelier-live-enhance.json，原始图D:/CanvasStudioLiveQA/enhance-provider-output.png。
- 同脚本`upscale`：同一源图要求2048×2048的2倍创意放大。25999ms仍返回1254×1254；输出小于目标，不支持现有明确缩小恢复。记录atelier-live-upscale.json，原始图upscale-provider-output.png。
- 每个操作仅一次真实生成请求；独立报告在发送前以wx持久写入，已有报告拒绝重发。两次请求都保存原始返回，尺寸验证失败记录保持failed。本轮2次真实生图、没有自动重试，费用未查询；连同之前局部编辑，本阶段累计3次。没有上传用户照片、改变正式模型配置或写入正式工程。
- 已目视源图、两张原始返回和增强对齐图：文字内容与总体布局保留，猫毛锐度/对比提高，但毛发、眼部和背景色彩/质感也被改变，不证明真实细节恢复或身份保真。不能据此称高质量增强通过。

## 本地恢复

`studio-live-enhance-recovery.mjs`仅使用缓存返回，明确缩小到1024，含Alpha核验186ms；另构造0–255完整连续Alpha输入，1048576像素全部与原Alpha一致。原始图保留，没有新外部请求。结果enhance-aligned-output.png、证据atelier-live-enhance-recovery.json。只证明同一真实样本的明确恢复和连续Alpha处理，不覆盖新请求/全部模型。

## 只读协议核查

供应商[公开批量页面](https://xymm.win/docs/batch-image)及其BatchImageGuideView-Bniwloh1.js使用/v1/images/batches和image_size=1K；不能据此把同步Images的size字段改成image_size，或猜测2K/4K能力。

`desktop/tests/atelier-provider-capabilities.cjs`用独立Electron QA进程只读获取当前配置，密钥仅在内存中用于已配置HTTPS主机，重定向拒绝，不打印/落盘明文。首次解密因独立profile的加密状态不匹配失败；随后仅复制原profile的加密Local State到独立QA目录完成核查，原配置文件始终不变。进程退出后已删除QA加密Local State副本。没有唤起/接管正式隐藏窗口。

- GET /v1/models：200，只含flare、sunburst，没有尺寸/异步/视觉能力字段。供应商owned_by字段不能作为官方模型来源证明。
- GET /v1/images/batches/models：404，明确错误码`BATCH_IMAGE_DISABLED`、消息`batch image API is disabled`。这是已认证实际结果，不再仅是公开前端线索或未认证401。没有提交异步任务，不能宣称异步恢复完成。
- 报告atelier-provider-capabilities.json无密钥，credentialFileUnchanged=true。本轮该检查生图请求0。

已向用户异步询问供应商2K/4K输出和异步接口说明、可用视觉分析模型名，不索要密钥。此前用户“稍后配置/稍后开窗”仍有效，不重复询问安装许可。分析模型未配置，但不能说生图API没有配置。

18:35:49只读正式复核：build仍amyk6OypARE8BiyQjaxPU，2旧工程/时间戳、15资源、加密凭据与备份相同，本地工具正常。main36720响应，窗口仍隐藏。候选仍UaH5o0YgMACcUjYkVuQUA，未重打包或安装（本轮只加验收脚本）。所有生成与核查进程已结束。

## 质量自评

| 维度 | 分数 | 证据和未达标原因 |
|---|---:|---|
| 功能（真实云端需求） | 8.5 | 原尺寸/2倍输出失败，异步接口被禁；需供应商能力/协议确认 |
| 代码（本轮脚本） | 9.4 | 持久防重发、原始图留存、Alpha全量验证；仅单模型单样本 |
| UI / UX | N/A | 本轮未改界面；沿用第十二批已验的明确恢复操作 |
| 美术 | 8.8 | 可读文字/布局保持，照片细节被重绘，无高分辨率真值 |
| 性能 | 9.3 | 两次真实26秒左右及本地186ms；样本不足以承诺SLA |
| 安全 | 9.5 | 固定配置主机、无自动重试/明文密钥、无用户照片上传，旧数据一致 |

未达功能/美术门槛，不称完成。下一步等待已询问的协议/模型信息，同时推进本地工具尚缺的异常/批量/工程验证。不要再次执行live-edit或本轮两个已有报告的live测试，不将本地恢复结果改写为供应商尺寸测试通过，不为禁用的异步通道猜测收费参数。
