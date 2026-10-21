import { contentFillPixels } from "./content-fill-pixels";
self.onmessage = (event: MessageEvent<{ rgba: Uint8ClampedArray; coverage: Uint8Array; width: number; height: number }>) => {
    try {
        const { rgba, coverage, width, height } = event.data;
        const pixels = contentFillPixels(rgba, coverage, width, height, (progress) => self.postMessage({ progress }));
        self.postMessage({ pixels }, { transfer: [pixels.buffer] });
    } catch (error) {
        self.postMessage({ error: (error as Error).message });
    }
};
