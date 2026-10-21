const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  session,
} = require("electron");
const { spawn } = require("node:child_process");
const { readFile, writeFile, mkdir, rename } = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");

app.setName("CanvasStudio");
let server, backend, window, origin, dataDir, credentialsFile;
const freePort = () =>
  new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox("图构 Studio 启动失败", error.message);
      app.quit();
    });
}
async function readCredentials() {
  try {
    const stored = JSON.parse(
      safeStorage.decryptString(await readFile(credentialsFile)),
    );
    return Object.fromEntries(
      ["baseUrl", "apiKey", "model", "analysisModel", "backendAdminPassword"]
        .filter((key) => typeof stored[key] === "string")
        .map((key) => [key, stored[key]]),
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(
      "无法解密连接配置。请保留 credentials.enc 备份后移开此文件，再重新配置连接。",
    );
  }
}
async function start() {
  dataDir =
    process.env.STUDIO_DATA_DIR ||
    path.join(app.getPath("userData"), "projects");
  credentialsFile = path.join(app.getPath("userData"), "credentials.enc");
  await mkdir(dataDir, { recursive: true });
  const credentials = await readCredentials();
  if (!credentials.backendAdminPassword) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统加密存储不可用");
    credentials.backendAdminPassword = randomBytes(24).toString("base64url");
    await writeFile(
      credentialsFile,
      safeStorage.encryptString(JSON.stringify(credentials)),
    );
  }
  const externalDevUrl = process.env.STUDIO_DEV_URL;
  if (externalDevUrl) {
    const url = new URL(externalDevUrl);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
      throw new Error("开发服务器仅允许 127.0.0.1");
    origin = url.origin;
  } else {
    // Stable origin preserves the upstream canvas's IndexedDB across desktop restarts.
    const port = Number(process.env.STUDIO_PORT) || 3418;
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.on("error", () =>
        reject(
          new Error(`本地端口 ${port} 已被占用，请关闭之前的图构进程后重试`),
        ),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
    const backendPort = await freePort();
    const backendExe = app.isPackaged
      ? path.join(process.resourcesPath, "bin", "canvas-server.exe")
      : path.join(__dirname, "bin", "canvas-server.exe");
    backend = spawn(backendExe, [], {
      cwd: path.dirname(dataDir),
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PORT: String(backendPort),
        BIND_HOST: "127.0.0.1",
        DATABASE_DSN: path.join(path.dirname(dataDir), "canvas.db"),
        ADMIN_PASSWORD: credentials.backendAdminPassword,
        GIN_MODE: "release",
      },
    });
    let backendError = "";
    backend.on("error", (e) => {
      backendError = e.message;
    });
    const backendStart = Date.now();
    while (true) {
      if (backendError || backend.exitCode !== null)
        throw new Error(backendError || "画布后端启动失败");
      try {
        const r = await fetch(`http://127.0.0.1:${backendPort}/api/settings`);
        if (r.ok) break;
      } catch {}
      if (Date.now() - backendStart > 30000)
        throw new Error("画布后端启动超时");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    origin = `http://127.0.0.1:${port}`;
    const root = app.isPackaged
      ? path.join(process.resourcesPath, "web")
      : path.resolve(__dirname, "../web/.next/standalone");
    const entry = path.join(root, "server.js");
    server = spawn(process.execPath, [entry], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        API_BASE_URL: `http://127.0.0.1:${backendPort}`,
        STUDIO_DATA_DIR: dataDir,
        STUDIO_CONFIG: JSON.stringify(credentials),
      },
    });
    let failed = "";
    server.on("error", (e) => {
      failed = e.message;
    });
    server.stderr.on("data", (buffer) => {
      const message = buffer.toString();
      if (!message.includes("apiKey") && !message.includes("Bearer"))
        console.error(message.slice(0, 500));
    });
    const started = Date.now();
    while (true) {
      if (failed || server.exitCode !== null)
        throw new Error(failed || "本地服务启动失败，请重新构建桌面资源");
      try {
        const r = await fetch(`${origin}/studio`);
        if (r.ok) break;
      } catch {}
      if (Date.now() - started > 60000) throw new Error("本地服务启动超时");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  const makeWindow = (url = `${origin}/studio`) => {
    const win = new BrowserWindow({
      width: 1500,
      height: 980,
      minWidth: 960,
      minHeight: 680,
      title: "图构 Studio",
      frame: new URL(url).pathname !== "/studio",
      backgroundColor: "#15171d",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const sendWindowState = () => {
      if (!win.webContents.isDestroyed())
        win.webContents.send("studio:window-state", { maximized: win.isMaximized() });
    };
    win.on("maximize", sendWindowState);
    win.on("unmaximize", sendWindowState);
    win.webContents.setWindowOpenHandler(({ url }) => {
      const target = new URL(url);
      if (target.origin === origin) makeWindow(url);
      else if (target.protocol === "https:") void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) {
        event.preventDefault();
        if (new URL(url).protocol === "https:") void shell.openExternal(url);
      }
    });
    win.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        buttons: ["继续编辑", "仍然关闭"],
        defaultId: 0,
        cancelId: 0,
        title: "还有未完成的保存或生成",
        message: "关闭可能丢失尚未保存的修改。已提交的模型 API 请求可能继续计费。",
      });
      if (choice === 1) event.preventDefault();
    });
    void win.loadURL(url);
    return win;
  };
  const validSender = (event) => {
    if (new URL(event.senderFrame.url).origin !== origin)
      throw new Error("拒绝非本地页面请求");
  };
  const senderWindow = (event) => {
    validSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame)
      throw new Error("拒绝非主页面窗口请求");
    return win;
  };
  ipcMain.handle("studio:window-state", (event) => ({
    maximized: senderWindow(event).isMaximized(),
  }));
  ipcMain.handle("studio:window-action", (event, action) => {
    const win = senderWindow(event);
    if (action === "minimize") win.minimize();
    else if (action === "toggle-maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") {
      // Respond before closing destroys the renderer; close still runs beforeunload.
      setImmediate(() => { if (!win.isDestroyed()) win.close(); });
    } else throw new Error("不支持的窗口操作");
  });
  ipcMain.handle("studio:connection", async (event, update) => {
    validSender(event);
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统加密存储不可用，密钥未写入磁盘");
    const allowed = ["baseUrl", "apiKey", "model", "analysisModel"];
    const current = await readCredentials();
    for (const key of allowed)
      if (typeof update[key] === "string") current[key] = update[key];
    await writeFile(
      `${credentialsFile}.tmp`,
      safeStorage.encryptString(JSON.stringify(current)),
    );
    await rename(`${credentialsFile}.tmp`, credentialsFile);
  });
  ipcMain.handle("studio:open-folder", (event) => {
    validSender(event);
    return shell.openPath(dataDir);
  });
  session.defaultSession.on("will-download", (_event, item, webContents) => {
    item.setSaveDialogOptions({
      title: "保存创作文件",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });
  window = makeWindow();
}
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  server?.kill();
  backend?.kill();
});
