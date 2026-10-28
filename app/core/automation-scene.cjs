const randomUUID=()=>crypto.randomUUID();
const {sceneFrame}=require('./scene-animation.cjs');
const {createNode}=require('./prompts.cjs');
const {outputPosition,outputEdge}=require('./generation-output.cjs');

function sceneNode(document,id){
  const node=document.tugouCanvas?.nodes.find(n=>n.id===id);
  if(!node||node.type!=='director'||!node.data.scene){const e=Error('请选择存在的 3D 导演台节点');e.code='INVALID_TARGET';throw e;}
  return node;
}
function appendCapture(document,nodeId,asset){
  const next=structuredClone(document),source=sceneNode(next,nodeId),graph=next.tugouCanvas;
  next.assets.push(asset);const node=createNode(next,'asset',asset.id,outputPosition(graph.nodes,source));
  node.data.sourceNodeId=nodeId;graph.nodes.push(node);outputEdge(graph.edges,source,node.id);
  Object.assign(source.data,{outputAssetId:asset.id,outputAssetIds:[asset.id]});return {document:next,nodeId:node.id,assetId:asset.id};
}
function register(define,{string,object,enumeration,find,fail}){
  const range=(minimum,maximum)=>({type:'number',minimum,maximum});
  const vector={type:'array',items:range(-1000000,1000000),minItems:3,maxItems:3};
  const scale={...vector,items:range(.001,1000)},time=range(0,60),hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
  const pose=object(Object.fromEntries(['leftArm','rightArm','leftLeg','rightLeg'].map(k=>[k,range(-Math.PI*2,Math.PI*2)])));
  const objectProps={name:string,position:vector,rotation:vector,scale,color:hex,body:enumeration('adult','child'),pose};
  const cameraProps={name:string,position:vector,target:vector,fov:range(10,120)};
  const scene=(d,a)=>sceneNode(d,a.nodeId).data.scene;
  const cameraValid=c=>{if(Math.hypot(...c.position.map((v,i)=>v-c.target[i]))<.0001)fail('INVALID_ARGUMENT','机位位置不能与镜头目标重合');};
  const fieldsValid=(o,patch)=>{if(o.kind!=='character'&&(patch.pose||patch.body))fail('INVALID_TARGET','只有角色支持姿势和体型');};
  const change=(name,description,props,required,fn)=>define('scene.'+name,description,{nodeId:string,...props},['nodeId',...required],'document',fn);
  change('update','设置导演台场景、灯光、地板及输出尺寸；backgroundId 为已导入图片 ID，空字符串清除背景',{patch:object({position:vector,rotation:vector,scale:range(.1,10),floorHeight:range(-100,100),floorOpacity:range(0,1),light:range(0,10),size:enumeration('1280x720','1920x1080','3840x2160','1080x1920','2048x2048'),backgroundId:{type:'string',maxLength:256}})},['patch'],(d,a)=>{
    const s=scene(d,a);if(a.patch.backgroundId){const asset=find(d.assets,a.patch.backgroundId);if(asset.kind&&asset.kind!=='image')fail('INVALID_TARGET','场景背景必须是图片');}Object.assign(s,a.patch);
  });
  change('object.create','添加方块、球体、角色或已导入模型；位置采用 3D 世界单位，旋转为弧度',{kind:enumeration('box','sphere','character','model'),properties:object({...objectProps,resource:{type:'string',pattern:'^[a-f0-9]{64}\\.(obj|fbx)$'}})},['kind'],(d,a)=>{
    const s=scene(d,a),p=a.properties||{};if(a.kind==='model'?!p.resource:!!p.resource)fail('INVALID_ARGUMENT','模型必须指定已导入 resource，其他物体不能指定 resource');
    const o={id:randomUUID(),kind:a.kind,name:{box:'方块',sphere:'球体',character:'角色',model:'模型'}[a.kind],position:[0,a.kind==='character'?0:.5,0],rotation:[0,0,0],scale:[1,1,1],color:'#bdb5a4',...p};fieldsValid(o,p);s.objects.push(o);return {id:o.id};
  });
  change('object.update','修改物体变换、颜色或角色姿势；不改已保存关键帧',{id:string,patch:object(objectProps)},['id','patch'],(d,a)=>{const o=find(scene(d,a).objects,a.id);fieldsValid(o,a.patch);Object.assign(o,a.patch);});
  change('object.duplicate','复制物体，返回新 ID',{id:string},['id'],(d,a)=>{const s=scene(d,a),o={...structuredClone(find(s.objects,a.id)),id:randomUUID()};s.objects.push(o);return {id:o.id};});
  change('object.delete','删除物体，同时从所有关键帧移除，防止动画中重新出现',{id:string},['id'],(d,a)=>{const s=scene(d,a);find(s.objects,a.id);s.objects=s.objects.filter(o=>o.id!==a.id);for(const f of s.frames||[])f.objects=f.objects.filter(o=>o.id!==a.id);});
  change('camera.create','添加机位；未填属性继承当前机位，新机位不会自动激活',{properties:object(cameraProps)},[],(d,a)=>{const s=scene(d,a),c={...structuredClone(find(s.cameras,s.activeCamera)),id:randomUUID(),name:`机位 ${s.cameras.length+1}`,...a.properties};cameraValid(c);s.cameras.push(c);return {id:c.id};});
  change('camera.update','编辑机位位置、目标、视角；不改已保存关键帧',{id:string,patch:object(cameraProps)},['id','patch'],(d,a)=>{const c=find(scene(d,a).cameras,a.id);Object.assign(c,a.patch);cameraValid(c);});
  change('camera.activate','切换当前截图机位',{id:string},['id'],(d,a)=>{const s=scene(d,a);find(s.cameras,a.id);s.activeCamera=a.id;});
  change('camera.delete','删除机位，至少保留一个；关键帧保留已拍摄的相机快照',{id:string},['id'],(d,a)=>{const s=scene(d,a);find(s.cameras,a.id);if(s.cameras.length===1)fail('INVALID_TARGET','至少保留一个机位');s.cameras=s.cameras.filter(c=>c.id!==a.id);if(s.activeCamera===a.id)s.activeCamera=s.cameras[0].id;});
  change('frame.set','把当前物体及激活机位保存为关键帧；同一时间覆盖',{time},['time'],(d,a)=>{const s=scene(d,a);s.frames=[...(s.frames||[]).filter(f=>f.time!==a.time),{time:a.time,objects:structuredClone(s.objects),camera:structuredClone(find(s.cameras,s.activeCamera))}].sort((a,b)=>a.time-b.time);});
  change('frame.delete','删除指定时间的关键帧',{time},['time'],(d,a)=>{const s=scene(d,a);if(!s.frames?.some(f=>f.time===a.time))fail('NOT_FOUND','关键帧不存在');s.frames=s.frames.filter(f=>f.time!==a.time);});
  change('frame.apply','将动画插值结果应用到当前物体和激活机位；可撤销，不改关键帧',{time,duration:range(.1,60)},['time'],(d,a)=>{const s=scene(d,a),f=sceneFrame(s,a.time,a.duration||5),c=find(s.cameras,s.activeCamera);s.objects=f.objects;Object.assign(c,{...f.camera,id:c.id});});
  define('scene.model.import','从会话文件目录导入 OBJ/FBX 并添加到导演台；不访问外部模型依赖',{nodeId:string,path:string,properties:object(objectProps)},['nodeId','path'],'file');
  const renderArgs={nodeId:string,cameraId:string,time,duration:range(.1,60),maxSize:{type:'integer',minimum:64,maximum:2048}};
  define('scene.preview','只读渲染导演台 PNG；省略 time 使用当前场景和机位，指定 time 使用动画插值；cameraId 显式覆盖动画机位',renderArgs,['nodeId'],'read');
  define('scene.capture','将当前机位或动画帧截图加入素材并在导演台右侧创建连线结果节点；一次撤销',{...renderArgs,name:string},['nodeId'],'resourceEdit');
}
module.exports={register,sceneNode,appendCapture};
