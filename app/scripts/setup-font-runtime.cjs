// Usage: node scripts/setup-font-runtime.cjs <python3.12> <potrace-directory> <runtime-directory> [workspace-directory]
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
async function setup(args,{platform=process.platform,arch=process.arch,run=(file,args)=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','inherit']})}={}){
  if(!['darwin','win32'].includes(platform)||args.length<3||args.length>4)throw Error('用法：node scripts/setup-font-runtime.cjs <Python 3.12> <Potrace目录> <字体环境目录> [工作区目录]');
  const [sourcePython,potraceDirectory,directory,workspace]=args,target=path.resolve(directory);
  const verifyPython=file=>{
    const info=JSON.parse(run(file,['-I','-c','import json,platform,sys; print(json.dumps({"version":list(sys.version_info[:2]),"machine":platform.machine()}))']));
    const pythonArch={AMD64:'x64',x86_64:'x64',arm64:'arm64',aarch64:'arm64'}[info.machine];
    if(info.version.join('.')!=='3.12'||pythonArch!==arch)throw Error('请提供与当前系统芯片一致的 Python 3.12');
  };
  verifyPython(sourcePython);
  const binary=platform==='win32'?'potrace.exe':'potrace';
  for(const file of [binary,'COPYING','README','AUTHORS'])await fs.access(path.join(potraceDirectory,file));
  run(path.resolve(potraceDirectory,binary),['--version']);
  // Do not overwrite an environment from another machine or architecture.
  try{const old=JSON.parse(await fs.readFile(path.join(target,'runtime.json'),'utf8'));if(old.platform&&old.platform!==platform||old.arch&&old.arch!==arch)throw Error('目标目录属于另一系统或芯片，请使用新目录');}catch(e){if(e.code!=='ENOENT')throw e;}
  const relativePython=platform==='win32'?'Scripts/python.exe':'bin/python3',python=path.join(target,relativePython);
  try{await fs.access(python);}catch(e){if(e.code!=='ENOENT')throw e;run(sourcePython,['-m','venv',target]);}
  verifyPython(python);
  run(python,['-m','pip','install','--only-binary=:all:','-r',path.join(__dirname,'../runtime/font-requirements.txt')]);
  run(python,['-m','pip','install','--only-binary=:all:','--no-deps','-r',path.join(__dirname,'../runtime/font-ocr-requirements.txt')]);
  run(python,['-I','-c','import cv2, fontTools, PIL, brotli; from rapidocr_onnxruntime import RapidOCR; assert hasattr(cv2,"aruco"); RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1)']);
  await fs.mkdir(path.join(target,'potrace'),{recursive:true});
  for(const file of [binary,'COPYING','README','AUTHORS'])await fs.copyFile(path.join(potraceDirectory,file),path.join(target,'potrace',file));
  if(platform!=='win32')await fs.chmod(path.join(target,'potrace',binary),0o755);
  run(path.join(target,'potrace',binary),['--version']);
  const versions=JSON.parse(run(python,['-I','-c','import json,platform,importlib.metadata as m; print(json.dumps({"python":platform.python_version(),**{k:m.version(k) for k in ["numpy","opencv-python-headless","Pillow","fonttools","brotli","onnxruntime","rapidocr-onnxruntime"]}}))']));
  const {atomicWrite}=require('../core/storage.cjs');
  await atomicWrite(path.join(target,'runtime.json'),JSON.stringify({platform,arch,python:relativePython,potrace:'potrace/'+binary,versions},null,2));
  if(workspace)await atomicWrite(path.join(path.resolve(workspace),'font-runtime.json'),JSON.stringify({directory:target}));
  return target;
}
if(require.main===module)setup(process.argv.slice(2)).then(dir=>console.log('字体环境已配置：'+dir)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={setup};
