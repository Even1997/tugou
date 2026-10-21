// Scanline approach adapted from Compositor WandPixels.c, MIT; see THIRD-PARTY-NOTICES.md.
/** Four-connected scanline fill. The input is scratch coverage, consumed in place. */
export function connectedCoverage(coverage: Uint8Array, width: number, height: number, seed: number) {
    const result = new Uint8Array(coverage.length),
        stack = [seed];
    while (stack.length) {
        const at = stack.pop()!;
        if (!coverage[at]) continue;
        const y = Math.floor(at / width),
            row = y * width;
        let left = at,
            right = at;
        while (left > row && coverage[left - 1]) left--;
        while (right < row + width - 1 && coverage[right + 1]) right++;
        for (let i = left; i <= right; i++) {
            result[i] = coverage[i];
            coverage[i] = 0;
        }
        for (const ny of [y - 1, y + 1]) {
            if (ny < 0 || ny >= height) continue;
            let run = false;
            for (let x = left - row; x <= right - row; x++) {
                const i = ny * width + x,
                    match = !!coverage[i];
                if (match && !run) stack.push(i);
                run = match;
            }
        }
        if (stack.length > 8_000_000) throw new Error("选区边缘过于复杂，请缩小容差或分区选择");
    }
    return result;
}

export { growCoverage } from "./coverage-morphology.js";
