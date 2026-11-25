import React from "react";
import { FormDialog } from "./components.jsx";
import "./command-palette.css";

const isMac = window.tugou?.platform === "darwin";
const modKey = isMac ? "⌘" : "Ctrl";

const shortcutSections = [
  {
    title: "全局与导航",
    rows: [
      ["查看快捷键速查", ["Shift", "?"]],
      ["保存当前工程", [modKey, "S"]],
      ["撤销", [modKey, "Z"]],
      ["重做", [modKey, "Shift", "Z"]],
    ],
  },
  {
    title: "无限画布",
    rows: [
      ["平移画布", ["滚轮 / 双指"]],
      ["缩放画布", [modKey, "滚轮 / 捏合"]],
      ["双击节点聚焦视图", ["双击节点"]],
      ["框选多个节点", ["拖动画布"]],
      ["删除选中节点或连线", [isMac ? "⌫" : "Delete"]],
    ],
  },
  {
    title: "图层编辑器",
    rows: [
      ["移动 / 抓手工具", ["V", "H"]],
      ["画笔 / 橡皮擦", ["B", "E"]],
      ["矩形选区 / 套索 / 形状", ["M", "L", "U"]],
      ["复制选中图层", [modKey, "J"]],
      ["编组 / 取消编组", [modKey, "G"]],
    ],
  },
  {
    title: "PPT 演示",
    rows: [
      ["缩放画板", [modKey, "滚轮"]],
      ["全屏演示翻页", ["←", "→"]],
      ["退出全屏演示", ["Esc"]],
      ["选中元素微调", ["方向键"]],
    ],
  },
];

export function ShortcutsDialog({ close }) {
  return (
    <FormDialog className="shortcuts-dialog" title="快捷键速查" close={close} width={680}>
      <div className="shortcuts-grid">
        {shortcutSections.map((section) => (
          <section className="shortcuts-section" key={section.title}>
            <h3>{section.title}</h3>
            <ul>
              {section.rows.map(([label, keys]) => (
                <li key={label}>
                  <span>{label}</span>
                  <span className="shortcuts-keys">
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="shortcuts-footnote">可在「设置 → 快捷键」中自定义编辑类热键。</p>
    </FormDialog>
  );
}
