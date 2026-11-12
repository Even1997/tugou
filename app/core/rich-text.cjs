const {textFontWeight}=require('./font-weights.cjs');
const styleKeys=['fontFamily','fontResource','fontSize','fontWeight','color','italic'];
const baseStyle=e=>({fontFamily:e.fontFamily||'Microsoft YaHei',fontResource:e.fontResource||null,fontSize:e.fontSize||32,fontWeight:textFontWeight({...e,fontWeight:e.fontWeight??(e.bold?700:undefined)}),color:e.color||'#222222',italic:e.italic??!!e.fontStyle?.includes('italic')});
const textRuns=e=>e.textRuns||[{text:e.text||''}];
const styledRuns=e=>textRuns(e).map(r=>({...baseStyle(e),...r}));
function compactRuns(runs){
  const result=[];
  for(const run of runs){if(!run.text)continue;const style=Object.fromEntries(styleKeys.filter(k=>run[k]!==undefined).map(k=>[k,run[k]])),last=result.at(-1);
    if(last&&JSON.stringify({...last,text:undefined})===JSON.stringify(style))last.text+=run.text;else result.push({...style,text:run.text});}
  return result;
}
function validateTextRuns(e,min=1,max=1000,limit=100000){
  if(e.textRuns===undefined)return;
  const fail=()=>{throw Error('文字选区格式无效');},str=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n;
  if(e.kind!=='text'||typeof e.text!=='string'||e.text.length>limit||!Array.isArray(e.textRuns)||e.textRuns.length>e.text.length+1)fail();
  for(const r of e.textRuns){
    if(!r||!str(r.text,limit)||Object.keys(r).some(k=>k!=='text'&&!styleKeys.includes(k)))fail();
    if(r.fontFamily!==undefined&&!str(r.fontFamily,100))fail();
    if(r.fontSize!==undefined&&(!Number.isFinite(r.fontSize)||r.fontSize<min||r.fontSize>max))fail();
    if(r.fontWeight!==undefined&&(!Number.isInteger(r.fontWeight)||r.fontWeight<1||r.fontWeight>1000))fail();
    if(r.italic!==undefined&&typeof r.italic!=='boolean')fail();
    if(r.color!==undefined&&(typeof r.color!=='string'||!/^#[a-f\d]{6}$/i.test(r.color)))fail();
    const f=r.fontResource;if(f!=null&&(!/^[a-f0-9]{64}\.ttf$/.test(f.resource)||!str(f.projectId,100)||!str(f.jobId,100)))fail();
  }
  if(e.textRuns.map(r=>r.text).join('')!==e.text)fail();
}
function sliceRuns(runs,start,end){let at=0;return runs.flatMap(r=>{const text=r.text.slice(Math.max(0,start-at),Math.max(0,end-at));at+=r.text.length;return text?[{...r,text}]:[];});}
// Plain-text fields and MCP edits retain the formatting of unchanged text.
function patchText(e,patch){
  if(e.kind!=='text')return {...e,...patch};
  const next={...e,...patch};if(Object.hasOwn(patch,'textRuns'))return next;
  if(!e.textRuns)return next;
  let runs=e.textRuns;
  if(patch.text!==undefined&&patch.text!==e.text){
    const old=e.text,text=patch.text;let start=0,end=0;
    while(start<Math.min(old.length,text.length)&&old[start]===text[start])start++;
    while(end<Math.min(old.length,text.length)-start&&old[old.length-1-end]===text[text.length-1-end])end++;
    const style=sliceRuns(runs,Math.max(0,start-1),Math.max(1,start))[0]||{};
    runs=[...sliceRuns(runs,0,start),{...style,text:text.slice(start,text.length-end)},...sliceRuns(runs,old.length-end,old.length)];
  }
  const keys=styleKeys.filter(k=>Object.hasOwn(patch,k));
  if(Object.hasOwn(patch,'fontFamily'))keys.push('fontResource');
  if(Object.hasOwn(patch,'bold')||Object.hasOwn(patch,'fontStyle'))keys.push('fontWeight');
  if(Object.hasOwn(patch,'fontStyle'))keys.push('italic');
  next.textRuns=compactRuns(runs.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>!keys.includes(k)))));
  return next;
}
const sameText=(a,b)=>a.text===b.text&&JSON.stringify(a.textRuns)===JSON.stringify(b.textRuns);
module.exports={styleKeys,baseStyle,textRuns,styledRuns,compactRuns,validateTextRuns,patchText,sameText};
