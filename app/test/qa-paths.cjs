const path=require('node:path');
const root=path.resolve(__dirname,'../test-results');
function resolve(suffix=''){
  if(suffix==='shared-build')return path.join(root,'workflow-build');
  if(suffix.startsWith('lean-package/'))return path.resolve(__dirname,'../release',suffix.slice('lean-package/'.length));
  return path.join(root,suffix);
}
function inside(value){if(typeof value!=='string')return false;const relative=path.relative(root,path.resolve(value));return !!relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
module.exports={root,path:resolve,inside};
