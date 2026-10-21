import { type Asset, uid, now, validateProject, type StudioProject } from "./model";
import { validImageSize, MAX_IMAGE_DATA_URL } from "./image-limits.js";

export async function studioRequest<T>(action: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
    return result as T;
}
export async function readAsset(file: File | Blob, name: string): Promise<Asset> {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_IMAGE_DATA_URL * 0.75) throw new Error("请选择不超过 150 MB 的 PNG、JPEG 或 WebP");
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
    });
    const image = await loadImage(dataUrl);
    if (!validImageSize(image.width, image.height)) throw new Error("图片超过 1 亿像素或 30000 像素边长");
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = Math.min(128, image.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let hasAlpha = false;
    if (file.type !== "image/jpeg")
        for (let y = 0; y < image.height && !hasAlpha; y += canvas.height) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, -y);
            const pixels = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, image.height - y)).data;
            for (let i = 3; i < pixels.length; i += 4)
                if (pixels[i] < 255) {
                    hasAlpha = true;
                    break;
                }
        }
    canvas.width = canvas.height = 0;
    const stored = await studioRequest<{ dataUrl: string }>("resource-store", { dataUrl });
    return { id: uid(), name, dataUrl: stored.dataUrl, width: image.width, height: image.height, hasAlpha, createdAt: now() };
}
export function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片无法解码"));
        image.src = url;
    });
}
export function exportProject(project: StudioProject) {
    validateProject(project);
    return studioRequest<{ path: string }>("export-project", project);
}
