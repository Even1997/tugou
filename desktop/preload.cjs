const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studioDesktop", {
  version: "0.1.0",
  saveConnection: (settings) =>
    ipcRenderer.invoke("studio:connection", settings),
  openFolder: () => ipcRenderer.invoke("studio:open-folder"),
  windowAction: (action) => ipcRenderer.invoke("studio:window-action", action),
  windowState: () => ipcRenderer.invoke("studio:window-state"),
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("studio:window-state", listener);
    return () => ipcRenderer.removeListener("studio:window-state", listener);
  },
});
