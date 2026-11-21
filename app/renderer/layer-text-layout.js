import {textFontWeight} from '../core/font-weights.cjs';
import {styledRuns} from '../core/rich-text.cjs';
import {loadTextFont,textFontFamily} from './font-face.js';
import {homography,project,point} from '../core/layers.cjs';

export function textBoxCorners(layer,m,box){
  const h=layer.warp&&homography(layer.warp);
  return [[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]].map(([x,y])=>{
    const p=h&&project(h,x/layer.width,y/layer.height);
    return p?point(m,p.x*layer.width,p.y*layer.height):point(m,x,y);
  });
}

const padding=2;
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const family=layer=>`"${textFontFamily(layer).replace(/["\\]/g,'')}"`;
const runFont=r=>`${r.italic?'italic':'normal'} ${r.fontWeight} ${r.fontSize}px ${family(r)}`;
let measureContext;
const measuring=()=>measureContext??=document.createElement('canvas').getContext('2d');

export const loadLayerTextFonts=layer=>Promise.all((layer.textRuns?styledRuns(layer):[layer]).map(loadTextFont));

const fitX=(width,m,x)=>Math.max(padding+m.actualBoundingBoxLeft,Math.min(width-padding-m.actualBoundingBoxRight,x));

function justifyGlyph(ctx,layer,fill,text,x,y,gap){
  const metrics=ctx.measureText(text);
  fill(text,layer.textAutoFit?fitX(layer.width,metrics,x):x,y);
  return x+metrics.width+gap;
}

function textLines(ctx,text,width){
  const lines=[];
  for(const paragraph of String(text).split('\n')){
    let line='';
    for(const ch of paragraph){
      const metrics=ctx.measureText(line+ch);
      if(line&&Math.max(metrics.width,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight)>width){
        lines.push(line);
        line='';
      }
      line+=ch;
    }
    lines.push(line);
  }
  return lines;
}

// The measuring callbacks use the same baselines and wrapping as the canvas paint.
export function paintLayerText(ctx,layer,fill=(text,x,y)=>ctx.fillText(text,x,y)){
  ctx.textAlign='start';
  ctx.textBaseline='alphabetic';
  ctx.letterSpacing=`${layer.letterSpacing||0}px`;
  if(layer.textRuns)return paintRichText(ctx,layer,fill);
  const fontSize=layer.fontSize||32;
  ctx.font=`${layer.fontStyle?.includes('italic')?'italic':'normal'} ${textFontWeight(layer)} ${fontSize}px ${family(layer)}`;
  ctx.fillStyle=layer.color||'#222222';
  const lines=textLines(ctx,layer.text||'',Math.max(1,layer.width-padding*2));
  // Keep CJK accents and italic overhang within the raster surface.
  const ascent=Math.ceil(Math.max(0,...lines.map(line=>ctx.measureText(line).actualBoundingBoxAscent)));
  const height=fontSize*(layer.lineHeight||1.4);
  lines.forEach((line,i)=>{
    if(i*height>=layer.height)return;
    const y=padding+ascent+i*height;
    ctx.textAlign=['center','right'].includes(layer.align)?layer.align:'left';
    const metrics=ctx.measureText(line),anchor=layer.align==='center'?layer.width/2:layer.align==='right'?layer.width-padding:padding;
    const x=fitX(layer.width,metrics,anchor);
    if(layer.align==='justify'&&i<lines.length-1&&line.length>1){
      ctx.textAlign='left';
      const chars=[...line],gap=(layer.width-padding*2-ctx.measureText(line).width)/(chars.length-1);
      let at=padding;
      for(const ch of chars)at=justifyGlyph(ctx,layer,fill,ch,at,y,gap);
    }else fill(line,x,y);
  });
  return padding+(lines.length-1)*height+fontSize;
}

