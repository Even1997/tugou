---
name: 土狗 · 自由创作工作台
description: 清晰、克制、自由的桌面创作界面
colors:
  clear-blue: "#1765d1"
  clear-blue-dark: "#8bb9ff"
  mist-bg: "#fafbfc"
  mist-panel: "#ffffff"
  mist-shell: "#f5f5f7"
  mist-surface: "#f5f6f8"
  mist-line: "#e0e3e9"
  mist-input-line: "#d2d7e0"
  mist-text: "#202631"
  mist-muted: "#626c7c"
  mist-selection: "#eaf2ff"
  graphite-bg: "#15171c"
  graphite-panel: "#20232b"
  graphite-shell: "#1b1d23"
  graphite-surface: "#252932"
  graphite-line: "#363b46"
  graphite-text: "#edf0f6"
  graphite-muted: "#a5afbf"
  graphite-selection: "#243752"
  graphite-primary-text: "#101e32"
  success-light: "#247354"
  success-dark: "#6ed4ae"
  danger-light: "#b93845"
  danger-dark: "#ff9b9b"
typography:
  body:
    fontFamily: '-apple-system, "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "13px"
  section-title:
    fontSize: "13px"
    fontWeight: 500
  label:
    fontSize: "12px"
rounded:
  icon: "6px"
  control: "8px"
  card: "10px"
  home-card: "12px"
spacing:
  field-gap: "8px"
  panel-padding: "16px"
  modal-padding: "24px"
components:
  button-primary:
    backgroundColor: "{colors.clear-blue}"
    textColor: "{colors.mist-panel}"
    rounded: "{rounded.control}"
    height: "34px"
  button-primary-dark:
    backgroundColor: "{colors.clear-blue-dark}"
    textColor: "{colors.graphite-primary-text}"
    rounded: "{rounded.control}"
    height: "34px"
  input:
    backgroundColor: "{colors.mist-panel}"
    textColor: "{colors.mist-text}"
    rounded: "{rounded.control}"
    height: "34px"
  workspace-navigation:
    width: "56px"
    height: "52px"
    rounded: "{rounded.control}"
  editor-tool:
    width: "36px"
    height: "36px"
---

# Design System: 土狗

## Overview

**Creative North Star: "自由创作工作台"**

清晰、克制、自由。界面围绕用户当前选择的工具提供操作与反馈，允许各模块独立使用，不用固定流程组织全部功能。画布与作品是视觉主体，操作界面提供稳定、紧凑的桌面工作空间。

本规范提取当前 Electron 源码的现有体系，并记录用户确认的描述与约束；不是重设计稿，也不是全部界面已达标的声明。颜色与控件来源为 `app/renderer/ui.css`、`components.jsx`；编辑器布局来源为 `composite-workspace.css`、`presentations.css`。

**Key Characteristics:**
- 清晰：名称、状态、选中对象与操作结果可辨认。
- 克制：蓝色用于操作和状态，层次主要依靠底色与边框。
- 自由：各模块独立进入，保留手动操作与 MCP 能力。

## Colors

清晰蓝是交互强调色；雾白与石墨灰分别承载浅色和深色工作环境。前文 tokens 是提取值，产品代码仍是运行时来源；本文件不会自动替换 CSS。

`clear-blue` / `clear-blue-dark` 对应 `--accent`；`mist-*` / `graphite-*` 按后缀映射背景、面板、外壳、次级表面、分隔线、文字与选中底色。成功与危险色只表达对应状态；深色主按钮使用专用深文字色。

**The Context Rule.** 工作区颜色通过所在主题与组件上下文解析，不把作品的填充、描边或页面背景当作界面主题色。

首页新建按钮与深色图层编辑器沿用全局主题。搜索占位文字使用对应主题的 muted 色，避免额外降低透明度。浅色 Ant Design 输入边框与普通分隔线仍分别使用各自 token。

## Typography

沿用系统中英文字体栈，不引入展示字体。正文基准与普通分组标题均为 13px，常规标签为 12px；现有编辑器还有 10–11px 辅助文字，应在可读性评审中逐项核验，不把小字扩散为新界面默认。

层级依靠位置、分组、字重与留白共同表达。长名称需要可读取的完整文本；不能仅靠截断后的缩写区分操作。

## Layout

全局顶栏 56px；模块导航容器 72px，导航按钮 56×52px。全局侧面板基础宽度 248px，普通面板内距 16px。它们与编辑器内部工具栏是不同层级。

图层内部工具竖栏 48px、按钮 36×36px，顶部操作行 36px；画布右边依次为属性列与图层／历史列。宽窗口属性列 280px、右列 296px；1150px 以下使用 260px、220px。PPT 设计模式保留页面缩略列，画布左侧设 48px 工具竖栏，右边为属性列和原页面／图层列；属性列与右列在宽窗口为 260px、232px，在 1150px 以下为 240px、200px。

图层编辑器默认只保留最右侧图层／历史列，调整和导航在该列上方。点图层名称或画布只选中；点缩略图、双击名称或点“属性”才在图层列左侧展开对应属性，点关闭可释放这一列。点击绘制／蒙版等工具也可展开对应参数；切换画板保留用户当前的属性展开状态。PPT 仍通过顶部“图层”按钮折叠／展开最右列，属性列保留。图层对象属性集中在属性列，“绘制选项”仅设置后续绘制；PPT 数值显示保留两位小数，未编辑不回写舍入值。

这些是当前实现尺寸，不是所有窗口都适用的验收结论。窄窗口、系统缩放与长文本必须验证画布可用面积、控件边界和独立滚动；不把桌面编辑器缩成手机界面，也不由此声称支持触摸。

## Elevation & Depth

用户确认：平面分层，紧凑但清楚，弹窗才用阴影。常驻导航、工具栏和属性面板使用底色与边框；按钮不增加投影。临时弹窗及弹出菜单可以用阴影表达覆盖关系。

首页、设置常驻卡片及 PPT 卡片、缩略图、编辑页已去除装饰阴影。焦点与选中指示仍需可见；作品自身的阴影效果由内容参数决定。

## Shapes

现有主要控件圆角 8px，图标块及部分编辑器控件 6px，PPT 卡片常见 10px、首页卡片 12px。避免为了统一而改动作品自身的圆角；作品参数与界面形状是两个系统。

## Components

复用现有 Ant Design 包装组件、Lucide 图标和主题入口。主按钮承担当前明确操作，普通按钮保持低视觉重量；图标按钮保留可访问名称、提示和选中态。输入沿用 34px 常规高度，编辑器紧凑控件属于局部变体。

键盘焦点以 2px 强调色描边表达；活动导航以强调文字与选中底色表达，不只依赖悬停。Ant Design 全局 motion 为 false；现有自定义动画还需单独遵循减少动态效果设置。侧车中的按钮、输入、导航、标签、卡片示例用于展示现有语言，不替代真实组件的行为测试。

## Do's and Don'ts

### Do:
- **Do** 使用当前主题变量与已有组件入口。
- **Do** 让工具、属性和内容各有清楚的位置与选中反馈。
- **Do** 同时检查深浅主题、键盘焦点和窄窗口。

### Don't:
- **Don't** 把任一模块的任务顺序推广成所有用户的核心流程。
- **Don't** 给常驻工具栏和面板新增装饰阴影。
- **Don't** 将本次规范初始化描述成界面改版、打包完成或全部问题已修复。
