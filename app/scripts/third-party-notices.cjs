const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function writeNotices(output = 'dist', bundledInputs = []) {
  const packages = require('../package-lock.json').packages;
  const sections = [];
  for (const font of require('../core/builtin-fonts.cjs').builtinFonts) sections.push(`${font.family} / ${font.name} ${font.version} (weights: ${require('../core/font-weights.cjs').fontFaces(font).map(f=>f.weight).join(', ')})\n${font.source}\n`+await fs.readFile(path.join('assets/fonts',font.licenseFile),'utf8'));
  for (const [folder, metadata] of Object.entries(packages)) {
    if (!folder || (metadata.dev && !bundledInputs.some(input=>input.startsWith(folder+'/')))) continue;
    let entries;
    try { entries = await fs.readdir(folder); }
    catch (error) { if (error.code === 'ENOENT' && metadata.optional) continue; throw error; }
    const files = entries.filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const texts = [];
    for (const file of files) if ((await fs.stat(path.join(folder,file))).isFile()) texts.push(await fs.readFile(path.join(folder,file),'utf8'));
    if (!texts.length && folder === 'node_modules/@ant-design/icons-svg') texts.push(await fs.readFile('node_modules/@ant-design/icons/LICENSE','utf8'));
    if (!texts.length && folder === 'node_modules/lazy-val') texts.push(await fs.readFile('scripts/licenses/lazy-val.txt','utf8'));
    // libvips binary packages publish their component licensing in README.md.
    if (folder.startsWith('node_modules/@img/sharp-libvips-')) {
      const readme = await fs.readFile(path.join(folder,'README.md'),'utf8');
      const start = readme.indexOf('## Licensing');
      if (start < 0) throw new Error(`依赖缺少组件许可声明：${folder}`);
      texts.push(readme.slice(start));
    }
    if (!texts.length && folder === 'node_modules/is-mobile') {
      const readme = await fs.readFile(path.join(folder,'README.md'),'utf8');
      if (readme.includes('## License')) texts.push(readme.slice(readme.indexOf('## License')));
    }
    if (!texts.length) throw new Error(`依赖缺少许可证正文：${folder}`);
    sections.push(`${folder.replace(/^node_modules\//,'')} ${metadata.version}\n${texts.join('\n')}`);
  }
  await fs.writeFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),sections.join('\n\n--------------------\n\n'));
};
