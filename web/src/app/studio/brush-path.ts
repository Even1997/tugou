export type BrushPoint = { x: number; y: number };
// Compositor's screen-space pulled string: jitter inside the slack radius
// never reaches the stroke. The caller divides screen pixels by viewport zoom.
export function smoothPoint(anchor: BrushPoint, pointer: BrushPoint, radius: number): BrushPoint | undefined {
    const distance = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
    if (!radius) return pointer;
    if (distance <= radius) return undefined;
    const t = (distance - radius) / distance;
    return { x: anchor.x + (pointer.x - anchor.x) * t, y: anchor.y + (pointer.y - anchor.y) * t };
}
