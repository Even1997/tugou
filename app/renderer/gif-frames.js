import {frameAt} from '../core/gif-timeline.cjs';

// Decode on demand; keep only one frame per GIF, and bound compressed decoder inputs.
export class GifFrames {
  constructor(){this.items=new Map();this.bytes=0;this.closed=false;}
  delete(url){const entry=this.items.get(url);if(!entry)return;this.items.delete(url);this.bytes-=entry.bytes;entry.removed=true;entry.ready.then(decoder=>decoder.close()).catch(()=>{});}
  retain(urls){for(const url of this.items.keys())if(!urls.has(url))this.delete(url);}
  dispose(){this.closed=true;this.retain(new Set());}
  async frame(asset,url,time){
    if(this.closed)throw Error('动画预览已关闭');
    let entry=this.items.get(url);
    if(!entry){
      const canvas=document.createElement('canvas');entry={canvas,index:-1,bytes:0,queue:Promise.resolve()};
      entry.ready=(async()=>{
        const response=await fetch(url);if(!response.ok)throw Error('GIF 读取失败');
        const bytes=await response.arrayBuffer();if(this.closed||entry.removed||this.bytes+bytes.byteLength+asset.width*asset.height*4>192*1024*1024)throw Error('GIF 预览缓存超过 192 MiB，请减少动画素材');
        entry.bytes=bytes.byteLength+asset.width*asset.height*4;this.bytes+=entry.bytes;
        const decoder=new ImageDecoder({data:bytes,type:'image/gif',preferAnimation:true});await decoder.tracks.ready;return decoder;
      })();
      this.items.set(url,entry);
    }
    const index=frameAt(asset.gif,time);
    const work=entry.queue.catch(()=>{}).then(async()=>{
      const decoder=await entry.ready;
      if(entry.index!==index){
        const {image}=await decoder.decode({frameIndex:index});
        try{entry.canvas=document.createElement('canvas');entry.canvas.width=image.displayWidth;entry.canvas.height=image.displayHeight;entry.canvas.getContext('2d').drawImage(image,0,0);entry.index=index;}finally{image.close();}
      }
      return entry.canvas;
    });
    entry.queue=work;return work;
  }
}
