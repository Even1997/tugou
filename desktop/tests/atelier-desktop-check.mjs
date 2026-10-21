import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const live = path.join(process.env.APPDATA, 'CanvasStudio');
const backup = process.env.STUDIO_BACKUP_DIR || 'D:/CanvasStudioBuild/rollback-before-atelier/user-data';
const post = async(action,payload) => {
    const response = await fetch('http://127.0.0.1:3418/api/studio', {method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});
    assert.equal(response.status,200); return response.json();
};
assert.deepEqual(await readFile(path.join(live,'credentials.enc')),await readFile(path.join(backup,'credentials.enc')));
const projects=[], timestampChanges=[];
for(const file of await readdir(path.join(backup,'projects'))) {
    if(!/^[\w-]+\.json$/.test(file)) continue;
    const old=JSON.parse(await readFile(path.join(backup,'projects',file),'utf8'));
    if(!old.id || !old.assets) continue;
    const current=JSON.parse(await readFile(path.join(live,'projects',file),'utf8'));
    const { updatedAt: previousTime, ...previousContent } = old, { updatedAt: currentTime, ...currentContent } = current;
    assert.ok(JSON.stringify(currentContent)===JSON.stringify(previousContent),`Project content changed: ${old.id}`);
    if(previousTime!==currentTime) timestampChanges.push({id:old.id,before:previousTime,after:currentTime});
    const opened=await post('open',{id:old.id});
    assert.equal(opened.assets.length,old.assets.length); assert.deepEqual(opened.layers,old.layers);
    const lazy=await post('open',{id:old.id,lazy:true});
    assert.ok(lazy.assets.every(a=>/^\/api\/studio\/resource\/[a-f0-9]{64}\.(png|jpeg|webp)$/.test(a.dataUrl)));
    if(lazy.assets.length) assert.equal((await fetch('http://127.0.0.1:3418'+lazy.assets[0].dataUrl+'?thumbnail=1')).status,200);
    projects.push(old.id);
}
let resources=0;
for(const file of await readdir(path.join(backup,'projects/resources'),{recursive:true,withFileTypes:true})) {
    if(!file.isFile()) continue;
    const relative=path.relative(path.join(backup,'projects/resources'),path.join(file.parentPath,file.name));
    const hash=async root=>createHash('sha256').update(await readFile(path.join(root,'projects/resources',relative))).digest('hex');
    assert.equal(await hash(live),await hash(backup),`Resource changed: ${relative}`); resources++;
}
const capabilities=await post('tool-capabilities'); assert.ok(capabilities.upscale && capabilities.cutout);
const response=await fetch('http://127.0.0.1:3418/studio'); assert.equal(response.status,200);
const buildId=(await readFile(new URL('../../release/editor-review/CanvasStudio-win32-x64/resources/web/.next-release/BUILD_ID',import.meta.url),'utf8')).trim();
const result={at:new Date().toISOString(),desktopUpdated:true,buildId,credentialsUnchanged:true,projectContentUnchanged:projects,timestampChanges,resourcesUnchanged:resources,localToolsReady:true,lazyResourcesReady:true,backupRoot:path.dirname(backup)};
if (process.env.STUDIO_READ_ONLY !== '1') await writeFile(new URL('../../docs/studio-evidence/atelier-desktop-update.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
