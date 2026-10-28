import {surface} from './selection.js';

// Disabled masks remain inspectable; this never changes their saved enabled state.
export async function maskSelection(doc,layer,engine,frame) {
  if(!layer?.mask)throw Error('请先选择已有蒙版');
  return engine.mask({...layer,mask:{...layer.mask,disabled:false}},doc,frame||{
    width:doc.width,height:doc.height,scale:1,transform:[1,0,0,1,0,0],
  });
}
export async function maskView(doc,layer,engine,frame) {
  const mask=await maskSelection(doc,layer,engine,frame),out=surface(mask.width,mask.height),ctx=out.getContext('2d');
  try {
    const ink=mask.getContext('2d');ink.globalCompositeOperation='source-in';ink.fillStyle='#fff';ink.fillRect(0,0,mask.width,mask.height);
    ctx.fillStyle='#000';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(mask,0,0);
    return out;
  }finally{mask.width=mask.height=1;}
}
