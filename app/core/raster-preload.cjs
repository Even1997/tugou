const { contextBridge, ipcRenderer } = require("electron");
const channel = process.argv
  .find((arg) => arg.startsWith("--tugou-raster-channel="))
  ?.slice("--tugou-raster-channel=".length);
if (!/^tugou:raster:[a-f0-9-]{36}$/.test(channel || ""))
  throw Error("缺少图像计算通道");
contextBridge.exposeInMainWorld("toolHost", {
  send: (type, payload) => ipcRenderer.invoke(channel, type, payload),
});
