import React from 'react';
export function MediaPreview({asset,thumbnail=false,full=false,...props}){
  if(!asset)return <p className="muted">尚无结果</p>;
  const src=asset.resource?`tugou-media://${full||asset.kind&&asset.kind!=='image'?'original':'resource'}/${asset.resource}`:asset.dataUrl;
  if(asset.kind==='text')return <p {...props} style={{whiteSpace:'pre-wrap',maxHeight:220,overflow:'auto',...props.style}}>{asset.text}</p>;
  if(asset.kind==='video')return thumbnail?<span>视频 · {asset.name}</span>:<video {...props} className="nodrag nowheel" src={src} controls preload="metadata" style={{width:'100%',maxHeight:360,...props.style}}/>;
  if(asset.kind==='audio')return thumbnail?<span>音频 · {asset.name}</span>:<audio {...props} className="nodrag nowheel" src={src} controls preload="metadata" style={{width:'100%'}}/>;
  return <img {...props} src={src} alt={asset.name} draggable={false}/>;
}
