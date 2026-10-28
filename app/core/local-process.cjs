const { spawn } = require("node:child_process");
const path = require("node:path");

// Only children created by this invocation are terminated. Never target an app by name.
function runProcess(
  file,
  args,
  { cwd, signal, onLine, timeout = 900000, env } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      pending = "",
      stopped = false,
      expired = false,
      killTimer;
    const stop = () => {
      if (stopped || child.exitCode !== null || !child.pid) return;
      stopped = true;
      if (process.platform === "win32") {
        const killer = spawn(
          path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 2000);
      }
    };
    const timer = setTimeout(() => {
      expired = true;
      stop();
    }, timeout);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (bytes) => {
      output = (output + bytes).slice(-32768);
      pending = (pending + bytes).slice(-32768);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on("data", () => {}); // Runtime diagnostics can contain local paths; never expose them in task records.
    let spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) return reject(signal.reason);
      if (expired)
        return reject(
          Object.assign(new Error("本地处理超时，已停止任务"), {
            safeMessage: "本地处理超时，已停止任务",
          }),
        );
      if (spawnError || code !== 0)
        return reject(
          Object.assign(
            new Error("本地组件运行失败，请检查模型、显卡和可用内存"),
            {
              safeMessage: "本地组件运行失败，请检查模型、显卡和可用内存",
              output,
            },
          ),
        );
      resolve(output);
    });
    if (signal?.aborted) stop();
  });
}
module.exports = { runProcess };
