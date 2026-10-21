"use client";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "./store";
import { isLayerLocked } from "./layer-operations";
import { contentAwareFill } from "./content-fill";

export function useEditorFill(notify: (text: string) => void) {
    const project = useStudio((s) => s.project),
        selected = useStudio((s) => s.selected);
    const pending = useRef<AbortController | undefined>(undefined);
    const [progress, setProgress] = useState<number>();
    const cancel = () => {
        pending.current?.abort();
        pending.current = undefined;
        setProgress(undefined);
    };
    useEffect(() => cancel, [project, selected.join()]);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (event.key === "Escape") cancel();
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, []);
    const run = async () => {
        if (pending.current) return;
        const layer = selected.length === 1 && project.layers.find((l) => l.id === selected[0]);
        if (!layer || layer.kind !== "image" || !project.selection) {
            notify("请选择图片图层并创建选区");
            return;
        }
        if (isLayerLocked(layer, project.layers)) {
            notify("请先解锁图层");
            return;
        }
        const controller = new AbortController();
        pending.current = controller;
        setProgress(0);
        try {
            const bitmap = await contentAwareFill(project, layer, controller.signal, setProgress);
            if (controller.signal.aborted || useStudio.getState().project !== project) return;
            useStudio.getState().edit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, bitmap } : l)) }));
            notify("内容感知填充完成，可一次撤销");
        } catch (error) {
            if (!controller.signal.aborted) notify((error as Error).message);
        } finally {
            if (pending.current === controller) {
                pending.current = undefined;
                setProgress(undefined);
            }
        }
    };
    return {
        run,
        cancel,
        busy: progress !== undefined,
        toolbar: progress !== undefined && (
            <div className="editor-controls" aria-label="内容感知填充进度">
                <div>
                    <span>内容感知填充</span>
                    <progress aria-label="填充进度" value={progress} max={1} style={{ width: 160, height: 6 }} />
                    <span>{Math.round(progress * 100)}%</span>
                </div>
                <button onClick={cancel}>取消填充</button>
            </div>
        ),
    };
}
