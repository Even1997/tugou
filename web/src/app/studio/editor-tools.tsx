"use client";
import { Dropdown } from "antd";
import { Type, Shapes, AlignHorizontalJustifyCenter, FlipHorizontal2, FolderPlus } from "lucide-react";
import { useStudio } from "./store";
import { createLayer } from "./model";
import { alignLayers, groupLayers, isLayerLocked } from "./layer-operations";

export function CreationTools({ notify }: { notify: (message: string) => void }) {
    const add = (kind: "text" | "rect" | "ellipse" | "line") => {
        const { project: p, edit, select } = useStudio.getState();
        if (p.layers.length >= 500) return notify("工程最多支持 500 个图层");
        const layer =
            kind === "text"
                ? { ...createLayer("text", "新文字"), text: "在这里输入文字", x: p.width * 0.15, y: p.height * 0.15, width: p.width * 0.7, height: 100, fontSize: 40, color: "#45604b" }
                : {
                      ...createLayer("shape", { rect: "矩形", ellipse: "椭圆", line: "直线" }[kind]),
                      shape: kind,
                      x: p.width / 4,
                      y: p.height / 4,
                      width: p.width / 3,
                      height: kind === "line" ? 1 : p.width / 4,
                      color: "#8aab80",
                      strokeWidth: kind === "line" ? 4 : 0,
                  };
        edit((p) => ({ ...p, layers: [...p.layers, layer] }));
        select([layer.id]);
    };
    return (
        <>
            <button aria-label="添加文字" title="添加文字" onClick={() => add("text")}>
                <Type size={17} />
                <span className="tool-label">文字</span>
            </button>
            <Dropdown
                trigger={["click"]}
                menu={{
                    items: [
                        { key: "rect", label: "矩形" },
                        { key: "ellipse", label: "椭圆" },
                        { key: "line", label: "直线" },
                    ],
                    onClick: ({ key }) => add(key as "rect" | "ellipse" | "line"),
                }}
            >
                <button aria-label="添加形状" title="添加形状">
                    <Shapes size={17} />
                    <span className="tool-label">形状</span>
                </button>
            </Dropdown>
        </>
    );
}

export function ObjectTools({ notify, editMask }: { notify: (message: string) => void; editMask: () => void }) {
    const p = useStudio((s) => s.project),
        ids = useStudio((s) => s.selected),
        edit = useStudio((s) => s.edit);
    const layer = ids.length === 1 ? p.layers.find((l) => l.id === ids[0]) : undefined;
    const disabled =
        !ids.length ||
        ids.some((id) => {
            const l = p.layers.find((l) => l.id === id);
            return l && isLayerLocked(l, p.layers);
        });
    const run = (operation: () => void) => {
        try {
            operation();
        } catch (e) {
            notify((e as Error).message);
        }
    };
    return (
        <div className="editor-controls object-tools" aria-label="对象工具">
            <div>
                <span className="context-name">{ids.length > 1 ? `已选 ${ids.length} 个图层` : layer?.name || "选择与移动"}</span>
                <span className="divider" />
                <button disabled={disabled || !layer} onClick={editMask} aria-label="编辑图层蒙版">蒙版</button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: (["left", "center", "right", "top", "middle", "bottom", "horizontal", "vertical"] as const).map((key, i) => ({
                            key,
                            label: ["左对齐", "水平居中", "右对齐", "顶对齐", "垂直居中", "底对齐", "水平等距", "垂直等距"][i],
                            disabled: i > 5 && ids.length < 3,
                        })),
                        onClick: ({ key }) => run(() => edit((p) => alignLayers(p, ids, key as Parameters<typeof alignLayers>[2]))),
                    }}
                >
                    <button disabled={disabled}>
                        <AlignHorizontalJustifyCenter size={16} />
                        对齐
                    </button>
                </Dropdown>
                <button
                    disabled={disabled || ids.length < 2}
                    onClick={() =>
                        run(() => {
                            const g = createLayer("group", "新分组");
                            edit((p) => groupLayers(p, ids, g));
                            useStudio.getState().select([g.id]);
                        })
                    }
                >
                    <FolderPlus size={16} />
                    分组
                </button>
                <button disabled={disabled || !layer} onClick={() => layer && edit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, flipX: !l.flipX } : l)) }))}>
                    <FlipHorizontal2 size={16} />
                    翻转
                </button>
            </div>
            <span className="context-dimensions">
                {p.width.toLocaleString()} × {p.height.toLocaleString()} px
            </span>
        </div>
    );
}
