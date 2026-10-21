"use client";
import { useEffect, useState } from "react";
import { Button, Input, Popover, Tag } from "antd";
import { Settings2 } from "lucide-react";
import { studioRequest } from "./client-api";

export type LocalToolCapability = { upscale: boolean; cutout: boolean; cutoutDetail?: boolean; runtime: string; error: string };
export function LocalToolSettings({ capability, onSaved }: { capability?: LocalToolCapability; onSaved: (value: LocalToolCapability) => void }) {
    const [runtime, setRuntime] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    useEffect(() => { if (capability?.runtime) setRuntime(capability.runtime); }, [capability?.runtime]);
    return <Popover trigger="click" placement="bottomRight" title="本地图片组件" content={<div className="studio-ui flex w-80 flex-col gap-3">
        <div><Tag color={capability?.upscale ? "success" : "default"}>超分 {capability?.upscale ? "已安装" : "未安装"}</Tag><Tag color={capability?.cutout ? "success" : "default"}>抠图 {capability?.cutout ? "已安装" : "未安装"}</Tag></div>
        <label className="flex flex-col gap-2 text-xs">超分程序与模型目录<Input aria-label="本地模型目录" value={runtime} onChange={e => setRuntime(e.target.value)} placeholder="D:\\CanvasStudioRuntime\\realesrgan-20220424" /></label>
        <p className="text-xs text-[var(--studio-muted)]">首次安装运行桌面包中的 setup-image-tools.ps1；加 -IncludeDetailCutout 安装精细识别。图片处理在本机完成。</p>
        {error && <p role="alert" className="text-xs text-[var(--studio-danger)]">{error}</p>}
        <Button loading={busy} onClick={async () => { setBusy(true); setError(""); try { onSaved(await studioRequest<LocalToolCapability>("tool-configure", { runtime })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>检查并保存</Button>
    </div>}><Button type="text" icon={<Settings2 size={16} />} aria-label="本地图片组件" /></Popover>;
}
