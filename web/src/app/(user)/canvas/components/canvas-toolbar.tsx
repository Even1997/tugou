import { useState } from "react";
import { Button, Dropdown, Popover, Segmented, Switch } from "antd";
import { Ellipsis, Eraser, FolderOpen, Globe2, Hand, Image as ImageIcon, Layers3, Library, MousePointer2, Music2, Palette, Redo2, Settings2, Trash2, Type, Undo2, Upload, Video } from "lucide-react";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { IconButton } from "@/app/studio/ui";

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddPanorama,
    onAddDirector,
    onAddConfig,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onCanvasToolChange,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onOpenAssetLibrary,
    onOpenMyAssets,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddPanorama: () => void;
    onAddDirector: () => void;
    onAddConfig: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onOpenAssetLibrary: () => void;
    onOpenMyAssets?: () => void;
}) {

    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const moreItems = [
        { key: "config", label: "生成配置", icon: <Settings2 size={16} />, onClick: onAddConfig },
        { key: "video", label: "视频", icon: <Video size={16} />, onClick: onAddVideo },
        { key: "audio", label: "音频", icon: <Music2 size={16} />, onClick: onAddAudio },
        { key: "panorama", label: "全景图", icon: <Globe2 size={16} />, onClick: onAddPanorama },
        { key: "director", label: "导演台", icon: <Layers3 size={16} />, onClick: onAddDirector },
        ...(onOpenMyAssets ? [{ key: "assets", label: "我的素材", icon: <FolderOpen size={16} />, onClick: onOpenMyAssets }] : []),
        { type: "divider" as const },
        { key: "appearance", label: "画布外观", icon: <Palette size={16} />, onClick: () => setAppearanceOpen(true) },
        { key: "clear", label: "清空画布", danger: true, icon: <Eraser size={16} />, onClick: onClear },
    ];
    return (
        <div className="pointer-events-none absolute inset-x-4 bottom-5 z-50 flex justify-center" data-canvas-no-zoom>
            <div role="toolbar" aria-label="画布工具" className="pointer-events-auto flex max-w-full items-center gap-1 rounded-lg border p-1.5"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                onPointerDown={(event) => event.stopPropagation()}>
                <IconButton label={canvasTool === "select" ? "选择" : "移动"} aria-pressed
                    style={{ background: theme.toolbar.activeBg, color: theme.accent }}
                    onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")}>
                    {canvasTool === "select" ? <MousePointer2 size={16} /> : <Hand size={16} />}
                </IconButton>
                <IconButton label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></IconButton>
                <IconButton label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></IconButton>
                <span className="mx-1 h-5 w-px" style={{ background: theme.node.stroke }} />
                <Button type="text" icon={<Type size={16} />} onClick={onAddText}>文本</Button>
                <Button type="text" icon={<ImageIcon size={16} />} onClick={onAddImage}>图片</Button>
                <IconButton label="导入素材" onClick={onUpload}><Upload size={16} /></IconButton>
                <Button type="text" icon={<Library size={16} />} onClick={onOpenAssetLibrary}>素材库</Button>
                {selectedCount > 0 && <IconButton label="删除选中" danger onClick={onDelete}><Trash2 size={16} /></IconButton>}
                <Popover title="画布外观" open={appearanceOpen} onOpenChange={setAppearanceOpen} placement="topRight" trigger={[]}
                    content={<div className="flex w-56 flex-col gap-4 py-1">
                        <Segmented block aria-label="主题" value={colorTheme} onChange={setTheme} options={[{ label: "浅色", value: "light" }, { label: "深色", value: "dark" }]} />
                        <Segmented block aria-label="网格" value={backgroundMode} onChange={onBackgroundModeChange} options={[{ label: "点", value: "dots" }, { label: "线", value: "lines" }, { label: "空白", value: "blank" }]} />
                        <label className="flex items-center justify-between text-sm">图片信息<Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} /></label>
                        <Button size="small" type="text" onClick={() => setAppearanceOpen(false)}>完成</Button>
                    </div>}>
                    <Dropdown menu={{ items: moreItems }} trigger={["click"]} placement="topRight">
                        <Button type="text" icon={<Ellipsis size={18} />} aria-label="更多画布工具" />
                    </Dropdown>
                </Popover>
            </div>
        </div>
    );
}
