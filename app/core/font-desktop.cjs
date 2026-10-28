const fs=require('node:fs/promises'),path=require('node:path');
const {FontService}=require('./font-service.cjs');
const {RequestJournal}=require('./automation-host.cjs');
const {validate}=require('./automation-commands.cjs');
const {safePath,atomicWrite}=require('./storage.cjs');

async function registerFonts({root,tasks,handle,dialog,window}){
  const fonts=new FontService(root,tasks),journal=new RequestJournal(await safePath(root,'font-ui-requests.json'));await journal.init();
  const denied=()=>{throw Error('请使用文件选择器');};
  const execute=(name,args,access={})=>{validate(name,args);return fonts.execute(name,args,{journal,filePath:denied,writeNew:denied,...access});};
  handle('fontCommand',(name,args={})=>{
    if(typeof name!=='string'||!name.startsWith('font.')||['font.atlas.import','font.artifact.export'].includes(name)||args.path!==undefined)throw Error('无效字体命令');
    return execute(name,args);
  });
  handle('fontImport',async args=>{
    // Validate before opening a dialog; the renderer cannot choose a filesystem path.
    const command={...args,path:'selected-image'};validate('font.atlas.import',command);
    const choice=await dialog.showOpenDialog(window,{title:'导入字形图片',properties:['openFile'],filters:[{name:'图集',extensions:['png','jpg','jpeg','webp']}]});
    if(choice.canceled)return null;
    return execute('font.atlas.import',command,{filePath:()=>choice.filePaths[0]});
  });
  handle('fontExport',async args=>{
    validate('font.artifact.export',{...args,path:'selected-output'});
    const p=await fonts.load(args.projectId),job=await fonts.result(p,args.jobId),asset=job.result?.artifacts.find(v=>v.id===args.artifactId);
    if(!asset)throw Error('产物不存在');
    const extension=path.extname(asset.file).slice(1);
    const choice=await dialog.showSaveDialog(window,{title:'导出字体',defaultPath:p.name.replace(/[<>:"/\\|?*]/g,'_')+'.'+extension,filters:[{name:'字体文件',extensions:[extension]}]});
    if(choice.canceled)return false;
    await execute('font.artifact.export',{...args,path:'selected-output'},{writeNew:async(_name,bytes)=>{await atomicWrite(await safePath(path.dirname(choice.filePath),path.basename(choice.filePath)),bytes);return {bytes:bytes.length};}});
    return true;
  });
  handle('fontConfigure',async()=>{
    const choice=await dialog.showOpenDialog(window,{title:'选择已安装的字体运行环境',properties:['openDirectory']});if(choice.canceled)return null;
    const dir=choice.filePaths[0],manifest=JSON.parse(await fs.readFile(await safePath(dir,'runtime.json'),'utf8'));
    await fs.access(await safePath(dir,manifest.python));await fs.access(await safePath(dir,manifest.potrace));
    await atomicWrite(await safePath(root,'font-runtime.json'),JSON.stringify({directory:dir}));return fonts.execute('font.status',{}, {journal});
  });
  return fonts;
}
module.exports={registerFonts};
