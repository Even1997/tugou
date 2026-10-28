const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {launchHelper}=require('./launch-helper.cjs');
const { safePath, atomicWrite } = require('./storage.cjs');

// safeStorage uses the profile's OS-protected key. A temporary Electron profile
// lets the platform API decrypt it without opening or modifying the old profile.
async function decryptLegacyConnection(_bytes, source) {
  if(process.platform!=='win32')throw new Error('旧版 Windows 密钥只能在原 Windows 账户导入；请在本机模型连接重新配置，工程和素材可跨平台迁移。');
  const localState = await safePath(path.dirname(source), 'Local State');
  const state = JSON.parse(await fs.readFile(localState, 'utf8'));
  if (!state.os_crypt?.encrypted_key) throw new Error('旧版连接缺少同目录的系统密钥信息（Local State）');
  const tempRoot=await fs.realpath(os.tmpdir());
  const temporary = await fs.mkdtemp(path.join(tempRoot, 'tugou-key-import-'));
  try {
    await atomicWrite(path.join(temporary, 'Local State'), JSON.stringify({ os_crypt: state.os_crypt }));
    return await new Promise((resolve, reject) => {
      const child=launchHelper('--tugou-key-reader',[temporary,source]);
      let result, failure;
      const timeout = setTimeout(() => { failure = new Error('旧版连接读取超时，原配置未修改'); child.kill(); }, 15000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('message', (message) => {
        if (message?.ok === true && typeof message.value === 'string') result = message.value;
        else failure = new Error('无法读取旧版连接，请确认使用原 Windows 账户和完整配置目录');
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (failure || code !== 0 || result === undefined) reject(failure || new Error('旧版连接迁移失败，原配置未修改'));
        else resolve(result);
      });
    });
  } finally {
    if (path.dirname(temporary) !== tempRoot || !path.basename(temporary).startsWith('tugou-key-import-')) throw new Error('迁移临时路径异常');
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
module.exports = { decryptLegacyConnection };
