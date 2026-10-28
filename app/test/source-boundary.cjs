const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
const files = ['main.cjs', 'desktop-main.cjs', 'preload.cjs', 'build.cjs', ...walk(path.join(root, 'core')), ...walk(path.join(root, 'renderer'))].map((file) => path.resolve(root, file)).filter((file) => /\.(cjs|jsx|js)$/.test(file));
const imports = [];
for (const file of files) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:require\(['"]([^'"]+)['"]\)|from ['"]([^'"]+)['"])/g)) {
    const reference = match[1] || match[2];
    if (reference.startsWith('.')) assert.ok(path.resolve(path.dirname(file), reference).startsWith(root + path.sep), 'Import escapes app');
    else assert.ok(reference.startsWith('node:') || ['electron', 'react', 'react-dom', 'react-dom/client', 'esbuild', '@xyflow/react', 'antd', '@ant-design/icons', 'sharp', 'yauzl', 'tar'].includes(reference), `Unexpected package: ${reference}`);
    imports.push({ file: path.relative(root, file), reference });
  }
}
const licenses = Object.entries(require('../package-lock.json').packages).filter(([name]) => name).map(([name, value]) => ({ name: name.replace('node_modules/', ''), license: value.license || 'missing' }));
assert.ok(licenses.every((entry) => entry.license !== 'missing'));
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/source-boundary.json'), JSON.stringify({ filesChecked: files.length, imports, licenses, limitations: 'Literal import and package metadata check; not a legal authorship determination or Electron binary license audit.' }, null, 2));
console.log(`Independent boundary: ${files.length} files; ${licenses.length} lockfile package license entries checked`);