function paintRichText(ctx,layer,fill){
  const width=Math.max(1,layer.width-padding*2),lines=[{parts:[],width:0,size:layer.fontSize||32}];
  ctx.textAlign='left';
  for(const run of styledRuns(layer)){
    ctx.font=runFont(run);
    for(const {segment:ch} of segmenter.segment(run.text)){
      let line=lines.at(-1),last=line.parts.at(-1);
      if(ch==='\n'){lines.push({parts:[],width:0,size:run.fontSize});continue;}
      const combined=last?.run===run,added=ctx.measureText((combined?last.text:'')+ch).width-(combined?last.width:0);
      if(line.parts.length&&line.width+added>width){line={parts:[],width:0,size:run.fontSize};lines.push(line);last=null;}
      if(last?.run===run){line.width-=last.width;last.text+=ch;last.width=ctx.measureText(last.text).width;line.width+=last.width;}
      else {const part={run,text:ch,width:ctx.measureText(ch).width};line.parts.push(part);line.width+=part.width;}
      line.size=Math.max(line.size,run.fontSize);
    }
  }
  let top=padding,bottom=padding;
  for(const line of lines){
    if(top>=layer.height)break;
    const height=line.size*(layer.lineHeight||1.4);
    let ascent=0,descent=0,inkAscent=0,advance=0,left=0,right=0;
    for(const part of line.parts){
      ctx.font=runFont(part.run);
      const m=ctx.measureText(part.text);
      ascent=Math.max(ascent,m.fontBoundingBoxAscent);descent=Math.max(descent,m.fontBoundingBoxDescent);
      if(layer.textAutoFit){
        inkAscent=Math.max(inkAscent,m.actualBoundingBoxAscent);
        left=Math.min(left,advance-m.actualBoundingBoxLeft);right=Math.max(right,advance+m.actualBoundingBoxRight);
        advance+=part.width;
      }
    }
    const baseline=(height-ascent-descent)/2+ascent;
    const y=top+(layer.textAutoFit?Math.max(inkAscent,baseline):baseline);
    let x=layer.align==='center'?(layer.width-line.width)/2:layer.align==='right'?layer.width-padding-line.width:padding;
    const count=line.parts.reduce((n,p)=>n+[...segmenter.segment(p.text)].length,0),justify=layer.align==='justify'&&line!==lines.at(-1)&&count>1;
    if(layer.textAutoFit&&!justify)x=Math.max(padding-left,Math.min(layer.width-padding-right,x));
    const gap=justify?(width-line.width)/(count-1):0;
    for(const part of line.parts){
      ctx.font=runFont(part.run);ctx.fillStyle=part.run.color;
      if(justify){for(const {segment:ch} of segmenter.segment(part.text))x=justifyGlyph(ctx,layer,fill,ch,x,y,gap);}
      else {fill(part.text,x,y);x+=part.width;}
    }
    bottom=top+line.size;top+=height;
  }
  return bottom;
}

export function fitLayerText(layer,maxWidth){
  const ctx=measuring();
  let right=(layer.text||'').trim()?0:(layer.fontSize||32)*.5,bottom=0;
  const lineBottom=paintLayerText(ctx,{...layer,width:Math.max(8,maxWidth),height:Infinity,align:'left'},(text,x,y)=>{
    const m=ctx.measureText(text);
    right=Math.max(right,x+Math.max(m.width,m.actualBoundingBoxRight));
    bottom=Math.max(bottom,y+m.actualBoundingBoxDescent);
  });
  const width=Math.max(8,Math.ceil(right+padding)),height=Math.ceil(Math.max(lineBottom,bottom)+padding);
  if(width*height>100000000)throw Error('文字框过大，请减少文字或缩小字号');
  return {...layer,width,height};
}

export function layerTextBounds(layer){
  const ctx=measuring();
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  paintLayerText(ctx,layer,(text,x,y)=>{
    if(!text.trim())return;
    const m=ctx.measureText(text);
    left=Math.min(left,x-m.actualBoundingBoxLeft);right=Math.max(right,x+m.actualBoundingBoxRight);
    top=Math.min(top,y-m.actualBoundingBoxAscent);bottom=Math.max(bottom,y+m.actualBoundingBoxDescent);
  });
  const x=Math.max(0,Math.floor(left)-padding),y=Math.max(0,Math.floor(top)-padding);
  const width=Math.min(layer.width,Math.ceil(right)+padding)-x,height=Math.min(layer.height,Math.ceil(bottom)+padding)-y;
  return width>0&&height>0?{x,y,width,height}:null;
}
