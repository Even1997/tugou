"use client";

import { FileText, Image as ImageIcon, Music2, Plus, Video, X } from "lucide-react";
import { AutoComplete, Button, Popover } from "antd";
import { referenceRolePresets } from "@/app/studio/reference-roles.js";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { buildAllCanvasResourceReferences, type CanvasResourceReference } from "../utils/canvas-resource-references";
import type { CanvasConnection, CanvasNodeData } from "../types";

export type ReferenceChange = (fromNodeId: string, toNodeId: string, change: { role?: string; direction?: -1 | 1 }) => void;

export function CanvasNodeReferenceBar({ nodeId, connectedNodes, connections = [], onChange, onDisconnect, onStartSelection }: { nodeId: string; connectedNodes: CanvasNodeData[]; connections?: CanvasConnection[]; onChange?: ReferenceChange; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const references = buildAllCanvasResourceReferences(connectedNodes);
    return (
        <div className="studio-ui mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>参考内容</div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map((reference, index) => <div key={reference.id} className="shrink-0">
                    <ReferenceItem reference={reference} onRemove={() => onDisconnect?.(reference.nodeId, nodeId)} />
                    {reference.kind === "image" && onChange && <Popover trigger="click" title={`${reference.label} · 参考职责`} content={<div className="w-72 space-y-3" onPointerDown={e => e.stopPropagation()}>
                        <AutoComplete className="w-full" aria-label={`${reference.label}职责`} value={connections.find(c => c.fromNodeId === reference.nodeId && c.toNodeId === nodeId)?.referenceRole || ""} options={referenceRolePresets} placeholder="选择或输入职责" onChange={role => onChange(reference.nodeId, nodeId, { role })} />
                        <div className="flex gap-2"><Button size="small" disabled={index === 0} onClick={() => onChange(reference.nodeId, nodeId, { direction: -1 })}>前移</Button><Button size="small" disabled={index === references.length - 1} onClick={() => onChange(reference.nodeId, nodeId, { direction: 1 })}>后移</Button></div>
                    </div>}><button type="button" className="mt-1 block w-12 truncate text-[10px]" style={{ color: theme.node.muted }} aria-label={`设置${reference.label}职责`}>{reference.label}</button></Popover>}
                </div>)}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title="从画布选择参考节点" onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
        </div>
    );
}

function ReferenceItem({ reference, onRemove }: { reference: CanvasResourceReference; onRemove: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const Icon = reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Video : reference.kind === "audio" ? Music2 : FileText;
    const isMedia = reference.kind === "image" || reference.kind === "video";
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview reference={reference} />} arrow={!isMedia} destroyOnHidden={reference.kind === "video"} styles={isMedia ? { container: { padding: 0, background: "transparent", boxShadow: "none" } } : undefined}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {reference.kind === "image" && reference.previewUrl ? <img src={reference.previewUrl} alt="" className="size-full object-cover" /> : reference.kind === "video" && reference.previewUrl ? <video src={reference.previewUrl} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label="断开参考连接" title="断开参考连接" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt={reference.title} className="block max-h-52 max-w-72 rounded-lg object-contain" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="block max-h-52 max-w-72 rounded-lg" autoPlay muted playsInline preload="metadata" />;
    if (reference.kind === "audio" && reference.previewUrl) return <audio src={reference.previewUrl} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{reference.text || reference.title || "暂无内容"}</div>;
}
