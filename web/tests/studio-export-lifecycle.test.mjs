import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {imageExport} from '../src/app/api/studio/image-export.ts';

async function setup(t){const root=await mkdtemp(path.join(os.tmpdir(),'studio-export-life-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
const start=root=>imageExport(root,'export-start',{width:32,height:32,name:'safe',format:'png'});
const strip=async()=>`data:image/png;base64,${(await sharp({create:{width:32,height:32,channels:4,background:'#12345680'}}).png().toBuffer()).toString('base64')}`;

test('编码期间取消接受请求，等待处理退场后删除分块，不发布图片',async t=>{
 const root=await setup(t),{id}=await start(root);await imageExport(root,'export-stripe',{id,y:0,dataUrl:await strip()});
 const finishing=imageExport(root,'export-finish',{id});const rejected=assert.rejects(finishing,/取消/);
 assert.equal((await imageExport(root,'export-cancel',{id})).cancelled,true);await rejected;
 assert.deepEqual(await readdir(path.join(root,'exports')),[]);
 const next=await start(root);await imageExport(root,'export-cancel',next);
});

test('分块写入期间取消、重复取消、完成后取消都不破坏已完成文件',async t=>{
 const root=await setup(t),{id}=await start(root),dataUrl=await strip();
 const writing=imageExport(root,'export-stripe',{id,y:0,dataUrl});const rejected=assert.rejects(writing,/取消/);
 await imageExport(root,'export-cancel',{id});await imageExport(root,'export-cancel',{id});await rejected;
 assert.deepEqual(await readdir(path.join(root,'exports')),[]);
 const next=await start(root);await imageExport(root,'export-stripe',{...next,y:0,dataUrl});const done=await imageExport(root,'export-finish',next),bytes=await readFile(done.path);
 await imageExport(root,'export-cancel',next);assert.deepEqual(await readFile(done.path),bytes);
 await assert.rejects(imageExport(root,'export-cancel',{id:'../credentials.enc'}),/任务/);
});

test('启动清理仅触及本机已知分块，保留完成图、陌生目录、链接和活动任务',async t=>{
 const root=await setup(t),folder=path.join(root,'exports');await mkdir(folder);
 const old=path.join(folder,'.partial-'+randomUUID());await mkdir(old);await writeFile(path.join(old,'0.png'),'orphan');await writeFile(path.join(old,'output'),'partial');
 const unknown=path.join(folder,'.partial-'+randomUUID());await mkdir(unknown);await writeFile(path.join(unknown,'notes.txt'),'keep');
 const foreign=path.join(root,'foreign');await mkdir(foreign);await writeFile(path.join(foreign,'0.png'),'keep');await symlink(foreign,path.join(folder,'.partial-'+randomUUID()),'junction');
 await writeFile(path.join(folder,'finished.png'),'keep');const active=await start(root);assert.ok(!(await readdir(folder)).includes(path.basename(old)));
 assert.equal(await readFile(path.join(foreign,'0.png'),'utf8'),'keep');assert.equal(await readFile(path.join(unknown,'notes.txt'),'utf8'),'keep');assert.equal(await readFile(path.join(folder,'finished.png'),'utf8'),'keep');
 const second=await start(root);assert.ok((await readdir(folder)).includes('.partial-'+active.id));
 await imageExport(root,'export-cancel',active);await imageExport(root,'export-cancel',second);
});

test('目录隔离与并发容量：其他数据目录不能取消本目录任务，最多两个',async t=>{
 const root=await setup(t),other=await setup(t);
 const jobs=await Promise.allSettled([start(root),start(root),start(root)]);const accepted=jobs.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.equal(accepted.length,2);
 await assert.rejects(imageExport(other,'export-cancel',accepted[0]),/任务/);
 for(const job of accepted)await imageExport(root,'export-cancel',job);
});
