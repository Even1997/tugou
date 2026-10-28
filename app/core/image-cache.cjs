// Budget counts decoded RGBA pixels, not browser/GPU overhead or in-flight draws.
class ImageCache {
  constructor(budget=192*1024*1024){this.budget=budget;this.entries=new Map();this.bytes=0;this.evictions=0;this.hits=0;this.misses=0;}
  get size(){return this.entries.size;}
  keys(){return this.entries.keys();}
  delete(key){const e=this.entries.get(key);if(e){this.bytes-=e.bytes;this.entries.delete(key);}}
  clear(){this.entries.clear();this.bytes=0;}
  trim(){for(const [key,e] of this.entries){if(this.bytes<=this.budget)break;if(e.bytes){this.delete(key);this.evictions++;}}}
  put(key,image){this.delete(key);const bytes=image.naturalWidth*image.naturalHeight*4;if(bytes<=this.budget){this.entries.set(key,{bytes,promise:Promise.resolve(image)});this.bytes+=bytes;this.trim();}return image;}
  load(key,loader){
    const old=this.entries.get(key);if(old){this.hits++;this.entries.delete(key);this.entries.set(key,old);return old.promise;}
    this.misses++;const entry={bytes:0};
    entry.promise=Promise.resolve().then(loader).then(image=>{
      if(this.entries.get(key)===entry){const bytes=image.naturalWidth*image.naturalHeight*4;if(bytes>this.budget)this.delete(key);else{entry.bytes=bytes;this.bytes+=bytes;this.trim();}}return image;
    },error=>{if(this.entries.get(key)===entry)this.delete(key);throw error;});
    this.entries.set(key,entry);return entry.promise;
  }
}
module.exports={ImageCache};
