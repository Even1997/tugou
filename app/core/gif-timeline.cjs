function validate(gif){
  if(!Number.isInteger(gif.frames)||gif.frames<1||gif.frames>240||!Array.isArray(gif.delays)||gif.delays.length!==gif.frames||gif.delays.some(n=>!Number.isInteger(n)||n<10||n>655350||n%10)||!Number.isInteger(gif.loop)||gif.loop<0)throw Error('GIF 帧信息无效，请重新导入原文件');
}
function frameAt(gif,time=0){
  validate(gif);
  const delays=gif.delays,total=delays.reduce((a,b)=>a+b,0);
  if(gif.loop===1&&time>=total)return delays.length-1;
  let remaining=Math.max(0,time)%total;
  for(let i=0;i<delays.length;i++){if(remaining<delays[i])return i;remaining-=delays[i];}
  return 0;
}
function timeline(doc){
  const gifs=new Map((doc.assets||[]).filter(a=>a.gif?.frames>1).map(a=>[a.id,a.gif]));
  if(!gifs.size)return [{time:0,delay:100}];
  const byId=new Map((doc.layers||[]).map(l=>[l.id,l]));
  const animations=[];
  for(const layer of doc.layers||[]){
    if(layer.kind!=='image'||layer.bitmap)continue;
    const gif=gifs.get(layer.assetId);
    if(!gif)continue;
    let current=layer,hidden=false;const seen=new Set();
    while(current&&!seen.has(current.id)){seen.add(current.id);if(current.visible===false)hidden=true;current=byId.get(current.parentId);}
    if(!hidden){validate(gif);animations.push(gif);}
  }
  if(!animations.length)return [{time:0,delay:100}];
  const duration=Math.max(...animations.map(g=>g.delays.reduce((a,b)=>a+b,0))),times=new Set([0,duration]);
  for(const gif of animations){
    let time=0,index=0;
    while(time<duration){time+=gif.delays[index++%gif.delays.length];if(time<duration)times.add(time);if(times.size>241)throw Error('合成动画超过 240 帧，请减少 GIF 数量或帧数');if(gif.loop===1&&index===gif.delays.length)break;}
  }
  const sorted=[...times].sort((a,b)=>a-b);
  return sorted.slice(0,-1).map((time,i)=>({time,delay:sorted[i+1]-time}));
}
function nextVisibleFrame(frames,index,gifs){
  if(!gifs.size||frames.length<2)return null;
  const current=[...gifs].map(gif=>[gif,frameAt(gif,frames[index].time)]);
  let delay=frames[index].delay;
  for(let next=(index+1)%frames.length;next!==index;next=(next+1)%frames.length){
    if(current.some(([gif,number])=>frameAt(gif,frames[next].time)!==number))return {index:next,delay};
    delay+=frames[next].delay;
  }
  return null;
}
module.exports={frameAt,timeline,nextVisibleFrame};
