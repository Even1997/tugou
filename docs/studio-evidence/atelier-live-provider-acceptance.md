# 真实生图通道验收：尺寸兼容问题待修

18:36更新：真实增强1024和创意放大2048各一次均返回1254×1254；增强可明确本地缩小恢复，2倍放大无法满足。认证GET批量模型接口明确404 BATCH_IMAGE_DISABLED，不再仅是公开前端线索。详见atelier-live-cloud-quality-acceptance.md。已询问用户供应商尺寸/异步说明和视觉模型名，不索要密钥。

2026-10-21 17:38只读核验正式服务：已有生图API密钥标记，xymm.win、gpt-image-2.5-flare配置可连接，视觉分析模型为空。`models`返回flare和sunburst两项；未读取/打印密钥，没有修改配置。此前“API全部未配置”的记录已过时，不能继续据此阻塞全部云端验证。

## 一次真实编辑请求

脚本`web/tests/studio-live-edit.mjs`调用现有正式网关，原图/蒙版/后处理使用生产代码；原始输入仅为本机生成的几何图，没有用户照片。所有产物在D:/CanvasStudioLiveQA，未保存到正式工程或修改旧素材。脚本在发送前持久记录，检测到已有记录就拒绝重复请求，避免自动重发计费。

- 1024×1024：米白背景，角落两个色块、中央红圆；要求只把圆改为蓝色。
- 请求Images edits：`size=1024x1024`，一个PNG参考图、透明编辑蒙版、n=1；真实返回耗时21484ms。
- 模型返回1254×1254，已目视确认圆变蓝且整体构图相近。由于尺寸不同，`finishCloudImage`按现有规则拒绝合成；没有静默拉伸，没有覆盖原图。此用例判定**失败**，不能以“返回了图片”替代工具验收。
- 证据：`live-edit.json`、`source.png`、`provider-output.png`；没有protected-output.png。只发出一次图像请求，不作自动重试。收费情况未查询，不能宣称免费。

[官方OpenAI尺寸说明](https://developers.openai.com/api/docs/guides/image-prompting#model-parameters)明确支持1024×1024；因此当前结果与请求不一致，不能据此宣称该模型本身不支持。第三方通道的行为仍需独立适配/验证。未更改已选模型或服务配置。

## 新发现与下一步

第十二批候选已补“原始返回图保留/查看/保存”和明确的同比例缩小对齐，默认仍拒绝静默缩放。真实返回图缓存复用及最终包UI/取消/重启/像素保护验收见atelier-generation-review-acceptance.md。正式桌面尚未更新，模型背景色差接缝也仍待改进；不是把原始失败记录改成通过。

供应商[公开批量界面](https://xymm.win/docs/batch-image)的`BatchImageGuideView-Bniwloh1.js`提供真实异步协议线索：POST /v1/images/batches，Idempotency-Key；GET /v1/images/batches/{id}；GET /{id}/items；GET /{id}/items/{custom_id}/content?image_index=0；模型列表GET /v1/images/batches/models。提交包含model、image_size、response_mime_type、items[{custom_id,prompt,output_count,reference_images}]，图片参考形如type/reference、mime_type、data。公开UI固定image_size=1K，不能推断支持任意精确尺寸，也不能推断与同步模型共用能力。尚未调用这些异步接口；不要照猜测发收费请求。

当前完成边界：连通/一次真实编辑返回/尺寸保护有证据；增强、创意放大、扩图、语义蒙版、真人画质、视觉分析、异步恢复和完整桌面流程未通过。功能验收仍不合格，保护逻辑可用不等于云端工具整体可交付。
