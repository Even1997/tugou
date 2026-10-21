export const imageTools = {
    upscale: "保真放大",
    cutout: "主体抠图",
    alpha: "透明边缘",
    mattePair: "黑白底提取透明",
    resize: "调整尺寸",
    crop: "裁切",
    tile: "图片平铺",
    enhance: "质感调整",
    lut: "LUT 调色",
    patch: "选区替换",
    texture: "选区材质",
    extract: "框选提取",
    extend: "透明扩边",
    relight: "参数打光",
    pattern: "图案排列",
    split: "素材拆分",
} as const;
export type ImageTool = keyof typeof imageTools;
export type ToolOptions = { scale?: number; model?: "general" | "illustration"; width?: number; height?: number; left?: number; top?: number; intensity?: number; feather?: number; choke?: number; matte?: "none" | "white" | "black"; lut?: string; lutName?: string;
    cutoutModel?: "standard" | "detail";
    lightType?: "linear" | "radial"; lightX?: number; lightY?: number; lightRadius?: number; angle?: number; exposure?: number; color?: string;
    pattern?: "repeat" | "mirror" | "half-drop"; gap?: number; tileScale?: number;
    splitMode?: "alpha" | "grid"; rows?: number; columns?: number; minArea?: number;
};
export type ToolOutput = { name: string; width: number; height: number; bounds: { left: number; top: number; width: number; height: number }; pixels: number; hasAlpha: boolean; bytes: number };
export type ToolJob = {
    id: string; projectId: string; sourceId: string; name: string; tool: ImageTool; options: ToolOptions;
    secondarySourceId?: string;
    outputs?: ToolOutput[];
    status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
    progress: number; createdAt: string; finishedAt?: string; error?: string; width?: number; height?: number;
};
export type ToolSubmission = Pick<ToolJob, "id" | "projectId" | "sourceId" | "name" | "tool" | "options" | "secondarySourceId"> & { dataUrl: string; secondaryDataUrl?: string };
