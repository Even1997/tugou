self.onmessage=async({data:{id,image}})=>{
  try{
    const canvas=new OffscreenCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
    const bytes=await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
    self.postMessage({id,bytes,image},[bytes,image]);canvas.width=canvas.height=1;
  }catch(e){image.close();self.postMessage({id,error:e.message});}
};
