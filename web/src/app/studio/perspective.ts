export type Quad = [number, number, number, number, number, number, number, number];
export const identityQuad: Quad = [0, 0, 1, 0, 1, 1, 0, 1];

export function validateQuad(quad: number[]): asserts quad is Quad {
    if (quad.length !== 8 || quad.some((n) => !Number.isFinite(n) || n < -2 || n > 3)) throw new Error("四角位置必须在 -200% 至 300% 之间");
    const cross = Array.from({ length: 4 }, (_, i) => {
        const a = i * 2,
            b = (a + 2) % 8,
            c = (a + 4) % 8;
        return (quad[b] - quad[a]) * (quad[c + 1] - quad[b + 1]) - (quad[b + 1] - quad[a + 1]) * (quad[c] - quad[b]);
    });
    if (cross.some((n) => Math.abs(n) < 0.00001) || !cross.every((n) => Math.sign(n) === Math.sign(cross[0]))) throw new Error("四角不能交叉或折叠，请保持凸四边形");
}

/** Inverse projective mapping: destination quad -> source unit square. */
export function inverseHomography(quad: Quad) {
    validateQuad(quad);
    const rows: number[][] = [];
    for (let i = 0; i < 8; i += 2) {
        const x = quad[i],
            y = quad[i + 1],
            u = identityQuad[i],
            v = identityQuad[i + 1];
        rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let column = 0; column < 8; column++) {
        let pivot = column;
        for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error("四角变形过于扁平");
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        const divisor = rows[column][column];
        for (let c = column; c <= 8; c++) rows[column][c] /= divisor;
        for (let row = 0; row < 8; row++)
            if (row !== column) {
                const factor = rows[row][column];
                for (let c = column; c <= 8; c++) rows[row][c] -= factor * rows[column][c];
            }
    }
    return [...rows.map((row) => row[8]), 1];
}
export function projectPoint(matrix: number[], x: number, y: number) {
    const w = matrix[6] * x + matrix[7] * y + matrix[8];
    return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / w, y: (matrix[3] * x + matrix[4] * y + matrix[5]) / w };
}
export function homography(quad: Quad) {
    const [a, b, c, d, e, f, g, h, i] = inverseHomography(quad);
    return [e*i-f*h, c*h-b*i, b*f-c*e, f*g-d*i, a*i-c*g, c*d-a*f, d*h-e*g, b*g-a*h, a*e-b*d];
}
export function quadBounds(quad: Quad, width: number, height: number) {
    const xs = [quad[0], quad[2], quad[4], quad[6]].map((x) => x * width),
        ys = [quad[1], quad[3], quad[5], quad[7]].map((y) => y * height);
    const x = Math.floor(Math.min(...xs)),
        y = Math.floor(Math.min(...ys));
    return { x, y, width: Math.max(1, Math.ceil(Math.max(...xs)) - x), height: Math.max(1, Math.ceil(Math.max(...ys)) - y) };
}
/** Bilinear sampling in premultiplied alpha avoids dark halos on transparent cutouts. */
export function warpPixels(source: Uint8ClampedArray, width: number, height: number, quad: Quad, target: Uint8ClampedArray) {
    const matrix = inverseHomography(quad),
        bounds = quadBounds(quad, width, height);
    if (target.length !== bounds.width * bounds.height * 4) throw new Error("变形输出尺寸不匹配");
    const direction = Math.sign((quad[2] - quad[0]) * (quad[5] - quad[3]) - (quad[3] - quad[1]) * (quad[4] - quad[2]));
    const edges = [0, 2, 4, 6].map((i) => {
        const next = (i + 2) % 8,
            x = quad[i] * width,
            y = quad[i + 1] * height,
            dx = quad[next] * width - x,
            dy = quad[next + 1] * height - y,
            length = Math.hypot(dx, dy);
        return [(-dy / length) * direction, (dx / length) * direction, ((dy * x - dx * y) / length) * direction];
    });
    for (let y = 0; y < bounds.height; y++)
        for (let x = 0; x < bounds.width; x++) {
            const px = x + bounds.x + 0.5,
                py = y + bounds.y + 0.5;
            let coverage = 1;
            for (const edge of edges) coverage = Math.min(coverage, Math.max(0, edge[0] * px + edge[1] * py + edge[2] + 0.5));
            if (!coverage) continue;
            const uv = projectPoint(matrix, px / width, py / height);
            const sx = Math.max(0, Math.min(width - 1, uv.x * width - 0.5)),
                sy = Math.max(0, Math.min(height - 1, uv.y * height - 0.5));
            const left = Math.floor(sx),
                top = Math.floor(sy),
                right = Math.min(width - 1, left + 1),
                bottom = Math.min(height - 1, top + 1);
            const fx = sx - left,
                fy = sy - top;
            const indices = [(top * width + left) * 4, (top * width + right) * 4, (bottom * width + left) * 4, (bottom * width + right) * 4];
            const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
            let alpha = 0,
                red = 0,
                green = 0,
                blue = 0;
            for (let i = 0; i < 4; i++) {
                const index = indices[i],
                    weight = weights[i] * source[index + 3];
                alpha += weight;
                red += source[index] * weight;
                green += source[index + 1] * weight;
                blue += source[index + 2] * weight;
            }
            const offset = (y * bounds.width + x) * 4;
            if (alpha) {
                target[offset] = red / alpha;
                target[offset + 1] = green / alpha;
                target[offset + 2] = blue / alpha;
                target[offset + 3] = alpha * coverage;
            }
        }
}
