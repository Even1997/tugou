const { WebContentsView, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

// A detached, sandboxed renderer owns Canvas/Worker lifetime independently of the editor page.
function createRasterRunner(buildDirectory) {
  return async (job, signal, onPart, onProgress) => {
    signal.throwIfAborted();
    const channel = `tugou:raster:${randomUUID()}`;
    const file = path.join(buildDirectory, "tool-host.html"),
      url = pathToFileURL(file).href;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "raster-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        additionalArguments: [`--tugou-raster-channel=${channel}`],
      },
    });
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    let cancel, timer, partWork;
    try {
      await new Promise((resolve, reject) => {
        let ended = false,
          partPending = false;
        const finish = (error) => {
          if (ended) return;
          ended = true;
          error ? reject(error) : resolve();
        };
        cancel = () => finish(new DOMException("已取消", "AbortError"));
        signal.addEventListener("abort", cancel, { once: true });
        contents.once("render-process-gone", () =>
          finish(new Error("图像计算进程已中断，请重试")),
        );
        contents.once("destroyed", () =>
          finish(new Error("图像计算页面已关闭")),
        );
        timer = setTimeout(
          () => finish(new Error("图像处理超时，请调整输入后重试")),
          1800000,
        );
        ipcMain.handle(channel, async (event, type, payload) => {
          if (
            ended ||
            event.sender !== contents ||
            event.senderFrame !== contents.mainFrame ||
            event.senderFrame.url !== url
          )
            throw Error("无效的图像计算请求");
          try {
            signal.throwIfAborted();
            if (type === "ready") return job;
            if (type === "progress") {
              onProgress(payload);
              return true;
            }
            if (type === "part") {
              if (partPending) throw Error("结果写入顺序无效");
              partPending = true;
              try {
                partWork = Promise.resolve().then(() => onPart(payload));
                await partWork;
                signal.throwIfAborted();
              } finally {
                partPending = false;
              }
              return true;
            }
            if (type === "done") {
              if (partPending) throw Error("结果尚未写入完成");
              setImmediate(() => finish());
              return true;
            }
            if (type === "error")
              throw Error(
                typeof payload === "string"
                  ? payload.slice(0, 500)
                  : "图像处理失败",
              );
            throw Error("图像计算消息无效");
          } catch (error) {
            finish(error);
            return false;
          }
        });
        if (signal.aborted) cancel();
        else contents.loadFile(file).catch(finish);
      });
    } finally {
      clearTimeout(timer);
      if (cancel) signal.removeEventListener("abort", cancel);
      ipcMain.removeHandler(channel);
      if (!contents.isDestroyed())
        contents.close({ waitForBeforeUnload: false });
      await partWork?.catch(() => {});
    }
  };
}
module.exports = { createRasterRunner };
