"use client";
import { Crop } from "lucide-react";
import { MAX_IMAGE_EDGE } from "./image-limits.js";
import { useState } from "react";
import { Button, InputNumber, Modal, Radio, Space, Dropdown } from "antd";
import { useStudio } from "./store";
import { Field } from "./ui";
import { cropDocument, resizeDocument } from "./document-operations";
import { renderProject } from "./editor-renderer";
import { alphaBounds } from "./image-bounds";

export function DocumentSize({ notify, compact = false }: { notify: (text: string) => void; compact?: boolean }) {
    const p = useStudio((s) => s.project),
        edit = useStudio((s) => s.edit);
    const [open, setOpen] = useState(false),
        [mode, setMode] = useState("canvas"),
        [busy, setBusy] = useState(false);
    const [rect, setRect] = useState({ x: 0, y: 0, width: p.width, height: p.height });
    const apply = () => {
        try {
            edit((p) => (mode === "crop" ? cropDocument(p, rect) : resizeDocument(p, rect.width, rect.height, mode === "image")));
            setOpen(false);
        } catch (e) {
            notify((e as Error).message);
        }
    };
    const trim = async () => {
        setBusy(true);
        let canvas: HTMLCanvasElement | undefined;
        try {
            let left = p.width,
                top = p.height,
                right = 0,
                bottom = 0;
            const rows = Math.min(512, Math.floor(4_000_000 / p.width));
            const bleed = Math.ceil(Math.max(0, ...p.layers.map((l) => l.mask?.feather || 0)) * 3 + 8);
            for (let y = 0; y < p.height; y += rows) {
                const height = Math.min(rows, p.height - y),
                    start = Math.max(0, y - bleed);
                canvas = await renderProject(p, { transparent: true, region: { x: 0, y: start, width: p.width, height: Math.min(p.height, y + height + bleed) - start } });
                const box = alphaBounds(canvas.getContext("2d")!.getImageData(0, y - start, p.width, height).data, p.width, height);
                if (box) {
                    left = Math.min(left, box.x);
                    top = Math.min(top, y + box.y);
                    right = Math.max(right, box.x + box.width);
                    bottom = Math.max(bottom, y + box.y + box.height);
                }
                canvas.width = canvas.height = 0;
            }
            if (right <= left || bottom <= top) throw new Error("画布没有可见内容");
            if (useStudio.getState().project !== p) throw new Error("工程已变化，请重新修边");
            edit((p) => cropDocument(p, { x: left, y: top, width: Math.max(64, right - left), height: Math.max(64, bottom - top) }));
        } catch (e) {
            notify((e as Error).message);
        } finally {
            if (canvas) canvas.width = canvas.height = 0;
            setBusy(false);
        }
    };
    return (
        <div className="studio-ui">
            {compact ? (
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "size", label: "尺寸与裁剪" },
                            { key: "trim", label: busy ? "修边中…" : "透明修边", disabled: busy },
                        ],
                        onClick: ({ key }) => {
                            if (key === "trim") void trim();
                            else {
                                setRect({ x: 0, y: 0, width: p.width, height: p.height });
                                setOpen(true);
                            }
                        },
                    }}
                >
                    <Button type="text" aria-label="画布工具" title="画布尺寸与裁剪" icon={<Crop size={17} />}>
                        <span className="tool-label">画布</span>
                    </Button>
                </Dropdown>
            ) : (
                <Space wrap>
                    <Button
                        onClick={() => {
                            setRect({ x: 0, y: 0, width: p.width, height: p.height });
                            setOpen(true);
                        }}
                    >
                        尺寸与裁剪
                    </Button>
                    <Button loading={busy} onClick={trim}>
                        透明修边
                    </Button>
                </Space>
            )}
            <Modal title="尺寸与裁剪" open={open} onCancel={() => setOpen(false)} onOk={apply} okText="应用" cancelText="取消" width={430}>
                <div className="flex flex-col gap-5 py-3">
                    <Radio.Group
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                        optionType="button"
                        options={[
                            { label: "画布", value: "canvas" },
                            { label: "缩放内容", value: "image" },
                            { label: "裁剪", value: "crop" },
                        ]}
                    />
                    <div className="grid grid-cols-2 gap-4">
                        {(["x", "y", "width", "height"] as const)
                            .filter((key) => mode === "crop" || key === "width" || key === "height")
                            .map((key) => (
                                <Field key={key} label={{ x: "左侧", y: "顶部", width: "宽度", height: "高度" }[key]}>
                                    <InputNumber
                                        aria-label={`调整${key}`}
                                        value={rect[key]}
                                        precision={0}
                                        min={key === "width" || key === "height" ? 64 : -100000}
                                        max={key === "width" || key === "height" ? MAX_IMAGE_EDGE : 100000}
                                        onChange={(n) => n !== null && setRect((r) => ({ ...r, [key]: n }))}
                                        style={{ width: "100%" }}
                                    />
                                </Field>
                            ))}
                    </div>
                    <p className="text-sm text-[var(--studio-muted)]">{mode === "canvas" ? "以中心调整画布边界，内容尺寸不变。" : mode === "image" ? "图层、文字和参考线随画布一起缩放。" : "调整可见范围，范围外的图层内容仍然保留。"}</p>
                </div>
            </Modal>
        </div>
    );
}
