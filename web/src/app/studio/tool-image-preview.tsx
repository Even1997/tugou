"use client";
import { useState } from "react";
import { Segmented } from "antd";

export function ToolImagePreview({ src, alt }: { src: string; alt: string }) {
    const [background, setBackground] = useState("checker"), [zoom, setZoom] = useState("fit");
    return <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented aria-label="预览底色" size="small" value={background} onChange={setBackground} options={[{ label: "透明底", value: "checker" }, { label: "白底", value: "white" }, { label: "黑底", value: "black" }]} />
            <Segmented aria-label="预览比例" size="small" value={zoom} onChange={setZoom} options={[{ label: "适应", value: "fit" }, { label: "100%", value: "actual" }]} />
        </div>
        <div className={`${background === "checker" ? "checker" : ""} min-h-0 flex-1 overflow-auto rounded-lg`} style={background !== "checker" ? { background } : undefined}>
            <div className={`flex min-h-full min-w-full items-center justify-center ${zoom === "fit" ? "h-full p-4" : "w-max"}`}>
                <img src={src} alt={alt} className={zoom === "fit" ? "h-full w-full object-contain" : "max-w-none shrink-0"} />
            </div>
        </div>
    </div>;
}
