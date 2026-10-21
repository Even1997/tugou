import type { StudioProject } from "./model";
import { renderProject } from "./editor-renderer";
import { encodeCanvas } from "./raster-paint";
import { studioRequest } from "./client-api";
import { samplingMargin } from "./tone-render";

/** Full-resolution export with bounded browser surfaces, including feather overlap. */
export async function exportImageStrips(project: StudioProject, format: string, progress: (percent: number) => void, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { id } = await studioRequest<{ id: string }>("export-start", { width: project.width, height: project.height, name: project.name, format });
    const cancel = () => { void studioRequest("export-cancel", { id }).catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    const tones = project.layers.some(l => l.adjustment || l.effects?.some(e => e.enabled));
    const halo = tones ? samplingMargin(project) : 0;
    const rows = Math.max(1, Math.min(512, Math.floor(4_000_000 / (project.width + halo * 2)) - halo * 2));
    const bleed = tones ? 0 : Math.ceil(Math.max(0, ...project.layers.map((l) => l.mask?.feather || 0)) * 3 + 8);
    try {
        signal?.throwIfAborted();
        for (let y = 0; y < project.height; y += rows) {
            signal?.throwIfAborted();
            const height = Math.min(rows, project.height - y),
                top = Math.max(0, y - bleed),
                bottom = Math.min(project.height, y + height + bleed);
            let canvas: HTMLCanvasElement | undefined, strip: OffscreenCanvas | undefined;
            try {
                canvas = await renderProject(project, { region: { x: 0, y: top, width: project.width, height: bottom - top } });
                signal?.throwIfAborted();
                strip = new OffscreenCanvas(project.width, height);
                strip.getContext("2d")!.drawImage(canvas, 0, top - y);
                canvas.width = canvas.height = 0;
                const dataUrl = await encodeCanvas(strip);
                signal?.throwIfAborted();
                await studioRequest("export-stripe", { id, y, dataUrl });
                progress(Math.round(((y + height) / project.height) * 95));
            } finally {
                if (canvas) canvas.width = canvas.height = 0;
                if (strip) strip.width = strip.height = 0;
            }
        }
        signal?.throwIfAborted();
        return await studioRequest<{ path: string }>("export-finish", { id });
    } catch (error) {
        await studioRequest("export-cancel", { id }).catch(() => {});
        signal?.throwIfAborted();
        throw error;
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}
