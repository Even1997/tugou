import React from 'react';
import {materialSource} from '../core/materials.cjs';
import './asset-time.css';

const format=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function AssetTime({asset}) {
  if(!asset||(asset.kind&&asset.kind!=='image'))return null;
  const date=asset.createdAt?new Date(asset.createdAt):null;
  const label=materialSource(asset)==='imported'?'上传时间':'完成时间';
  if(!date||!Number.isFinite(date.getTime()))return <span className="asset-time">{label}未记录</span>;
  return <time className="asset-time" dateTime={date.toISOString()} title={label} aria-label={`${label}：${format.format(date)}`}>{format.format(date)}</time>;
}
