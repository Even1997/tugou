const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { atomicWrite, safePath } = require('./storage.cjs');
const pLimit = require('p-limit').default;

// A persisted running task is never resubmitted automatically after restart.
class TaskQueue {
  constructor(root) { this.root = root; this.tasks = []; this.controllers = new Map(); this.completions = new Map(); this.pending = Promise.resolve(); this.execution = Promise.resolve(); this.serial = Promise.resolve(); this.images = pLimit(require('./preference-values.cjs').defaults.imageConcurrency); }
  setImageConcurrency(value) { this.images.concurrency = value; }
  async init() {
    this.file = await safePath(this.root, 'tasks.json');
    try { this.tasks = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(this.tasks)) throw new Error('任务记录损坏');
    for (const task of this.tasks) if (['queued', 'running'].includes(task.status)) {
      task.status = 'interrupted'; task.message = ['local-tool','runtime-install'].includes(task.context?.kind) ? '上次本地处理已中断，请手动重试' : '上次运行中断；请核对供应商结果后手动重试';
    }
    await this.persist();
  }
  persist() {
    const bytes = JSON.stringify(this.tasks);
    const next = this.pending.then(() => atomicWrite(this.file, bytes));
    this.pending = next.catch(() => {});
    return next;
  }
  list() { return structuredClone(this.tasks); }
  async start(label, execute, context = {}) {
    const task = { id: randomUUID(), label, status: 'queued', createdAt: new Date().toISOString(), context };
    const controller = new AbortController();
    this.tasks.push(task);
    this.controllers.set(task.id, controller);
    try { await this.persist(); } catch (error) { this.controllers.delete(task.id); task.status = 'failed'; throw error; }
    const executeTask = async () => {
      try {
        if (controller.signal.aborted) return;
        task.status = 'running'; task.startedAt = new Date().toISOString();
        await this.persist();
        if (controller.signal.aborted) return;
        const result = await execute(controller.signal, task.id);
        if (controller.signal.aborted) return;
        // Only opaque result IDs are persisted; prompts/credentials/provider responses stay outside this journal.
        task.resultId = typeof result === 'string' ? result : undefined;
        task.status = result?.review === true ? 'review' : 'completed';
      } catch (error) {
        if (!controller.signal.aborted) { task.status = 'failed'; task.message = error.safeMessage || '任务失败，请检查连接或输入后重试'; }
      } finally {
        this.controllers.delete(task.id);
        task.finishedAt = new Date().toISOString();
        await this.persist();
      }
    };
    const image = (context.kind === 'workflow' && context.mode === 'image') || ['generation','angle'].includes(context.kind);
    const completion = image ? this.images(executeTask) : this.serial.then(executeTask);
    const settled = completion.catch(() => {});
    if (!image) this.serial = settled;
    this.execution = Promise.all([this.execution, settled]).then(() => {});
    this.completions.set(task.id, settled);
    settled.then(() => this.completions.delete(task.id));
    return { id: task.id, completion };
  }
  async cancel(id) {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    const task = this.tasks.find((item) => item.id === id);
    task.status = 'cancelled'; task.message = task.context?.kind === 'runtime-install' ? '已取消安装，已下载内容保留' : task.context?.kind === 'local-tool' ? '已取消本地处理' : '本地已取消；已提交的供应商请求仍可能计费';
    controller.abort();
    await this.persist();
    return true;
  }
  async shutdown() {
    const local = this.tasks.filter(t => t.startedAt && this.controllers.has(t.id) && ['local-tool','cloud-tool','runtime-install'].includes(t.context?.kind)).map(t => this.completions.get(t.id));
    for (const [id, controller] of this.controllers) {
      const task = this.tasks.find((item) => item.id === id);
      if (['queued','running'].includes(task.status)) task.status = 'interrupted';
      controller.abort();
    }
    await this.persist();
    await Promise.all(local);
  }
}
module.exports = { TaskQueue };
