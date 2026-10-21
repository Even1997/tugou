// Shared by import, document controls, painting, persistence and export.
export const MAX_IMAGE_EDGE = 30000;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_IMAGE_DATA_URL = 200_000_000;
export const MAX_PROJECT_BYTES = 512_000_000;
/** @param {number} width @param {number} height */
export function validImageSize(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_IMAGE_EDGE && height <= MAX_IMAGE_EDGE && width * height <= MAX_IMAGE_PIXELS;
}
