import { processImage } from "./image-processing.js";
import { processComposition } from "./image-composition.js";
import { compositionNames } from "../core/image-composition.cjs";
const send = window.toolHost.send;
(async () => {
  const job = await send("ready");
  const signal = new AbortController().signal;
  for (let inputIndex = 0; inputIndex < job.inputs.length; inputIndex++) {
    const input = job.inputs[inputIndex];
    const progress = (value) =>
      void send(
        "progress",
        Math.floor((inputIndex * 100 + value) / job.inputs.length),
      );
    if (compositionNames[job.settings.operation]) {
      await processComposition(
        input,
        job.secondary,
        job.settings,
        signal,
        progress,
        async (part) => {
          if (!(await send("part", { ...part, inputIndex })))
            throw Error("写入结果失败");
        },
      );
    } else {
      const bytes = await processImage(input, job.settings, signal, progress);
      if (!(await send("part", { bytes, inputIndex, index: 0, count: 1 })))
        throw Error("写入结果失败");
    }
  }
  await send("done");
})().catch((error) => {
  void send("error", error.message).catch(() => {});
});
