const sharp = require("sharp");
const os = require("node:os");
const { cloudSettings, coverage, maskValue } = require("./cloud-settings.cjs");
sharp.cache(false);
sharp.concurrency(1);
const inputOptions = {
  limitInputPixels: 100000000,
  failOn: "warning",
  sequentialRead: true,
};
async function decode(bytes) {
  const meta = await sharp(bytes, inputOptions).metadata();
  if ((meta.pages || 1) !== 1) throw Error("请使用静态图片");
  const result = await sharp(bytes, inputOptions)
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (result.info.channels !== 4) throw Error("图片通道无效");
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
  };
}
const encode = (image) =>
  sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
function memory(source, size, hasMask = false) {
  if (
    os.freemem() <
    512 * 1024 * 1024 +
      source.width * source.height * (hasMask ? 13 : 8) +
      size.width * size.height * 12
  )
    throw Error("本地合成可用内存不足，请关闭占用内存的应用后重试");
}
function copyRows(source, target, left, top) {
  for (let y = 0; y < source.height; y++)
    source.data.copy(
      target.data,
      ((y + top) * target.width + left) * 4,
      y * source.width * 4,
      (y + 1) * source.width * 4,
    );
}
async function editMask(bytes, source, settings) {
  if (settings.operation !== "cloudEdit" || settings.maskMode !== "asset")
    return null;
  if (!bytes) throw Error("蒙版资源缺失");
  const mask = await decode(bytes);
  if (mask.width !== source.width || mask.height !== source.height)
    throw Error("蒙版必须与原图尺寸一致，不会自动拉伸");
  const alpha = new Uint8Array(mask.width * mask.height);
  let any = false;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = maskValue(
      mask.data,
      i * 4,
      settings.maskChannel,
      settings.invertMask,
    );
    any ||= alpha[i] > 0;
  }
  if (!any) throw Error("蒙版没有可修改区域，未请求模型");
  return alpha;
}
async function prepare(bytes, options, maskBytes) {
  const meta = await sharp(bytes, inputOptions).metadata();
  const orientation = meta.orientation || 1;
  const sourceSize =
    orientation >= 5
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
  const { settings: s, size } = cloudSettings(options, sourceSize);
  memory(sourceSize, size, s.maskMode === "asset");
  const source = await decode(bytes),
    canonical = await encode(source),
    alpha = await editMask(maskBytes, source, s);
  let image = canonical,
    mask;
  if (s.operation === "cloudEdit" || s.operation === "cloudExtend") {
    const frame = {
      width: size.width,
      height: size.height,
      data: Buffer.alloc(size.width * size.height * 4),
    };
    if (s.operation === "cloudExtend") {
      copyRows(source, frame, s.left, s.top);
      image = await encode(frame);
      frame.data.fill(0);
    }
    for (let y = 0; y < frame.height; y++)
      for (let x = 0; x < frame.width; x++) {
        const protect =
          s.operation === "cloudEdit"
            ? 1 -
              (alpha ? alpha[y * source.width + x] / 255 : coverage(x, y, s))
            : Number(
                x >= s.left &&
                  x < s.left + source.width &&
                  y >= s.top &&
                  y < s.top + source.height,
              );
        frame.data[(y * frame.width + x) * 4 + 3] = Math.round(protect * 255);
      }
    mask = await encode(frame);
  }
  return {
    image,
    mask,
    canonical,
    sourceSize: { width: source.width, height: source.height },
    size,
    settings: s,
  };
}
async function finish(
  sourceBytes,
  generatedBytes,
  options,
  fit = false,
  maskBytes,
) {
  const meta = await sharp(sourceBytes, inputOptions).metadata(),
    { settings: s, size } = cloudSettings(options, meta);
  const actual = await sharp(generatedBytes, inputOptions).metadata();
  memory(meta, size, s.maskMode === "asset");
  if (actual.width !== size.width || actual.height !== size.height) {
    if (
      !fit ||
      actual.width < size.width ||
      actual.height < size.height ||
      actual.width * size.height !== actual.height * size.width
    )
      throw Error(
        `模型返回 ${actual.width}×${actual.height}，请求 ${size.width}×${size.height}；原始图已保留`,
      );
    generatedBytes = await sharp(generatedBytes, inputOptions)
      .resize(size.width, size.height, {
        kernel: "lanczos3",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  }
  const source = await decode(sourceBytes),
    result = await decode(generatedBytes),
    alpha = await editMask(maskBytes, source, s);
  if (result.width !== size.width || result.height !== size.height)
    throw Error("返回图方向或尺寸不符，原始图已保留");
  if (s.operation === "cloudSplit") {
    let low = 255,
      high = 0;
    for (let i = 0; i < result.data.length; i += 4) {
      const r = result.data[i],
        g = result.data[i + 1],
        b = result.data[i + 2];
      if (
        result.data[i + 3] !== 255 ||
        Math.max(r, g, b) - Math.min(r, g, b) > 2
      )
        throw Error("类别蒙版必须是不透明黑白灰图；模型原始返回已保留");
      low = Math.min(low, r);
      high = Math.max(high, r);
    }
    if (low > 16 || high < 239)
      throw Error("类别蒙版缺少明确的主体或背景，未提取素材");
    for (let i = 0; i < result.data.length; i += 4) {
      const alpha = Math.round((source.data[i + 3] * result.data[i]) / 255);
      source.data.copy(result.data, i, i, i + 4);
      result.data[i + 3] = alpha;
    }
  } else if (s.operation === "cloudExtend")
    copyRows(source, result, s.left, s.top);
  else if (s.operation === "cloudEdit") {
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++) {
        const c = alpha ? alpha[y * source.width + x] / 255 : coverage(x, y, s),
          i = (y * source.width + x) * 4;
        if (c === 0) source.data.copy(result.data, i, i, i + 4);
        else if (c < 1) {
          const a = source.data[i + 3] * (1 - c) + result.data[i + 3] * c;
          for (let k = 0; k < 3; k++)
            result.data[i + k] = a
              ? Math.round(
                  (source.data[i + k] * source.data[i + 3] * (1 - c) +
                    result.data[i + k] * result.data[i + 3] * c) /
                    a,
                )
              : source.data[i + k];
          result.data[i + 3] = Math.round(a);
        }
      }
  } else {
    const alpha = await sharp(source.data, {
      raw: { width: source.width, height: source.height, channels: 4 },
    })
      .extractChannel(3)
      .resize(size.width, size.height, { kernel: "lanczos3" })
      .raw()
      .toBuffer();
    if (alpha.length !== size.width * size.height)
      throw Error("透明通道尺寸异常");
    for (let i = 0; i < alpha.length; i++) result.data[i * 4 + 3] = alpha[i];
  }
  return encode(result);
}
module.exports = { prepare, finish, decode, encode };
