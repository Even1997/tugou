import { useEffect, useRef, useState } from "react";

export const hasImageFiles = (event) =>
  event.dataTransfer?.types.includes("Files");
export function useImageImport(onImport, onError, disabled = false) {
  const latest = useRef({ onImport, onError, disabled }),
    mounted = useRef(true),
    active = useRef(false);
  latest.current = { onImport, onError, disabled };
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const perform = async (files, point) => {
    if (active.current || latest.current.disabled) return;
    active.current = true;
    setImporting(true);
    try {
      const assets = await (files
        ? window.tugou.importDroppedImages(files)
        : window.tugou.importImage());
      if (mounted.current && !latest.current.disabled && assets.length)
        latest.current.onImport(assets, point);
    } catch (e) {
      if (mounted.current) latest.current.onError(e.message);
    } finally {
      active.current = false;
      if (mounted.current) setImporting(false);
    }
  };
  return {
    importing,
    open: () => perform(),
    openAt: (point) => perform(undefined, point),
    drop: (event, point) => {
      event.preventDefault();
      event.stopPropagation();
      return perform(Array.from(event.dataTransfer.files), point);
    },
    over: (event) => {
      if (hasImageFiles(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect =
          disabled || active.current ? "none" : "copy";
      }
    },
  };
}
