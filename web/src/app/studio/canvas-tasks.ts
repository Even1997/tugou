import type { CanvasNodeData } from "../(user)/canvas/types";

// Imported images also have status=success; only generation nodes are tasks.
export function isCanvasTask(node: Pick<CanvasNodeData, "metadata">) {
    const m = node.metadata;
    if (!m?.status || m.status === "idle") return false;
    return m.status === "loading" || m.status === "stopping" || Boolean(
        m.startedAt || m.clientTaskId || m.imageTaskId || m.videoTaskId || m.audioTaskId || m.generationPrompt
    );
}
