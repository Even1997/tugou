const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{transformSync}=require('esbuild');
const renderer=path.resolve(__dirname,'../renderer'),original=Module._extensions['.js'];
const load=(module,file)=>{if(!file.startsWith(renderer+path.sep))return original(module,file);module._compile(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs',target:'es2022'}).code,file);};
Module._extensions['.jsx']=load;Module._extensions['.js']=load;
Module._extensions['.css']=(_,file)=>{const style=document.createElement('style');style.nonce='tugou-ui';style.textContent=fs.readFileSync(file,'utf8');document.head.append(style);};
document.querySelectorAll('script,link[rel=stylesheet]').forEach(n=>n.remove());document.body.innerHTML='<div id="root"></div><div id="dialogs"></div>';Object.assign(document.getElementById('root').style,{height:'100vh',display:'flex',flexDirection:'column'});

const {defaults}=require('../core/preference-values.cjs');let preferences={...defaults,theme:'light'};
window.tugou={platform:'win32',onUpdate:()=>()=>{},update:async()=>null,onSubjectProgress:()=>()=>{},onFontDownload:()=>()=>{},fontCommand:async()=>({custom:[],system:[],builtin:[]}),settings:async(action,patch)=>action==='get'?{preferences,locale:'zh-CN'}:(preferences={...preferences,...patch})};
const React=require('react'),{createRoot}=require('react-dom/client'),{PreferencesProvider,usePreferences}=require('../renderer/preferences.jsx'),{ThemeProvider}=require('../renderer/components.jsx'),{PresentationsWorkspace}=require('../renderer/presentations.jsx'),{LayerEditor}=require('../renderer/layers.jsx'),{CompositeWorkspace}=require('../renderer/composite-workspace.jsx'),P=require('../core/presentations.cjs'),L=require('../core/layers.cjs'),S=require('../core/shapes.cjs');
require('../renderer/ui.css');require('../renderer/composite-workspace.css');
const initial={id:'qa',name:'直线验收',width:1000,height:720,background:'#ffffff',assets:[],layers:[],modules:[],recipes:[],jobs:[],presentations:[P.create('直线验收','16:9',undefined,'blank')]};
window.qa={history:[],future:[]};
function Harness(){
  const [doc,setDoc]=React.useState(initial),[mode,setMode]=React.useState('ppt'),[selected,setSelected]=React.useState([]),prefs=usePreferences();
  const change=next=>{L.validateLayers(next.layers);P.validate(next.presentations,next.assets);qa.history.push(doc);qa.future=[];setDoc(next);return true;};
  const undo=()=>{if(qa.history.length){qa.future.push(doc);setDoc(qa.history.pop());}},redo=()=>{if(qa.future.length){qa.history.push(doc);setDoc(qa.future.pop());}};
  Object.assign(qa,{doc,select:setSelected,undo,redo,load:next=>{qa.history=[];qa.future=[];setSelected([]);setDoc(next);},mode:setMode,theme:theme=>prefs.save({theme}),motion:reduceMotion=>prefs.save({reduceMotion})});
  return mode==='ppt'?React.createElement(PresentationsWorkspace,{record:{document:doc},change,save:()=>{},undo,redo,canUndo:!!qa.history.length,canRedo:!!qa.future.length}):React.createElement(mode==='boards'?CompositeWorkspace:LayerEditor,{projectId:'qa',document:doc,change,selected,setSelected,editHistory:{undo,redo,past:qa.history,future:qa.future,canUndo:!!qa.history.length,canRedo:!!qa.future.length}});
}
createRoot(document.getElementById('root')).render(React.createElement(PreferencesProvider,null,React.createElement(ThemeProvider,null,React.createElement(Harness))));
qa.pixels=async()=>{
  const {Compositor}=require('../renderer/composite.js'),engine=new Compositor(),canvas=document.createElement('canvas'),checks={};
  for(const [name,a,b] of [['horizontal',{x:20,y:50},{x:180,y:50}],['vertical',{x:50,y:20},{x:50,y:180}],['reverse',{x:180,y:20},{x:20,y:180}]]){
    const layer=L.createLayer('shape',{shape:'line',...S.lineBounds(a,b),stroke:'#ff0000',strokeWidth:10}),doc={...initial,width:200,height:200,layers:[layer]};
    await engine.render(doc,canvas,{transparent:true});const ctx=canvas.getContext('2d'),x=(a.x+b.x)/2,y=(a.y+b.y)/2;
    checks[name+' line has visible center pixels']=ctx.getImageData(x,y,1,1).data[0]===255;
    checks[name+' full stroke survives thin element bounds']=ctx.getImageData(x+(name==='vertical'?4:0),y+(name==='horizontal'?4:0),1,1).data[3]>200;
    const png=await engine.export(doc,{transparent:true}),bitmap=await createImageBitmap(new Blob([png],{type:'image/png'})),other=document.createElement('canvas');other.width=200;other.height=200;other.getContext('2d').drawImage(bitmap,0,0);bitmap.close();checks[name+' PNG export matches canvas']=other.toDataURL()===canvas.toDataURL();
  }
  engine.dispose();return checks;
};
