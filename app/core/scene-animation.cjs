const mix=(a,b,t)=>a+(b-a)*t;
const vector=(a,b,t,rotation=false)=>a.map((v,i)=>rotation?v+Math.atan2(Math.sin(b[i]-v),Math.cos(b[i]-v))*t:mix(v,b[i],t));
function sceneFrame(scene,time,duration=5){
  const fallback=[{time:0,objects:scene.objects,camera:scene.cameras[0]},{time:duration,objects:scene.objects,camera:scene.cameras.at(-1)}];
  const frames=scene.frames?.length?[...scene.frames].sort((a,b)=>a.time-b.time):fallback;
  const a=[...frames].reverse().find(f=>f.time<=time)||frames[0],b=frames.find(f=>f.time>time)||a,t=a===b?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  return {objects:a.objects.map(o=>{const target=b.objects.find(x=>x.id===o.id)||o;return {...o,position:vector(o.position,target.position,t),rotation:vector(o.rotation,target.rotation,t,true),scale:vector(o.scale,target.scale,t),pose:Object.fromEntries([...new Set([...Object.keys(o.pose||{}),...Object.keys(target.pose||{})])].map(k=>[k,mix(o.pose?.[k]||0,target.pose?.[k]||0,t)]))};}),camera:{...a.camera,position:vector(a.camera.position,b.camera.position,t),target:vector(a.camera.target,b.camera.target,t),fov:mix(a.camera.fov,b.camera.fov,t)}};
}
module.exports={sceneFrame};
