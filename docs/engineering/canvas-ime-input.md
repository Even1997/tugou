# 中文输入法标点重复修复

## 问题与修复

在真实 Electron 的画布文字节点重放 Chromium 输入法事件，一个 `，` 出现为 `，，`。同样事件在原生 textarea 中只有一个逗号；节点控件的原生 `value` 设置记录显示，输入后曾先回写旧值，再写入新值，使输入法组合区失效，最终提交被当成新字符再次插入。

修复位于 `app/renderer/components.jsx` 的共用 `TextArea`：

- 本地草稿即时显示，组合期间不向父级提交拼写中间值。
- 组合结束或失焦时提交当前文本；相同完整值的重复通知不产生第二个提交／撤销步骤。
- 外部修改、撤销和重做仍同步受控值；透传 Ant Design 属性和 ref，保持原有样式、标签、只读行为。
- 不过滤相邻字符，不改已有内容。用户有意输入的 `，，`、`……`、`！！` 原样保留。

未修改画布节点结构、生成参数或存储格式，也没有增加依赖。

## 验证

`app/test/canvas-ime-desktop.cjs` 使用隔离目录和本地文档，以 Chromium `Input.imeSetComposition`／`Input.insertText` 产生实际输入法组合事件，不以直接赋值代替上屏过程。29 项通过，渲染异常为零：

- 单个逗号、句号只出现一次；拼音转汉字和标点连续输入正确。
- 组合过程可见，工程保留上一次已提交值；上屏只增加一个撤销步骤，旧值不再写回原生文本框。
- 英文标点、故意重复的中文标点、多行插入均原样保留。
- 光标中间插入、选区替换、组合取消、组合期间 Ctrl+Enter、失焦提交正常。
- 撤销／重做、外部修改、侧栏／节点／生图提示词／配方输出和只读预览正常。
- 深浅主题沿用原有输入框外观，保存重开字符完全一致。

证据位于 `app/test-results/canvas-ime/`：`before.json` 是修复前失败记录，`desktop.json` 是修复后专项报告，`text-light.png`／`text-dark.png` 为检查过的截图。

另以最新界面运行 `app/test/generation-sizes-desktop.cjs`，37 项回归全部通过；报告 `app/test-results/image-settings/desktop.json`，日志 `app/test-results/canvas-ime/regression.log`。输入修复未破坏参数选择、MCP、隐藏画幅说明、结果详情原文和保存恢复。2 条 ResizeObserver 测量通知在静止后停止，无未捕获渲染异常。生成回归只请求本机模拟接口，不产生生图费用。

## 生效与边界

用户当前工程仍为未保存状态，未强制刷新或关闭，工程和撤销记录没有被测试改动。由于上一轮后端修改已要求完整重启，保存后重新启动开发预览，才能一并载入画幅说明与本次输入修复。

本轮以 Windows Electron 内的 Chromium 组合事件验证，尚未代替所有原生输入法操作；Mac、其他输入法与大文本持续输入仍需实机确认。

| 维度 | 评分 | 依据与待改进 |
|---|---|---|
| 功能、代码、安全 | 9.5/10 | 同事件修复前失败、修复后通过；本地草稿与工程提交分离，测试隔离用户数据 |
| UI／UX | 9.4/10 | 中文、选区、撤销、主题与保存通过；Mac 等原生输入法待验 |
| 性能 | 9.4/10 | 组合期间减少工程提交，日常输入无异常；长文本／大画布压力待验 |
| 美术 | N/A | 没有新增或调整视觉资产 |

参考：[Chromium 输入协议](https://chromedevtools.github.io/devtools-protocol/tot/Input/)、[Ant Design Input／TextArea](https://ant.design/components/input/)。实际控件行为同时对照已安装依赖源码核验。
