import { useEffect, useRef } from "react";
import { originalUrl } from "./image-processing.js";

export function extractClipboardImages(event) {
  return Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export async function storeClipboardImages(files) {
  const assets = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bytes = new Uint8Array(await file.arrayBuffer());
    const label =
      file.name && file.name !== "image.png"
        ? file.name.replace(/\.[^.]+$/, "")
        : `剪贴板图片${files.length > 1 ? ` ${i + 1}` : ""}`;
    assets.push(await window.tugou.storeRaster(bytes, label));
  }
  return assets;
}

export async function copyAssetImage(asset) {
  if (!asset) throw new Error("没有可复制的图片");
  const url = originalUrl(asset);
  const response = await fetch(url);
  if (!response.ok) throw new Error("读取图片失败");
  const sourceBlob = await response.blob();
  let pngBlob = sourceBlob;
  if (sourceBlob.type !== "image/png") {
    const bitmap = await createImageBitmap(sourceBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    pngBlob = await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("编码图片失败"))), "image/png"),
    );
  }
  if (typeof window.tugou?.copyImage === "function") {
    await window.tugou.copyImage(new Uint8Array(await pngBlob.arrayBuffer()));
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

export function useClipboardImagePaste(onImport, onError, disabled = false) {
  const latest = useRef({ onImport, onError, disabled });
  const active = useRef(false);
  latest.current = { onImport, onError, disabled };

  useEffect(() => {
    let mounted = true;
    const onPaste = (event) => {
      if (
        active.current ||
        latest.current.disabled ||
        event.target?.closest?.('input,textarea,select,[contenteditable]') ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }
      const files = extractClipboardImages(event);
      if (!files.length) return;
      event.preventDefault();
      active.current = true;
      storeClipboardImages(files)
        .then((assets) => {
          if (mounted && assets.length && !latest.current.disabled) latest.current.onImport(assets);
        })
        .catch((error) => {
          if (mounted) latest.current.onError?.(error.message);
        })
        .finally(() => {
          active.current = false;
        });
    };
    window.addEventListener("paste", onPaste);
    return () => {
      mounted = false;
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
