import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
window.textQA=async()=>{
  const checks=[],check=(n,v)=>{if(!v)throw Error(n);checks.push(n)},engine=new Compositor();
  const surface=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const ink=c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i];return n};
  for(const [text,size,style,align] of [['输入文字',48,'normal','left'],['婚礼请柬',96,'bold','center'],['fÁgjpq',72,'italic','left'],['fÁgjpq',72,'bold italic','right'],['上行文字\n下行文字',48,'normal','left']]){
    const layer=createLayer('text',{x:30,y:30,text,fontSize:size,fontFamily:'Microsoft YaHei',fontStyle:style,align,color:'#000000',width:600,height:300,lineHeight:1.4});
    const actual=await engine.content(layer,{assets:[]},1),reference=surface(1000,600),ctx=reference.getContext('2d');
    ctx.font=`${style} ${size}px "Microsoft YaHei"`;ctx.textBaseline='alphabetic';text.split('\n').forEach((line,i)=>ctx.fillText(line,100,150+i*size*1.4));
    const ratio=ink(actual)/ink(reference);check(`${text.replace('\n',' / ')} ${style} ${align} retains complete glyph ink`,Math.abs(ratio-1)<.015);
    const doc={width:700,height:400,background:'transparent',layers:[layer],assets:[]},out=surface(1,1);await engine.render(doc,out);
    const bytes=await engine.export(doc,{transparent:true}),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),png=surface(700,400);png.getContext('2d').drawImage(bitmap,0,0);bitmap.close();check('PNG export matches text preview '+checks.length,out.toDataURL()===png.toDataURL());
  }
  engine.dispose();return checks;
};
