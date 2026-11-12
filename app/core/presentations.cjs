const {validateEffect}=require('./effects.cjs');
const {validateContent}=require('./presentation-content.cjs');
const {lineBounds,lineEndpoints,validLinePoints}=require('./shapes.cjs');
const uid=()=>globalThis.crypto.randomUUID();
const sizes={'16:9':[1280,720],'4:3':[960,720]};
const colors=['#1765d1','#202631','#b95714'];
const presentationFont=e=>({fontFamily:e.fontFamily,fontWeight:e.fontWeight??(e.bold?700:400),fontResource:e.fontResource});
const rectangleRadius=e=>rectangleRadii(e)[0];
const cornerKeys=['topLeft','topRight','bottomRight','bottomLeft'];
const rectangleRadii=e=>{if(e.kind!=='rect')return [0,0,0,0];const value=e.cornerRounding??e.cornerRadius??0,limit=Math.min(e.w,e.h)/2,scale=e.cornerRounding===undefined?1:limit/100;return cornerKeys.map(k=>Math.min((typeof value==='object'?value[k]:value)*scale,limit));};
function rectangleOutline(e){
  const [tl,tr,br,bl]=rectangleRadii(e),{w,h}=e;
  return [{x:tl,y:0,moveTo:true},{x:w-tr,y:0},{x:w,y:tr,r:tr,angle:270},{x:w,y:h-br},{x:w-br,y:h,r:br,angle:0},{x:bl,y:h},{x:0,y:h-bl,r:bl,angle:90},{x:0,y:tl},{x:tl,y:0,r:tl,angle:180},{close:true}];
}
const rectanglePath=e=>rectangleOutline(e).map(p=>p.close?'Z':p.moveTo?`M ${p.x} ${p.y}`:p.r?`A ${p.r} ${p.r} 0 0 1 ${p.x} ${p.y}`:`L ${p.x} ${p.y}`).join(' ');
function element(kind,patch={}){return {id:uid(),kind,x:96,y:96,w:kind==='text'?600:320,h:kind==='text'?120:kind==='line'?1:240,rotation:0,...(kind==='text'?{text:'双击编辑文字',fontSize:40,fontFamily:'Microsoft YaHei',color:'#202631',bold:false,italic:false,align:'left'}:kind==='image'?{assetId:''}:kind==='line'?{stroke:'#202631',strokeWidth:2,linePoints:[0,.5,1,.5]}:{fill:'#1765d1'}),...patch};}
function presentationLine(start,end,snap=false){const {width:w,height:h,...box}=lineBounds(start,end,snap,5000);return {...box,w,h,rotation:0};}
function presentationLineEndpoints(e){const angle=e.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);return lineEndpoints(e.w,e.h,e.linePoints).map(p=>({x:e.x+e.w/2+c*(p.x-e.w/2)-s*(p.y-e.h/2),y:e.y+e.h/2+s*(p.x-e.w/2)+c*(p.y-e.h/2)}));}
function slide(layout='blank',width=1280,accent=colors[0]){
  const elements=layout==='blank'?[]:layout==='cover'?[
    element('rect',{x:72,y:140,w:8,h:320,fill:accent}),
    element('text',{x:112,y:175,w:width-208,h:150,text:'演示文稿标题',fontSize:60,bold:true}),
    element('text',{x:112,y:355,w:width-208,h:100,text:'在这里写下你的主题与想法',fontSize:28,color:'#626c7c'})
  ]:[element('text',{x:72,y:56,w:width-144,h:90,text:'这一页的标题',fontSize:42,bold:true}),element('rect',{x:72,y:158,w:64,h:8,fill:accent}),element('text',{x:72,y:210,w:width-144,h:360,text:'写下你的核心内容\n\n用清晰的结构，让观点更有力量。',fontSize:28})];
  return {id:uid(),background:'#ffffff',notes:'',elements};
}
function create(name='未命名 PPT',ratio='16:9',accent=colors[0],layout='cover'){return {id:uid(),name,ratio,accent,slides:[slide(layout,sizes[ratio][0],accent)]};}
function duplicate(value){const next=structuredClone(value);next.id=uid();if(next.slides)next.slides=next.slides.map(duplicate);if(next.elements){const ids=new Map(next.elements.map(e=>[e.id,uid()]));next.elements=next.elements.map(e=>({...e,id:ids.get(e.id)}));if(next.content)next.content.blocks=next.content.blocks.map(b=>({...b,id:uid(),...(b.elementId?{elementId:ids.get(b.elementId)}:{})}));}return next;}
function validate(decks,assets=[]){
  if(decks===undefined)return;
  const fail=()=>{throw Error('PPT 数据无效或超出限制');},hex=v=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v),text=(v,max)=>typeof v==='string'&&v.length<=max;
  if(!Array.isArray(decks)||decks.length>100)fail();
  const ids=new Set(),id=v=>{if(!text(v,100)||!v||ids.has(v))fail();ids.add(v);};
  for(const deck of decks){
    id(deck?.id);if(!text(deck.name,120)||!deck.name.trim()||!Object.hasOwn(sizes,deck.ratio)||!hex(deck.accent)||!Array.isArray(deck.slides)||!deck.slides.length||deck.slides.length>200)fail();
    for(const s of deck.slides){id(s?.id);if(!hex(s.background)||!text(s.notes,10000)||!Array.isArray(s.elements)||s.elements.length>200)fail();validateContent(s);
      for(const e of s.elements){id(e?.id);if(!['text','rect','ellipse','image','line'].includes(e.kind)||![e.x,e.y,e.w,e.h,e.rotation].every(Number.isFinite)||Math.abs(e.x)>5000||Math.abs(e.y)>5000||e.w<(e.kind==='line'?1:8)||e.w>5000||e.h<(e.kind==='line'?1:8)||e.h>5000||Math.abs(e.rotation)>360)fail();
        if(e.kind==='line'&&(!hex(e.stroke)||!Number.isFinite(e.strokeWidth)||e.strokeWidth<1||e.strokeWidth>500||!validLinePoints(e.linePoints)))fail();
        if(e.kind!=='line'&&['linePoints','stroke','strokeWidth'].some(k=>e[k]!==undefined))fail();
        if(e.kind==='line'&&e.effects?.length)throw Error('直线请使用描边颜色和粗细，不支持外框与阴影效果');
        if(e.effects!==undefined){
          if(!Array.isArray(e.effects)||e.effects.length>3||new Set(e.effects.map(f=>f?.type)).size!==e.effects.length||new Set(e.effects.map(f=>f?.id)).size!==e.effects.length)fail();
          for(const f of e.effects){validateEffect(f);if(!text(f.id,100)||!f.id||!['shadow','innerShadow','stroke'].includes(f.type)||f.blend!=='source-over'||f.type==='stroke'&&f.position!=='center'||f.type!=='stroke'&&(f.spread!==0||f.radius>100||f.distance>200))fail();}
        }
        if(['visible','locked'].some(k=>e[k]!==undefined&&typeof e[k]!=='boolean'))fail();
        for(const [key,max] of [['cornerRadius',2500],['cornerRounding',100]])if(e[key]!==undefined){const v=e[key],valid=n=>Number.isFinite(n)&&n>=0&&n<=max;if(e.kind!=='rect'||(typeof v==='number'?!valid(v):!v||Array.isArray(v)||Object.keys(v).length!==4||!cornerKeys.every(k=>Object.hasOwn(v,k)&&valid(v[k]))))fail();}
        if(e.fontWeight!==undefined&&(e.kind!=='text'||!Number.isInteger(e.fontWeight)||e.fontWeight<1||e.fontWeight>1000))fail();
        if(e.fontResource!=null&&(e.kind!=='text'||!/^[a-f0-9]{64}\.ttf$/.test(e.fontResource.resource)||!text(e.fontResource.projectId,100)||!e.fontResource.projectId||!text(e.fontResource.jobId,100)||!e.fontResource.jobId))fail();
        require('./rich-text.cjs').validateTextRuns(e,8,240,10000);
        if(e.kind==='text'&&(!text(e.text,10000)||!hex(e.color)||!text(e.fontFamily,100)||!Number.isFinite(e.fontSize)||e.fontSize<8||e.fontSize>240||typeof e.bold!=='boolean'||typeof e.italic!=='boolean'||!['left','center','right'].includes(e.align)))fail();
        if(['rect','ellipse'].includes(e.kind)&&!hex(e.fill))fail();
        if(e.kind==='image'&&!assets.some(a=>a.id===e.assetId&&(!a.kind||a.kind==='image')))fail();
      }
    }
  }
}
module.exports={sizes,colors,element,slide,create,duplicate,validate,presentationFont,rectangleRadius,cornerKeys,rectangleRadii,rectangleOutline,rectanglePath,presentationLine,presentationLineEndpoints};
