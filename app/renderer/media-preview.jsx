import React from 'react';
import {useStore} from '@xyflow/react';
const mediaDetail=state=>state.transform[2]<.3?0:state.transform[2]<.85?1:2;

export function CanvasMediaPreview({asset,style,thumbnail=false,...props}){
  const detail=useStore(mediaDetail);
  if(!asset||asset.kind==='text')return <MediaPreview asset={asset} {...props} style={style}/>;
  const isImage=!asset.kind||asset.kind==='image';
  if(!detail&&isImage)return <span className="canvas-media-placeholder" aria-hidden="true" style={thumbnail?undefined:{aspectRatio:asset.width&&asset.height?`${asset.width} / ${asset.height}`:'4 / 3',...style}}/>;
  return <MediaPreview asset={asset} thumbnail={thumbnail||detail<2&&!isImage} still={thumbnail||detail<2} preload="none" decoding="async" style={style} {...props}/>;
}

export function MediaPreview({asset,thumbnail=false,full=false,still=false,preload='metadata',...props}){
  if(!asset)return <p className="muted">尚无结果</p>;
  const src=asset.resource?`tugou-media://${full||asset.kind&&asset.kind!=='image'?'original':'resource'}/${asset.resource}${still&&asset.resource.endsWith('.gif')?'?still=1':''}`:asset.dataUrl;
  if(asset.kind==='text')return <p {...props} style={{whiteSpace:'pre-wrap',maxHeight:220,overflow:'auto',...props.style}}>{asset.text}</p>;
  if(asset.kind==='video')return thumbnail?<span>视频 · {asset.name}</span>:<video {...props} className="nodrag nowheel" src={src} controls preload={preload} style={{width:'100%',maxHeight:360,...props.style}}/>;
  if(asset.kind==='audio')return thumbnail?<span>音频 · {asset.name}</span>:<audio {...props} className="nodrag nowheel" src={src} controls preload={preload} style={{width:'100%'}}/>;
  return <img {...props} src={src} alt={asset.name} draggable={false}/>;
}
