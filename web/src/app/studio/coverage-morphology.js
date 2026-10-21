/** Square grayscale dilation/erosion, linear in pixel count; outside is transparent.
 * @param {Uint8Array} input
 * @param {number} width
 * @param {number} height
 * @param {number} amount
 */
export function growCoverage(input, width, height, amount) {
    const radius = Math.round(Math.abs(amount));
    if (!radius) return input;
    const grow = amount > 0,
        temporary = new Uint8Array(input.length),
        output = new Uint8Array(input.length);
    const pass = (source, target, length, lines, stride, lineStride) => {
        const queue = new Int32Array(length + radius * 2);
        for (let line = 0; line < lines; line++) {
            let head = 0, tail = 0;
            const value = i => i < 0 || i >= length ? 0 : source[line * lineStride + i * stride];
            for (let i = -radius; i < length + radius; i++) {
                while (head < tail && queue[head] < i - radius * 2) head++;
                while (head < tail && (grow ? value(queue[tail - 1]) <= value(i) : value(queue[tail - 1]) >= value(i))) tail--;
                queue[tail++] = i;
                const x = i - radius;
                if (x >= 0) target[line * lineStride + x * stride] = value(queue[head]);
            }
        }
    };
    pass(input, temporary, width, height, 1, width);
    pass(temporary, output, height, width, width, 1);
    return output;
}
