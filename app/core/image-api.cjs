const failure = (message) =>
  Object.assign(new Error(message), { safeMessage: message });
async function boundedBytes(response, limit) {
  if (Number(response.headers.get("content-length")) > limit)
    throw failure("模型返回的数据过大，未入库");
  const parts = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw failure("模型返回的数据过大，未入库");
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}
function imageExtension(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw failure("模型没有返回有效的 PNG、JPEG 或 WebP 图片");
}
function outputPrompt({ prompt, size }) {
  if (!size || size === "auto") return prompt;
  const [width, height] = size.split("x").map(Number);
  let a = width, b = height;
  while (b) [a, b] = [b, a % b];
  const orientation = width === height ? "方形" : width > height ? "横版" : "竖版";
  // Add only on the wire so saved prompts and explicit retries keep the user text.
  return `${prompt}\n\n输出画幅要求（仅用于构图，不要在图中绘制这些文字）：采用 ${width / a}:${height / a} ${orientation}构图，目标输出尺寸为 ${width} × ${height} 像素。`;
}
async function requestImages(settings, request, signal) {
  require('./image-settings.cjs').validateImageSettings(settings.model,request);
  const prompt = outputPrompt(request);
  const refs = request.images || [];
  const endpoint =
    settings.baseUrl.replace(/\/$/, "") +
    (settings.baseUrl.endsWith("/v1") ? "" : "/v1") +
    (refs.length ? "/images/edits" : "/images/generations");
  let body,
    headers = { Authorization: `Bearer ${settings.apiKey}` };
  if (refs.length) {
    body = new FormData();
    body.set("model", settings.model);
    body.set("prompt", prompt);
    body.set("size", request.size);
    body.set("n", String(request.count||1));
    if(request.quality&&request.quality!=='auto')body.set('quality',request.quality);
    refs.forEach((bytes, i) => {
      const ext = imageExtension(bytes);
      body.append(
        "image[]",
        new Blob([bytes], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }),
        `reference-${i + 1}.${ext}`,
      );
    });
    if (request.mask)
      body.set(
        "mask",
        new Blob([request.mask], { type: "image/png" }),
        "mask.png",
      );
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      model: settings.model,
      prompt,
      size: request.size,
      n: request.count||1,
      ...(request.quality&&request.quality!=='auto'?{quality:request.quality}:{}),
    });
  }
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw failure("模型连接失败，请检查 API 地址和网络");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(
      `模型请求失败（HTTP ${response.status}），请检查模型、权限或参数；不会自动重试`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(
      (await boundedBytes(response, 96 * 1024 * 1024)).toString("utf8"),
    );
  } catch (error) {
    throw error.safeMessage
      ? error
      : failure("模型响应格式不支持，需要 Images API");
  }
  if (!Array.isArray(payload.data) || !payload.data.length)
    throw failure("模型响应没有图片，未创建空素材");
  const images = [];
  for (const result of payload.data) {
    signal.throwIfAborted();
    let bytes;
    if (typeof result.b64_json === "string")
      bytes = Buffer.from(result.b64_json, "base64");
    else if (typeof result.url === "string") {
      const url = new URL(result.url),
        base = new URL(settings.baseUrl);
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            url.origin === base.origin &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          ))
      )
        throw failure("结果图片地址不安全");
      const download = await fetch(url, { signal, redirect: "error" });
      if (!download.ok)
        throw failure(`结果下载失败（HTTP ${download.status}）`);
      bytes = await boundedBytes(download, 64 * 1024 * 1024);
    } else throw failure("模型返回了不支持的图片格式");
    images.push(bytes);
  }
  return images;
}
module.exports = { boundedBytes, imageExtension, requestImages };
