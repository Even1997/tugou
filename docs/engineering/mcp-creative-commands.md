# MCP 全量创作命令

创作命令沿用 7 个顶层 MCP 工具与原有 stdio 配置。已有连接无需新增服务器配置；运行旧代码的桌面窗口需要先保存工程，再重启应用及客户端连接。用 `get_state.capabilities.commands` 确认加载的目录。当前工作中的旧窗口不自动重启，以保护未保存内容。

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
| 图层排版 | `layer.align` 支持六向对齐，`layer.distribute` 支持水平、垂直等距。两者的 `target` 均可选 `objects`、`selection` 或 `board` |
| 网格与参考线 | `layout.update` 设置网格、吸附和参考线，位置相对画板 |
| 文字字体 | `font.library` 列出本机、云端及已发布字体。把 `font.face` 的结果传给图层或 PPT 文字的 `properties` 或 `patch` |
| 素材筛选 | `asset.search` 按名称、来源、形状筛选，按名称、像素数或时间排序，并分页 |
| 导演台 | `scene.captureAngles` 拍摄 4/12 方位，创建独立素材和连线结果；`scene.record` 录制 1–60 秒动画为视频素材，后台也能运行 |
| 迁入 | `project.importLegacy` 导入旧工程及相邻 `resources`；`project.migrateCanvas` 导入包含 `state`、`images` 的历史快照 JSON；保留归档，不切换当前工程 |

## 多图缩放与液化

多选缩放会检查整组的累计倍率，包括嵌套分组内的图层。越界时整次操作取消。液化沿笔画长度均匀采样，直线可只传两端。多帧 GIF 请先导出所需的静态帧，导入 PNG 图层后再液化。
- `layer.scaleSelection` 接受同一画板的多个图层 ID。例如 `{"ids":["照片A","照片B"],"factor":1.5,"anchor":"nw"}` 固定左上角，图片及间距一并放大到 150%。固定点可选 `nw/ne/se/sw/center`，默认中心。全部图层一次撤销。
- `paint.retouch` 选择 `tool:"liquify"`。默认 `liquifyMode:"push"`，传起点和终点推移。单点膨胀示例为 `{"id":"照片A","tool":"liquify","liquifyMode":"bloat","points":[{"x":80,"y":60}],"size":64,"opacity":50,"requestId":"liquify-1"}`。收缩使用 `pucker`。笔刷直径使用原图像素，落点使用所属画板坐标。写入前取得最新 revision，提交后用 task.wait 查询完成状态。

## MCP 图层排版

两个命令都接受图层 `ids` 和方向 `axis`（`x` 或 `y`）。`layer.align` 另需 `mode`（`start`、`center` 或 `end`）。例如把标题和图标一起水平居中，可以调用 `layer.align`，参数为 `{"ids":["标题ID","图标ID"],"axis":"x","mode":"center","target":"board"}`。将 ID 替换为实际图层 ID，并在 `run_command` 外层传入实时 `expectedRevision`。

| target | 对齐 | 等距分布 |
| --- | --- | --- |
| `objects` | 至少两个独立对象分别对齐到它们的共同外接框 | 保留首尾边缘，均分对象之间的净距 |
| `selection` | 全部对象一起移到所属画板有效选区的外接框 | 首尾贴选区边缘，中间净距相等 |
| `board` | 全部对象一起移到所属画板的边缘或中心 | 首尾贴画板边缘，中间净距相等 |

显式指定参照时，所有对象须在同一画板内。选中组及其子层只计一个对象，等距分布至少需要三个独立对象。省略 `target` 会沿用旧调用规则。选区支持加减、相交、反选、羽化和位图，MCP 单次选区扫描及源位图各限 1600 万像素。可以在一个 `batch` 中创建或修改选区再排版。失败时整批回滚，单独重复已完成的排版会返回 `changed: false` 并保留当前撤销记录。

## MCP 字体示例

- 本机字体用 `font.face` 传 `{source:'system',family:'Arial',fontWeight:700}`。如果云端目录也有同名字体，仍使用本机字体。
- 云字体用 `font.download` 传 `{family:'霞鹜文楷',fontWeight:500}`。下载后把结果中的 `font` 传给 `layer.create`、`layer.update`、`ppt.element.create` 或 `ppt.element.update`。也可传目录里的 `{id:'lxgw-wenkai-500'}` 下载，并用 `font.face` 取得字体属性。
- 已发布自定义字体用 `font.face` 传 `{projectId,jobId}`，将结果作为字体属性使用。

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

## 画板单位与矢量路径

- `artboard.create` 接受 `width`、`height`、`unit`（px/mm/cm/in）及 `ppi`。例如 `{"name":"请柬","width":14,"height":20,"unit":"cm","ppi":300}`。读取画板时 width/height 是像素，printSize 保存输入尺寸。`artboard.update` 单改 PPI 时保留已有物理宽高。
- `layer.create` 传 `kind:"shape"`、`properties.shape:"path"`。例如 `paths:[{closed:false,nodes:[{x:0,y:1,out:[0.2,0.1]},{x:1,y:0,in:[0.8,0.7]}]}]`。坐标与绝对控制点相对于图层宽高归一化，多轮廓使用奇偶填充。使用 `get_object` 读取，`layer.update` 修改外观或整条路径。`layer.pathAnchor` 按 id、contour、index、handle（anchor/in/out）、x、y 修改单点，索引从 0 起。
- `layer.pathInsertAnchor` 和 `layer.pathDeleteAnchor` 接受 `id`、`contour`、`index`。插入会对锚点之后的曲段做中点细分并返回新索引；闭合轮廓可细分末点到首点的曲段。删除后返回当前可用索引。每个轮廓至少保留两点，一个图层所有轮廓合计最多 12000 点。两项均可放入可撤销的文档批次。
- `image.vectorize` 接受图片图层 id、requestId 和可选的黑白阈值 threshold（1–254，默认 128）。使用 task.wait、task.result 取得新路径图层 id，原图保留。`layer.exportSvg` 接受路径或纯路径分组 id 与会话文件根目录内的 .svg 路径，沿用独占输出。
