export class RasterEncoder {
  constructor(){this.pending=new Map();this.id=0;}
  async encode(canvas){
    if(!this.worker){
      this.worker=new Worker(new URL('./raster-encode-worker.js',location.href));
      this.worker.onmessage=({data})=>{const item=this.pending.get(data.id);this.pending.delete(data.id);if(!item){data.image?.close();return;}data.error?item.reject(Error(data.error)):item.resolve({bytes:new Uint8Array(data.bytes),image:Object.assign(data.image,{naturalWidth:data.image.width,naturalHeight:data.image.height})});};
      this.worker.onerror=()=>this.dispose();
    }
    const worker=this.worker,image=await createImageBitmap(canvas),id=++this.id;
    if(this.worker!==worker){image.close();throw Error('绘画编码已取消');}
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});worker.postMessage({id,image},[image]);});
  }
  dispose(){this.worker?.terminate();this.worker=null;for(const item of this.pending.values())item.reject(Error('绘画编码已取消'));this.pending.clear();}
}
