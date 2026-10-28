import * as THREE from 'three';
import {actor,dispose,loadModel,modelInstance} from './scene-models.js';
import {sceneFrame} from '../core/scene-animation.cjs';

// One bounded snapshot, using the same actors, model loaders and animation as SceneView.
export async function renderScene(scene,assets,args){
  const frame=args.time===undefined?{objects:scene.objects,camera:scene.cameras.find(c=>c.id===scene.activeCamera)}:sceneFrame(scene,args.time,args.duration||5);
  const camera=args.cameraId?scene.cameras.find(c=>c.id===args.cameraId):frame.camera;
  if(!camera)throw Error('机位不存在');
  if(frame.objects.length>200)throw Error('单次 3D 预览限 200 个物体，请拆分场景');
  const [w,h]=(scene.size||'1280x720').split('x').map(Number),scale=Math.min(1,(args.maxSize||1024)/Math.max(w,h));
  const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
  const world=new THREE.Scene(),content=new THREE.Group(),models=new Map(),textures=new Set();
  let renderer,aborted=false,vertices=0;const deadline=AbortSignal.timeout(20000);
  const rememberTextures=root=>root.traverse(o=>{for(const material of [o.material].flat().filter(Boolean))for(const value of Object.values(material))if(value?.isTexture)textures.add(value);});
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(width,height);
    world.background=new THREE.Color('#22252e');world.add(content,new THREE.HemisphereLight(0xffffff,0x56566a,2));
    const light=new THREE.DirectionalLight(0xffffff,scene.light??3);light.position.set(4,8,5);world.add(light);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x8a8a8a,transparent:true,opacity:scene.floorOpacity??.25}));
    floor.rotation.x=-Math.PI/2;floor.position.y=scene.floorHeight||0;world.add(floor);
    content.position.set(...(scene.position||[0,0,0]));content.rotation.set(...(scene.rotation||[0,0,0]));content.scale.setScalar(scene.scale||1);
    for(const object of frame.objects){
      deadline.throwIfAborted();const item=actor(object);content.add(item);
      if(object.kind==='model'){
        if(!models.has(object.resource)){
          const manager=new THREE.LoadingManager();
          const ready=new Promise(resolve=>{manager.onLoad=resolve;});let modelError;
          manager.onError=()=>{modelError=Error('模型纹理加载失败，请嵌入纹理');};
          const url='tugou-media://original/'+object.resource;
          manager.setURLModifier(value=>{if(value!==url&&!/^blob:|^data:image\//.test(value))throw Error('模型外部依赖不可访问，请嵌入纹理');return value;});
          const original=await new Promise((resolve,reject)=>{
            const cancel=()=>{manager.abort();reject(Error('模型加载超时'));};deadline.addEventListener('abort',cancel,{once:true});
            loadModel(object.resource,manager).then(async model=>{
              if(aborted||deadline.aborted){rememberTextures(model);dispose(model);for(const t of textures)t.dispose();return;}
              models.set(object.resource,model);rememberTextures(model);
              await ready;rememberTextures(model);
              if(aborted||deadline.aborted||modelError){dispose(model);for(const t of textures)t.dispose();if(modelError)reject(modelError);}else resolve(model);
            },reject).finally(()=>deadline.removeEventListener('abort',cancel));
          });
          models.set(object.resource,original);
        }
        const model=models.get(object.resource);model.traverse(o=>{vertices+=o.geometry?.attributes.position?.count||0;});
        if(vertices>1000000)throw Error('单次 3D 预览限 100 万模型顶点，请简化模型');
        item.add(modelInstance(model,object.color));
      }
    }
    if(scene.backgroundId){
      const asset=assets.find(a=>a.id===scene.backgroundId);if(!asset?.resource)throw Error('背景图片不存在');
      if(asset.width*asset.height>16000000)throw Error('场景背景限 1600 万像素，请缩小图片');
      const response=await fetch('tugou-media://original/'+asset.resource,{signal:deadline});if(!response.ok)throw Error('背景图片读取失败');
      const bitmap=await createImageBitmap(await response.blob());
      try{if(bitmap.width*bitmap.height>16000000)throw Error('场景背景限 1600 万像素，请缩小图片');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.mapping=THREE.EquirectangularReflectionMapping;textures.add(texture);world.background=texture;}finally{bitmap.close();}
    }
    const view=new THREE.PerspectiveCamera(camera.fov,width/height,.01,1000);view.position.set(...camera.position);view.lookAt(new THREE.Vector3(...camera.target));
    deadline.throwIfAborted();renderer.render(world,view);
    if(renderer.getContext().isContextLost())throw Error('3D 渲染上下文丢失');
    const data=renderer.domElement.toDataURL('image/png').split(',')[1];return {mimeType:'image/png',data,width,height};
  }finally{
    aborted=true;dispose(world);for(const model of models.values())dispose(model);for(const texture of textures)texture.dispose();
    if(renderer){renderer.dispose();renderer.forceContextLoss();renderer.domElement.width=renderer.domElement.height=1;}
  }
}
