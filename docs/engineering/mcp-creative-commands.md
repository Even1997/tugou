# MCP 全量创作命令

本轮源码提供 179 条命令，沿用 7 个顶层 MCP 工具与原有 stdio 配置。已有连接无需新增服务器配置；运行旧代码的桌面窗口需要先保存工程，再重启应用及客户端连接。用 `get_state.capabilities.commands` 确认加载的目录。当前工作中的旧窗口不自动重启，以保护未保存内容。

## 调用约定

1. `get_state` 获取实时 `revision`、工程和 `filesRoot`。
2. `list_commands({domain, schemas:true})` 查询目标命令参数；`query_objects` / `get_object` 取得真实对象 ID。
3. 可撤销文档编辑通过 `run_command` 或 `batch`，传入最新 `expectedRevision`。批次只允许文档编辑，整批一次撤销。
4. 耗时命令传入唯一 `requestId`，立即返回 `taskId`。同一工程、同一内容与同一 ID 重放返回原任务，不再次提交；改变内容需新 ID。
5. `task.wait({id,timeoutMs:1000})` 有界等待，或 `task.get` 查询阶段；`task.cancel` 取消本地处理。完成后 `task.result({id})` 返回图层、素材、结果节点或导出文件信息。

耗时操作使用提交时的文档版本。等待期间手动编辑或切换工程，写回将失败并保留现有工程；重新读取状态、检查任务后，用新 ID 重新提交。取消编码不保证立刻终止底层编解码，但取消后不会追加结果或导出文件。新处理任务不使用旧 `task.retry` 的供应商快照重试机制。

## 新增与扩展能力

| 场景 | 命令与用法 |
|---|---|
| GIF 制作 | `gif.create`：`frames:[{assetId,delay}]` 顺序即帧顺序，可重复引用同一图片；`delay` 单位毫秒，为 10 的倍数；`loop:0` 无限、`1` 一次 |
| 动画导出 | `artboard.timeline` 查询合成帧；`artboard.exportAnimation` 指定 `format:'png',frame` 或 `format:'gif',startFrame,endFrame`；帧号从 **1** 起，路径扩展名必须匹配格式 |
| 结果图选择 | `canvas.selectResult({id,assetId})` 选择该节点已有结果，后续连线引用随之变化；不会调用生成模型 |
| 节点编辑 | `canvas.duplicate` 复制组及内部连线、重映射内部引用；`canvas.resize` 统一显示尺寸，不改变素材像素 |
| 配方引用 | `recipe.references` 整体设置有序参考图与职责；`prompt.binding` 编辑单项覆盖、重置或冲突处理；`canvas.refreshBinding` 显式刷新模块/配方节点快照 |
| 图层属性 | `layer.create/update` 支持直线、完整混合模式、缩放、倾斜、透视四角、剪贴和外部蒙版来源；拒绝不可逆变换和循环依赖 |
| 选区与裁切 | `selection.color` 的 `contiguous:true/false` 分别为魔棒/颜色范围；`selection.grow` 正数扩展、负数收缩；`selection.feather` 羽化；`artboard.cropSelection` 按选区边界裁切 |
| 选区组合 | 矩形、椭圆、多边形均支持 `replace/add/subtract/intersect`。反选后继续矢量组合，先 `selection.rasterize` 固化 |
| 蒙版 | `mask.link({linked:false})` 固定世界坐标；`mask.transform` 的矩阵相对所属画板；`mask.relink` 固化当前外观并重新跟随图层 |
| 局部调整 | `layer.adjustmentFromSelection` 创建带当前选区蒙版的调整图层；参数与 `layer.adjustment` 一致 |
| 绘画与修图 | `paint.create` 透明绘画层；`paint.stroke` 支持逐点压感和平滑；`paint.retouch` 支持 `clone/heal/blur/smudge/liquify`；`image.contentFill` 使用当前选区 |
| 笔刷坐标 | 笔画点为画板坐标；仿制来源 `source:{u,v}` 为原图归一化坐标 0–1；`pressure:true` 时每点 `pressure` 为 0–1 |
| 排版 | `layout.update` 设置网格、吸附和参考线；参考线位置相对画板 |
| 素材筛选 | `asset.search` 按名称、来源、形状筛选，按名称、像素数或时间排序，并分页 |
| 导演台 | `scene.captureAngles` 拍摄 4/12 方位，创建独立素材和连线结果；`scene.record` 录制 1–60 秒动画为视频素材，后台也能运行 |
| 迁入 | `project.importLegacy` 导入旧工程及相邻 `resources`；`project.migrateCanvas` 导入包含 `state`、`images` 的历史快照 JSON；保留归档，不切换当前工程 |

## GIF 调用示例

以下 ID 和 revision 必须替换为当前查询结果，不应直接照抄：

```json
{
  "command": "gif.create",
  "expectedRevision": "当前 revision",
  "args": {
    "requestId": "本次制作唯一 ID",
    "name": "演示动图",
    "frames": [{"assetId":"图片 A 的 ID","delay":100},{"assetId":"图片 B 的 ID","delay":200}],
    "width":512,
    "height":512,
    "loop":0
  }
}
```

完成后由 `task.result.result.assetId` 取得 GIF 素材；用已有 `layer.create` 加入画板，或 `canvas.create(type:'asset')` 加入画布。导出至 `filesRoot` 下相对路径，拒绝越界、符号链接逃逸与覆盖已有文件。

## 边界

- MCP 像素编辑仍限 1600 万像素；GIF 最多 240 帧、单边 4096，帧像素总量不超过 64 × 1024 × 1024。
- 导演台输出长边上限 2048、场景最多 200 个物体、模型共 100 万顶点。录制最长 60 秒、媒体上限 256 MiB。
- 本地组件必须已安装；API 生图/分析仍可能收费，保持既有模型配置与请求去重规则。
- 安装更新、更新源、组件安装、原生系统窗口、剪贴板和工程删除确认仍由用户操作。未开放 shell、脚本执行或任意文件读写。
- 这些是本轮源码和 Windows 隔离验收结果，不代表新版本已发布；Mac 原生及真实大工程仍需补验。
