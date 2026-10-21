import type { Asset } from "./model";

export type GenerationInput = {
    id: string; projectId: string; name: string; prompt: string; size: string; references: string[];
    recipeId?: string; fingerprint?: string; sourceNodeId?: string; canvasProjectId?: string;
    quality?: string; responseFormatB64Json?: boolean; instruction?: string; selectionMask?: string;
    operation?: { kind: "enhance" | "upscale" | "edit" | "outpaint" | "segment"; sourceId: string; sourceWidth: number; sourceHeight: number; width: number; height: number; left: number; top: number };
};
export type GenerationJob = GenerationInput & {
    baseUrl: string; model: string; createdAt: string; finishedAt?: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "review";
    error?: string; result?: Asset; rawResult?: Asset; resolution?: "fit";
};
