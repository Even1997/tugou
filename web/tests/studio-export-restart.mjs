import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const server=process.env.STUDIO_QA_SERVER;
if(!server||!server.startsWith('D:/CanvasStudioExportQA/'))throw Error('Explicit isolated candidate required');
const probe=net.createServer();probe.listen(3441,'127.0.0.1');await once(probe,'listening');await new Promise(resolve=>probe.close(resolve));
const root=await mkdtemp(path.resolve('../.tools/export-restart-')),base='http://127.0.0.1:3441';let child;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const post=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});assert.equal(r.status,200,await r.clone().text());return r.json()};
async function boot(){child=spawn(process.execPath,[server],{cwd:path.dirname(server),env:{...process.env,PORT:'3441',HOSTNAME:'127.0.0.1',STUDIO_DATA_DIR:root},windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('QA server exited');try{const data=await post('list');assert.equal(path.resolve(data.location),root);return}catch{}await wait(100)}throw Error('Server timeout')}
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended}}
try{
 await boot();const bytes=await sharp({create:{width:32,height:32,channels:4,background:'red'}}).png().toBuffer(),dataUrl='data:image/png;base64,'+bytes.toString('base64');
 const complete=await post('export-start',{width:32,height:32,format:'png',name:'完成图'});await post('export-stripe',{...complete,y:0,dataUrl});const done=await post('export-finish',complete),original=await readFile(done.path);
 const interrupted=await post('export-start',{width:32,height:64,format:'png',name:'未完成'});await post('export-stripe',{...interrupted,y:0,dataUrl});const folder=path.join(root,'exports'),partial='.partial-'+interrupted.id;assert.ok((await readdir(folder)).includes(partial));
 await stop();await boot();assert.ok((await readdir(folder)).includes(partial));const next=await post('export-start',{width:32,height:32,format:'png'});assert.ok(!(await readdir(folder)).includes(partial));await post('export-cancel',next);assert.deepEqual(await readFile(done.path),original);
 const result={at:new Date().toISOString(),passed:true,dataDir:root,checks:['actual server terminated after stripe persisted','restart then first export cleans orphan','completed image bytes unchanged','new export can start and cancel'],realModelRequests:0};await writeFile('../docs/studio-evidence/atelier-export-restart.json',JSON.stringify(result,null,2));console.log(result);
}finally{await stop()}
