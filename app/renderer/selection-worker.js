import { selectColor, growAlpha, combineAlpha } from "../core/selection.cjs";
import { mapSelection } from "../core/selection-map.cjs";
self.onmessage = ({ data }) => {
  try {
    const { width, height } = data;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > 100000000
    )
      throw new Error("选区超出一亿像素范围");
    let alpha = data.mapping ? mapSelection(data) : data.rgba
      ? selectColor(
          data.rgba,
          width,
          height,
          data.x,
          data.y,
          data.tolerance,
          data.contiguous,
        )
      : growAlpha(data.alpha, width, height, data.radius);
    if (data.rgba || data.base) alpha = combineAlpha(data.base, alpha, data.operation);
    self.postMessage({ alpha }, [alpha.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
