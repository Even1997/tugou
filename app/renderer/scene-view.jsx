import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {Button,FormDialog,Input,useTheme} from './components.jsx';
import {actor,dispose,loadModel,modelInstance,poses} from './scene-models.js';
import {sceneFrame} from '../core/scene-animation.cjs';

function VectorField({label,value,change}){return <label>{label}<div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:6}}>{value.map((v,i)=><Input key={i} title={['X','Y','Z'][i]} aria-label={`${label}-${i}`} type="number" step="0.1" value={v} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))change(value.map((x,j)=>j===i?n:x));}}/>)}</div></label>;}

export function SceneView({scene,change,backgrounds=[],capture,record,close,panorama=false}){
  const theme=useTheme(),host=useRef(null),api=useRef(null),latest=useRef({scene,change,capture,record});latest.current={scene,change,capture,record};
  const [selected,setSelected]=useState(''),[transform,setTransform]=useState('translate'),[error,setError]=useState(''),[recording,setRecording]=useState(false),[duration,setDuration]=useState(5),[time,setTime]=useState(0),[capturing,setCapturing]=useState(false);
  const object=scene.objects.find(o=>o.id===selected),camera=scene.cameras.find(c=>c.id===scene.activeCamera)||scene.cameras[0];
  const patchObject=patch=>change({...scene,objects:scene.objects.map(o=>o.id===selected?{...o,...patch}:o)});
  const patchCamera=patch=>change({...scene,cameras:scene.cameras.map(c=>c.id===camera.id?{...c,...patch}:c)});
  const busy=recording||capturing;latest.current.selected=selected;latest.current.transform=transform;
  useEffect(()=>{
    let renderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch{setError('WebGL 不可用，请检查显卡驱动');return;}
    renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';host.current.appendChild(renderer.domElement);
    const fit=()=>{const ratio=renderer.domElement.width/renderer.domElement.height,w=host.current?.clientWidth||1,h=host.current?.clientHeight||1;renderer.domElement.style.width=Math.min(w,h*ratio)+'px';renderer.domElement.style.height=Math.min(h,w/ratio)+'px';};const observer=new ResizeObserver(fit);observer.observe(host.current);
    const world=new THREE.Scene(),view=new THREE.PerspectiveCamera(45,16/9,.01,1000),controls=new OrbitControls(view,renderer.domElement),gizmo=new TransformControls(view,renderer.domElement),content=new THREE.Group();
    world.add(content);world.add(new THREE.HemisphereLight(0xffffff,0x56566a,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(4,8,5);world.add(light);
    const grid=new THREE.GridHelper(30,30,0x777777,0x444444);world.add(grid);world.add(gizmo.getHelper());
    const render=()=>renderer.render(world,view),cancel={current:false},models=new Map();let texture,disposed=false,version=0,backgroundVersion=0,pending=0,modelError='';
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x8a8a8a,transparent:true,opacity:.25}));floor.rotation.x=-Math.PI/2;world.add(floor);
    controls.enablePan=!panorama;controls.enableZoom=!panorama;
    controls.addEventListener('change',render);
    controls.addEventListener('end',()=>{if(panorama)return;const current=latest.current;const active=current.scene.activeCamera;current.change({...current.scene,cameras:current.scene.cameras.map(c=>c.id===active?{...c,position:view.position.toArray(),target:controls.target.toArray(),fov:view.fov}:c)});});
    gizmo.addEventListener('dragging-changed',e=>{controls.enabled=!e.value;});
    gizmo.addEventListener('objectChange',render);
    gizmo.addEventListener('mouseUp',()=>{const obj=gizmo.object;if(!obj)return;const current=latest.current;current.change({...current.scene,objects:current.scene.objects.map(o=>o.id===obj.userData.id?{...o,position:obj.position.toArray(),rotation:[obj.rotation.x,obj.rotation.y,obj.rotation.z],scale:obj.scale.toArray()}:o)});});
    const pick=e=>{if(panorama||gizmo.dragging)return;const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),view);let hit=ray.intersectObjects(content.children,true)[0]?.object;while(hit&&!hit.userData.id)hit=hit.parent;if(hit)setSelected(hit.userData.id);};
    renderer.domElement.addEventListener('dblclick',pick);
    const wheel=e=>{if(!panorama)return;e.preventDefault();view.fov=THREE.MathUtils.clamp(view.fov+e.deltaY*.03,25,100);view.updateProjectionMatrix();render();};renderer.domElement.addEventListener('wheel',wheel,{passive:false});
    api.current={render,update(scene){
      const currentVersion=++version;pending=0;modelError='';
      gizmo.detach();for(const child of [...content.children]){content.remove(child);dispose(child);}scene.objects.forEach(o=>{const item=actor(o);content.add(item);if(o.kind==='model'&&o.resource){pending++;if(!models.has(o.resource))models.set(o.resource,loadModel(o.resource));models.get(o.resource).then(original=>{if(!disposed&&currentVersion===version){item.add(modelInstance(original,o.color));render();}}).catch(e=>{if(!disposed&&currentVersion===version){modelError=e.message;setError(e.message);}}).finally(()=>{if(currentVersion===version)pending--;});}});
      content.position.set(...(scene.position||[0,0,0]));content.rotation.set(...(scene.rotation||[0,0,0]));content.scale.setScalar(scene.scale||1);
      floor.visible=!panorama;floor.position.y=scene.floorHeight||0;floor.material.opacity=scene.floorOpacity??.25;light.intensity=scene.light??3;
      const [width,height]=(scene.size||'1280x720').split('x').map(Number);renderer.setSize(width,height,false);fit();view.aspect=width/height;
      const cam=scene.cameras.find(c=>c.id===scene.activeCamera)||scene.cameras[0];view.position.set(...(panorama?[.001,0,0]:cam.position));controls.target.set(...(panorama?[0,0,0]:cam.target));view.fov=cam.fov;view.updateProjectionMatrix();controls.update();render();
    },select(id,mode){const obj=content.children.find(o=>o.userData.id===id);if(obj&&!panorama)gizmo.attach(obj);else gizmo.detach();gizmo.setMode(mode);render();},background(url){
      const currentBackground=++backgroundVersion;
      texture?.dispose();texture=undefined;world.background=new THREE.Color(theme.mode==='dark'?'#22252e':'#e9edf4');grid.visible=!panorama;
      if(url)new THREE.TextureLoader().load(url,t=>{if(disposed||currentBackground!==backgroundVersion){t.dispose();return;}texture=t;t.colorSpace=THREE.SRGBColorSpace;t.mapping=THREE.EquirectangularReflectionMapping;world.background=t;render();},undefined,()=>setError('背景图片读取失败'));render();
    },async capture(count=1){
      if(pending||modelError)throw Error(modelError||'模型正在加载，请稍候');
      const original=view.position.clone(),target=controls.target.clone(),radius=original.distanceTo(target),results=[];
      gizmo.getHelper().visible=false;grid.visible=false;
      try{for(let i=0;i<count;i++){if(disposed)throw Error('已关闭');if(count>1){const angle=i/count*Math.PI*2;view.position.set(target.x+Math.sin(angle)*radius,original.y,target.z+Math.cos(angle)*radius);view.lookAt(target);}render();const blob=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));if(!blob)throw Error('截图失败');results.push(new Uint8Array(await blob.arrayBuffer()));}if(!disposed)await latest.current.capture(results);}
      finally{view.position.copy(original);view.lookAt(target);gizmo.getHelper().visible=true;grid.visible=!panorama;if(!disposed)render();}
    },cancel(){cancel.current=true;},async record(seconds){
      if(pending||modelError)throw Error(modelError||'模型正在加载，请稍候');
      cancel.current=false;const mime=['video/mp4;codecs=avc1.42001E','video/webm;codecs=vp9','video/webm'].find(s=>MediaRecorder.isTypeSupported(s));if(!mime)throw Error('当前设备不支持视频录制');
      const stream=renderer.domElement.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];let frame;
      gizmo.getHelper().visible=false;grid.visible=false;
      try{
        const finished=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||Error('录制失败'));});
        recorder.start();const started=performance.now();controls.enabled=false;
        await new Promise(resolve=>{const tick=()=>{const progress=Math.min(1,(performance.now()-started)/(seconds*1000)),state=sceneFrame(latest.current.scene,progress*seconds,seconds);view.position.set(...state.camera.position);controls.target.set(...state.camera.target);view.fov=state.camera.fov;view.updateProjectionMatrix();view.lookAt(controls.target);for(const object of state.objects){const mesh=content.children.find(o=>o.userData.id===object.id);if(mesh){mesh.position.set(...object.position);mesh.rotation.set(...object.rotation);mesh.scale.set(...object.scale);mesh.traverse(part=>{if(part.userData.joint)part.rotation.x=object.pose?.[part.userData.joint]||0;});}}render();if(progress>=1||cancel.current||disposed){resolve();return;}frame=requestAnimationFrame(tick);};tick();});
        recorder.stop();await finished;if(!cancel.current&&!disposed)await latest.current.record(new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer()),mime.startsWith('video/mp4')?'mp4':'webm');
      }finally{cancelAnimationFrame(frame);if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(t=>t.stop());controls.enabled=true;gizmo.getHelper().visible=true;grid.visible=!panorama;if(!disposed){api.current.update(latest.current.scene);api.current.select(latest.current.selected,latest.current.transform);render();}}
    }};
    api.current.update(latest.current.scene);
    return ()=>{disposed=true;cancel.current=true;api.current=null;observer.disconnect();controls.dispose();gizmo.dispose();texture?.dispose();for(const promise of models.values())promise.then(dispose).catch(()=>{});dispose(world);renderer.dispose();renderer.domElement.remove();};
  },[panorama,theme.mode]);
  useEffect(()=>{api.current?.update(scene);api.current?.select(selected,transform);},[scene,selected,transform]);
  const background=backgrounds.find(a=>a.id===scene.backgroundId)||backgrounds[0];
  useEffect(()=>{api.current?.background(background?.resource?`tugou-media://original/${background.resource}`:undefined);},[background?.resource,panorama,theme.mode]);
  const run=async fn=>{setError('');try{await fn();}catch(e){setError(e.message);}};
  const importModel=()=>run(async()=>{const model=await window.tugou.importModel();if(!model)return;const current=latest.current,id=object?.kind==='model'?object.id:crypto.randomUUID(),next={id,kind:'model',name:model.name,resource:model.resource,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};current.change({...current.scene,objects:object?.kind==='model'?current.scene.objects.map(o=>o.id===id?{...o,resource:model.resource,name:model.name}:o):[...current.scene.objects,next]});setSelected(id);});
  const captureViews=count=>{setCapturing(true);run(()=>api.current.capture(count)).finally(()=>setCapturing(false));};
  const saveFrame=()=>change({...scene,frames:[...(scene.frames||[]).filter(f=>f.time!==time),{time,objects:structuredClone(scene.objects),camera:structuredClone(camera)}].sort((a,b)=>a.time-b.time)});
  const previewFrame=value=>{setTime(value);const frame=sceneFrame(scene,value,duration);api.current?.update({...scene,objects:frame.objects,cameras:[frame.camera],activeCamera:frame.camera.id});};
  const add=kind=>{const id=crypto.randomUUID();change({...scene,objects:[...scene.objects,{id,kind,name:{character:'角色',box:'方块',sphere:'球体'}[kind],position:[scene.objects.length*1.2,kind==='character'?0:.5,0],rotation:[0,0,0],scale:[1,1,1],color:'#bdb5a4'}]});setSelected(id);};
  return <FormDialog title={panorama?'全景查看':'3D 导演台'} width={1180} close={()=>{if(recording){api.current?.cancel();return;}if(!capturing)close();}}>
    <div className="editor-toolbar" style={{flexWrap:'wrap',marginBottom:12}}>
      {!panorama&&<>{['character','box','sphere'].map(k=><Button key={k} disabled={busy} onClick={()=>add(k)}>添加{{character:'角色',box:'方块',sphere:'球体'}[k]}</Button>)}
        <Button disabled={busy} onClick={importModel}>{object?.kind==='model'?'替换模型':'导入模型'}</Button>
        {['translate','rotate','scale'].map(k=><Button key={k} disabled={busy} aria-pressed={transform===k} onClick={()=>setTransform(k)}>{{translate:'移动',rotate:'旋转',scale:'缩放'}[k]}</Button>)}
        <Button disabled={!object||busy} onClick={()=>{change({...scene,objects:scene.objects.filter(o=>o.id!==selected)});setSelected('');}}>删除物体</Button>
        <Button disabled={busy} onClick={()=>{const id=crypto.randomUUID();change({...scene,cameras:[...scene.cameras,{...camera,id,name:`机位 ${scene.cameras.length+1}`}],activeCamera:id});}}>添加机位</Button>
        <Select aria-label="机位" value={scene.activeCamera} disabled={busy} onChange={e=>change({...scene,activeCamera:e.target.value})}>{scene.cameras.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </>}
      <Button disabled={busy} onClick={()=>captureViews(1)}>{capturing?'正在截图…':'截图送入画布'}</Button>
      {!panorama&&<Select aria-label="多方位截图" disabled={busy} value="" onChange={e=>captureViews(Number(e.target.value))}><option value="">多方位截图</option><option value="4">4 个方位</option><option value="12">12 个方位</option></Select>}
      {!panorama&&<><Input aria-label="录制秒数" type="number" min={1} max={60} style={{width:70}} value={duration} onChange={e=>setDuration(Number(e.target.value))}/><Button disabled={capturing||!recording&&(!Number.isFinite(duration)||duration<1||duration>60)} onClick={()=>{if(recording)api.current?.cancel();else {setRecording(true);run(()=>api.current.record(duration)).finally(()=>setRecording(false));}}}>{recording?'取消录制':'录制机位视频'}</Button></>}
    </div>
    {error&&<p role="alert">{error}</p>}
    <div style={{display:'flex',gap:12,height:'min(56vh,540px)'}}><div ref={host} data-scene-view style={{flex:1,minWidth:0,display:'flex',alignItems:'center',justifyContent:'center'}}/>
    {!panorama&&<aside style={{width:240,overflowY:'auto',paddingRight:6,pointerEvents:busy?'none':undefined,opacity:busy?.6:1}}><label>场景物体<Select aria-label="场景物体" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择物体</option>{scene.objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></label>
    {object&&<><label>名称<Input value={object.name} onChange={e=>patchObject({name:e.target.value})}/></label><label>颜色<ColorControl value={object.color} onChange={e=>patchObject({color:e.target.value})}/></label>{['position','rotation','scale'].map(key=><label key={key}>{{position:'位置',rotation:'旋转（弧度）',scale:'缩放'}[key]}<div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>{object[key].map((value,i)=><Input key={i} aria-label={`${key}-${i}`} type="number" step="0.1" value={value} onChange={e=>{const v=Number(e.target.value);if(!Number.isFinite(v))return;const next=[...object[key]];next[i]=v;patchObject({[key]:next});}}/>)}</div></label>)}</>}
    {object?.kind==='character'&&<details open><summary>角色姿势</summary><label>体型<Select aria-label="角色体型" value={object.body||'adult'} onChange={e=>patchObject({body:e.target.value})}><option value="adult">成人</option><option value="child">儿童</option></Select></label><label>预设<Select aria-label="角色姿势" value="" onChange={e=>patchObject({pose:{...poses[e.target.value]}})}><option value="">选择姿势</option>{Object.keys(poses).map((key,i)=><option key={key} value={key}>{['站立','行走','坐姿','挥手'][i]}</option>)}</Select></label>{Object.entries({leftArm:'左臂',rightArm:'右臂',leftLeg:'左腿',rightLeg:'右腿'}).map(([key,label])=><label key={key}>{label}<Input aria-label={label+'角度'} type="number" step="0.1" value={object.pose?.[key]||0} onChange={e=>patchObject({pose:{...object.pose,[key]:Number(e.target.value)||0}})}/></label>)}</details>}
    <label>镜头视角<Input aria-label="镜头视角" type="number" min={10} max={120} value={camera.fov} onChange={e=>patchCamera({fov:Math.max(10,Math.min(120,Number(e.target.value)||45))})}/></label>
    <details><summary>机位设置</summary><label>名称<Input aria-label="机位名称" value={camera.name} onChange={e=>patchCamera({name:e.target.value})}/></label><VectorField label="机位位置" value={camera.position} change={position=>patchCamera({position})}/><VectorField label="镜头目标" value={camera.target} change={target=>patchCamera({target})}/><Button disabled={scene.cameras.length<2} onClick={()=>change({...scene,cameras:scene.cameras.filter(c=>c.id!==camera.id),activeCamera:scene.cameras.find(c=>c.id!==camera.id).id})}>删除机位</Button></details>
    <details><summary>场景设置</summary><VectorField label="场景位置" value={scene.position||[0,0,0]} change={position=>change({...scene,position})}/><VectorField label="场景旋转" value={scene.rotation||[0,0,0]} change={rotation=>change({...scene,rotation})}/>{[['scale','整体缩放',1,.1,10],['floorHeight','地板高度',0,-100,100],['floorOpacity','地板透明度',.25,0,1],['light','灯光亮度',3,0,10]].map(([key,label,fallback,min,max])=><label key={key}>{label}<Input aria-label={label} type="number" step="0.1" min={min} max={max} value={scene[key]??fallback} onChange={e=>change({...scene,[key]:Math.max(min,Math.min(max,Number(e.target.value)||0))})}/></label>)}<label>输出尺寸<Select aria-label="场景输出尺寸" value={scene.size||'1280x720'} onChange={e=>change({...scene,size:e.target.value})}>{['1280x720','1920x1080','3840x2160','1080x1920','2048x2048'].map(s=><option key={s}>{s}</option>)}</Select></label></details>
    <details><summary>动画轨道</summary><label>时间（秒）<Input aria-label="关键帧时间" type="number" min={0} max={60} step="0.1" value={time} onChange={e=>setTime(Math.max(0,Math.min(60,Number(e.target.value)||0)))}/></label><Button onClick={saveFrame}>保存关键帧</Button><input aria-label="动画预览" type="range" min={0} max={duration} step="0.05" value={time} onChange={e=>previewFrame(Number(e.target.value))}/>{(scene.frames||[]).map(f=><div key={f.time} className="fields"><Button onClick={()=>{setTime(f.time);change({...scene,objects:structuredClone(f.objects),cameras:scene.cameras.map(c=>c.id===camera.id?{...f.camera,id:camera.id}:c)});}}>{f.time} 秒</Button><Button aria-label={`删除 ${f.time} 秒关键帧`} onClick={()=>change({...scene,frames:scene.frames.filter(x=>x.time!==f.time)})}>删除</Button></div>)}</details>
    {backgrounds.length>0&&<label>环境全景<Select aria-label="环境全景" value={background?.id||''} onChange={e=>change({...scene,backgroundId:e.target.value})}>{backgrounds.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>}
    <p className="muted">拖动环视，右键平移，滚轮缩放。双击选物体。录制使用关键帧；未设关键帧时从首机位移动到末机位。</p></aside>}</div>
  </FormDialog>;
}
