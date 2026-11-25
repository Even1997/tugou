import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormDialog, Icon } from "./components.jsx";
import "./command-palette.css";

const isMac = window.tugou?.platform === "darwin";
const modKey = isMac ? "⌘" : "Ctrl";

const shortcutSections = [
  {
    title: "全局与导航",
    rows: [
      ["打开全局命令面板", [modKey, "K"]],
      ["查看快捷键速查", ["Shift", "?"]],
      ["保存当前工程", [modKey, "S"]],
      ["撤销 / 重做", [modKey, "Z"]],
      ["剪贴板截图直贴", [modKey, "V"]],
    ],
  },
  {
    title: "无限画布",
    rows: [
      ["平移画布", ["滚轮 / 双指"]],
      ["缩放画布", [modKey, "滚轮 / 捏合"]],
      ["原地复制节点", ["Alt", "拖动节点"]],
      ["快速生成（提示词框内）", [modKey, "Enter"]],
      ["删除选中节点或连线", [isMac ? "⌫" : "Delete"]],
    ],
  },
  {
    title: "图层与素材库",
    rows: [
      ["移动 / 抓手工具", ["V", "H"]],
      ["画笔 / 橡皮擦", ["B", "E"]],
      ["复制 / 编组图层", [modKey, "J / G"]],
      ["素材库方向键切换", ["↑ ↓ ← →"]],
      ["素材库快速看图", ["Space"]],
    ],
  },
  {
    title: "PPT 演示",
    rows: [
      ["缩放画板", [modKey, "滚轮"]],
      ["复制选中元素", [modKey, "D"]],
      ["全屏演示翻页", ["←", "→"]],
      ["退出全屏演示", ["Esc"]],
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

const WORKSPACES = [
  ["home", "首页", "home", "home shouye 概览"],
  ["prompts", "提示词工作台", "prompts", "prompts tishici 配方 模块"],
  ["canvas", "无限画布", "canvas", "canvas huabu 节点 生成"],
  ["layers", "图层编辑器", "layers", "layers tuceng 画板 修图"],
  ["ppt", "PPT 演示", "ppt", "ppt slides 演示文稿"],
  ["tools", "图像工具", "tools", "tools gongju 裁剪 抠图 超分"],
  ["assets", "素材库", "assets", "assets sucai 图片"],
  ["fonts", "字体", "fonts", "fonts ziti"],
  ["settings", "设置", "settings", "settings shezhi 偏好 快捷键"],
];

export function CommandPalette({
  close,
  workspace,
  setWorkspace,
  projects = [],
  record,
  openProject,
  createProject,
  save,
  dirty,
  openConnection,
  openTasks,
  openBrandKit,
  openShortcuts,
  toggleTheme,
  showDetails,
  addToCanvas,
  addToLayers,
  addToPpt,
  pinAsset,
  openRecipe,
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    const doc = record?.document;

    for (const [id, title, icon, keywords] of WORKSPACES) {
      out.push({
        id: `ws-${id}`,
        group: "工作区",
        icon,
        title: `前往 ${title}`,
        subtitle: workspace === id ? "当前所在" : "切换工作区",
        keywords: `${title} ${keywords}`,
        run: () => setWorkspace(id),
      });
    }

    const actions = [
      dirty && record
        ? { id: "act-save", icon: "save", title: "保存当前工程", subtitle: `${modKey}+S`, keywords: "save baocun", run: save }
        : null,
      record
        ? { id: "act-brand", icon: "style", title: "打开工程视觉规范 / 配色板", subtitle: "Brand Kit · 色板与字体", keywords: "brand color palette 色板 配色 视觉规范", run: openBrandKit }
        : null,
      { id: "act-theme", icon: "sun", title: "切换浅色 / 深色主题", subtitle: "外观主题", keywords: "theme dark light zhuti 主题 深色 浅色", run: toggleTheme },
      { id: "act-new", icon: "add", title: "新建工程", subtitle: "创建空白创作工程", keywords: "new create xinjian", run: createProject },
      { id: "act-models", icon: "model", title: "模型连接与 API 配置", subtitle: "管理生图 / 文本模型", keywords: "model api key 模型", run: openConnection },
      { id: "act-tasks", icon: "tasks", title: "查看任务队列", subtitle: "生图与批处理进度", keywords: "task renwu 任务", run: openTasks },
      { id: "act-keys", icon: "info", title: "查看快捷键速查", subtitle: "Shift+?", keywords: "shortcut hotkey kuaijiejian 快捷键", run: openShortcuts },
    ].filter(Boolean);

    for (const a of actions) out.push({ ...a, group: "快捷操作" });

    for (const p of projects) {
      if (p.error || p.id === record?.id) continue;
      out.push({
        id: `proj-${p.id}`,
        group: "切换工程",
        icon: "open",
        title: p.name,
        subtitle: p.canvasNodeCount !== undefined ? `画布 ${p.canvasNodeCount} 节点` : "打开工程",
        keywords: `${p.name} project gongcheng 工程`,
        run: () => openProject(p.id),
      });
    }

    if (doc?.recipes?.length) {
      for (const r of doc.recipes) {
        out.push({
          id: `recipe-${r.id}`,
          group: "提示词配方",
          icon: "prompts",
          title: r.name,
          subtitle: "在提示词工作台打开",
          keywords: `${r.name} recipe peifang 配方`,
          run: () => openRecipe(r.id),
        });
      }
    }

    if (doc?.assets?.length) {
      const assets = doc.assets.slice().reverse().slice(0, q ? 80 : 12);
      for (const a of assets) {
        const isImg = !a.kind || a.kind === "image";
        out.push({
          id: `asset-view-${a.id}`,
          group: "素材",
          icon: (a.rating || 0) > 0 ? "star" : "assets",
          title: a.name || "未命名素材",
          subtitle: isImg ? `${a.width} × ${a.height}${(a.rating || 0) > 0 ? ` · ${a.rating}星` : ""} · 预览原图` : a.kind,
          keywords: `${a.name || ""} asset sucai 素材 ${(a.rating || 0) > 0 ? `star 星标 ${a.rating}星` : ""}`,
          run: () => showDetails(a.id),
          extra: isImg
            ? [
                { label: "画布", run: () => addToCanvas("asset", a.id) },
                { label: "图层", run: () => addToLayers(a) },
                { label: "PPT", run: () => addToPpt(a) },
                { label: "钉住", run: () => pinAsset(a.id) },
              ]
            : null,
        });
      }
    }

    if (!q) return out.slice(0, 28);
    const terms = q.split(/\s+/).filter(Boolean);
    return out
      .filter((entry) => {
        const hay = `${entry.title} ${entry.subtitle || ""} ${entry.keywords || ""}`.toLowerCase();
        return terms.every((term) => hay.includes(term));
      })
      .slice(0, 32);
  }, [query, workspace, projects, record, dirty]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const execute = (fn) => {
    close();
    fn?.();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(items[activeIndex]?.run);
    }
  };

  let lastGroup = "";
  return (
    <div
      className="command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="全局命令面板"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="command-palette" onKeyDown={onKeyDown}>
        <div className="command-palette-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工作区、工程、素材、配方或快捷命令…"
            aria-label="搜索命令"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-list" ref={listRef} role="listbox">
          {items.length ? (
            items.map((entry, idx) => {
              const showGroup = entry.group !== lastGroup;
              lastGroup = entry.group;
              return (
                <React.Fragment key={entry.id}>
                  {showGroup && <div className="command-palette-group">{entry.group}</div>}
                  <div
                    role="option"
                    aria-selected={idx === activeIndex}
                    data-cmd-index={idx}
                    className={`command-palette-item${idx === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => execute(entry.run)}
                  >
                    <Icon name={entry.icon} />
                    <span className="command-palette-title">{entry.title}</span>
                    {entry.extra ? (
                      <span className="command-palette-extras" onClick={(e) => e.stopPropagation()}>
                        {entry.extra.map((act) => (
                          <button key={act.label} type="button" onClick={() => execute(act.run)}>
                            {act.label}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <small className="command-palette-sub">{entry.subtitle}</small>
                    )}
                  </div>
                </React.Fragment>
              );
            })
          ) : (
            <p className="command-palette-empty">没有匹配的命令或素材</p>
          )}
        </div>
        <footer className="command-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>{modKey}</kbd><kbd>K</kbd> 随时唤起</span>
        </footer>
      </div>
    </div>
  );
}
