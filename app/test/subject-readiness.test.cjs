const {test}=require('node:test'),assert=require('node:assert/strict'),{subjectReadiness}=require('../core/subject-readiness.cjs');
test('subject readiness distinguishes missing model, RAM, commit memory and ready without inference',()=>{
 const size={width:2048,height:2048},g=1024**3,ready={configured:true,cutout:true,memory:{available:8*g,commitAvailable:20*g}};
 assert.equal(subjectReadiness({},size,8*g).ready,false);
 assert.equal(subjectReadiness(ready,size,100).ready,false);
 assert.equal(subjectReadiness({...ready,memory:{available:8*g,commitAvailable:g}},size,8*g,'win32').ready,false);
 assert.equal(subjectReadiness(ready,size,8*g,'win32').ready,true);
 assert.equal(subjectReadiness(ready,{width:NaN,height:100},8*g).ready,false);
 assert.equal(subjectReadiness({...ready,memory:null},size,8*g,'win32').ready,false);
});
