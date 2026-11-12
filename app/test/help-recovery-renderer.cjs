const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{transformSync}=require('esbuild');
const renderer=path.resolve(__dirname,'../renderer'),original=Module._extensions['.js'];
const load=(module,file)=>{if(!file.startsWith(renderer+path.sep))return original(module,file);module._compile(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs',target:'es2022'}).code,file);};
Module._extensions['.jsx']=load;Module._extensions['.js']=load;
Module._extensions['.css']=(_,file)=>{const style=document.createElement('style');style.nonce='tugou-ui';style.textContent=fs.readFileSync(file,'utf8');document.head.append(style);};
document.querySelectorAll('script,link[rel=stylesheet]').forEach(n=>n.remove());document.body.innerHTML='<div id="root"></div><div id="dialogs"></div>';Object.assign(document.getElementById('root').style,{height:'100vh',display:'flex',flexDirection:'column'});

const {defaults}=require('../core/preference-values.cjs');let preferences={...defaults,theme:'light'};
window.tugou={platform:'win32',onUpdate:()=>()=>{},update:async()=>null,onSubjectProgress:()=>()=>{},onFontDownload:()=>()=>{},fontCommand:async()=>({custom:[],system:[],builtin:[]}),settings:async(action,patch)=>action==='get'?{preferences,locale:'zh-CN'}:(preferences={...preferences,...patch})};
const React=require('react'),{createRoot}=require('react-dom/client'),{PreferencesProvider,usePreferences}=require('../renderer/preferences.jsx'),{ThemeProvider}=require('../renderer/components.jsx'),{HelpPanel}=require('../renderer/help.jsx'),{TaskPanel}=require('../renderer/tasks.jsx');
require('../renderer/ui.css');
window.qa={calls:[],mode:'ok',refreshMode:'ok',opens:[]};
for(const name of ['retryWorkflow','cancelCloudBatch','retryRuntimeInstall','retryCloudTool','retryImageTool','cancelTask'])window.tugou[name]=async id=>{qa.calls.push([name,id]);if(qa.mode==='fail')throw Error('模拟服务连接失败');if(qa.mode==='pending')await new Promise(r=>qa.release=r);};
function Harness(){
 const [help,setHelp]=React.useState(false),[tasks,setTasks]=React.useState(null),prefs=usePreferences();
 Object.assign(qa,{tasks:setTasks,theme:theme=>prefs.save({theme})});
 return React.createElement(React.Fragment,null,
 React.createElement('button',{id:'help-entry',onClick:()=>setHelp(true)},'帮助'),
 React.createElement(HelpPanel,{open:help,close:()=>setHelp(false),showTasks:()=>{qa.openedTasks=true;setTasks([]);}}),
 tasks&&React.createElement(TaskPanel,{tasks,close:()=>setTasks(null),refresh:async()=>{qa.calls.push(['refresh']);if(qa.refreshMode==='fail')throw Error('模拟记录读取失败');},openProject:id=>qa.opens.push(id)}));
}
createRoot(document.getElementById('root')).render(React.createElement(PreferencesProvider,null,React.createElement(ThemeProvider,null,React.createElement(Harness))));
