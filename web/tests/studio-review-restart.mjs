import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base='http://127.0.0.1:3439',file='D:/CanvasStudioLiveQA/review-restart-before.json',projectId='review-cloud-qa';
const post=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});assert.equal(r.status,200,await r.clone().text());return r.json()};
assert.ok((await post('list')).location.includes('atelier-qa'));
const hash=async url=>createHash('sha256').update(Buffer.from(await(await fetch(base+url)).arrayBuffer())).digest('hex');
if(process.argv[2]==='snapshot'){
 const jobs=await post('generation-list',{projectId}),review=jobs.find(j=>j.status==='review'&&j.rawResult),completed=jobs.find(j=>j.status==='completed'&&j.rawResult);
 assert.ok(review&&completed);
 await writeFile(file,JSON.stringify({review,completed,rawHash:await hash(review.rawResult.dataUrl),resultHash:await hash(completed.result.dataUrl)}));console.log('Restart snapshot saved');
}else if(process.argv[2]==='verify'){
 const before=JSON.parse(await readFile(file,'utf8'));
 assert.equal((await post('config',{})).hasApiKey,false,'Fresh isolated server must have no model credentials');
 const review=await post('generation-get',{id:before.review.id,projectId}),completed=await post('generation-get',{id:before.completed.id,projectId});
 assert.equal(review.status,'review');assert.deepEqual(review.rawResult,before.review.rawResult);assert.equal(await hash(review.rawResult.dataUrl),before.rawHash);
 assert.equal(completed.status,'completed');assert.equal(await hash(completed.result.dataUrl),before.resultHash);
 await post('generation-resolve-size',{id:review.id,projectId});let resolved;
 for(let i=0;i<100;i++){resolved=await post('generation-get',{id:review.id,projectId});if(resolved.status==='completed')break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(resolved.status,'completed',resolved.error);assert.equal(resolved.rawResult.id,review.rawResult.id);assert.deepEqual([resolved.result.width,resolved.result.height],[1024,1024]);
 const result={passed:true,at:new Date().toISOString(),checks:['actual server restart preserves pending raw result','completed processed pixels unchanged','raw bytes unchanged','local resolution works with no API credentials'],id:resolved.id};
 await writeFile(new URL('../../docs/studio-evidence/atelier-review-restart.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}else throw Error('Use snapshot before actual server restart, then verify');
