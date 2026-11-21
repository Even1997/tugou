import {changeDpiBlob} from 'changedpi';

// pHYs must occur once, before the first image-data chunk. Keep compressed pixels intact.
export async function printPng(blob,ppi){
  const header=await changeDpiBlob(blob.slice(0,33,'image/png'),ppi);
  let offset=33;
  while(offset+12<=blob.size){
    const chunk=new DataView(await blob.slice(offset,offset+8).arrayBuffer());
    const length=chunk.getUint32(0),type=chunk.getUint32(4),next=offset+12+length;
    if(next>blob.size)throw Error('PNG 数据不完整');
    if(type===0x70485973)return new Blob([header,blob.slice(33,offset),blob.slice(next)],{type:'image/png'});
    if(type===0x49444154)return new Blob([header,blob.slice(33)],{type:'image/png'});
    offset=next;
  }
  throw Error('PNG 缺少图像数据');
}
