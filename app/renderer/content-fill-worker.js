import { contentFill } from "../core/content-fill.cjs";
self.onmessage = ({ data }) => {
  try {
    const result = contentFill(data, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage(result, [result.rgba.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
