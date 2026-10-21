import type { StudioProject } from "./model";

export const HISTORY_LIMIT = 60;
export const HISTORY_BYTES = 256 * 1024 * 1024;
export function trimHistory(history: StudioProject[], current: StudioProject) {
    const kept: StudioProject[] = [];
    const assets = new Set(current.assets.map((a) => a.id));
    const bitmaps = (p: StudioProject) => [p.selection?.bitmap?.dataUrl, ...p.layers.flatMap((l) => [l.bitmap?.dataUrl, l.mask?.bitmap?.dataUrl])].filter((s): s is string => !!s);
    const pixels = new Set(bitmaps(current));
    let bytes = 0;
    for (const snapshot of history.slice(-HISTORY_LIMIT).reverse()) {
        // Asset strings are shared between immutable snapshots; count only historical resources.
        let added = snapshot.layers.length * 1024;
        for (const asset of snapshot.assets) if (!assets.has(asset.id)) added += asset.dataUrl.length * 2;
        for (const data of new Set(bitmaps(snapshot))) if (!pixels.has(data)) added += data.length * 2;
        if (bytes + added > HISTORY_BYTES) break;
        bytes += added;
        snapshot.assets.forEach((a) => assets.add(a.id));
        bitmaps(snapshot).forEach((data) => pixels.add(data));
        kept.unshift(snapshot);
    }
    return kept;
}
