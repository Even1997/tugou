const pattern = /^\/api\/studio\/resource\/([a-f0-9]{64}\.(?:png|jpeg|webp))$/;
export function resourceName(url) { return typeof url === "string" ? pattern.exec(url)?.[1] : undefined; }
export function thumbnailUrl(url) { return resourceName(url) ? `${url}?thumbnail=1` : url; }
export function validImageSource(url, pngOnly = false) {
    if (typeof url !== "string") return false;
    const resource = resourceName(url);
    if (resource) return !pngOnly || resource.endsWith(".png");
    return (pngOnly ? /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/ : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/).test(url);
}
