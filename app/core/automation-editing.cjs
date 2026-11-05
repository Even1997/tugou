const {randomUUID}=require('node:crypto');
const layers=require('./layers.cjs'),boards=require('./artboards.cjs'),prompts=require('./prompts.cjs');
const taskLabels={
  'paint.create':'新建绘画图层','image.contentFill':'内容识别填充','paint.retouch':'图片修图',
  'selection.color':'色彩选区','selection.grow':'扩展 / 收缩选区','artboard.cropSelection':'裁切画板',
  'layer.adjustmentFromSelection':'局部调整','mask.relink':'重新链接蒙版','gif.create':'GIF 动图制作',
  'artboard.exportAnimation':'画板动画 / 选帧导出','scene.captureAngles':'多方位截图','scene.record':'机位视频录制',
};

function register(define,{string,object,enumeration,ids,find,fail,editable,adjustmentSchema}){
  const num=(min,max)=>({type:'number',minimum:min,maximum:max}),integer=(min,max)=>({...num(min,max),type:'integer'}),bool={type:'boolean'};
  const point=object({x:num(-1e6,1e6),y:num(-1e6,1e6)},['x','y']);
  const references={type:'array',maxItems:64,items:object({assetId:string,role:{type:'string',maxLength:1000}},['assetId'])};
  define('recipe.references','设置配方参考图片、职责和顺序；空数组清空',{id:string,references},['id','references'],'document',(d,a)=>{
    for(const ref of a.references){const asset=find(d.assets,ref.assetId);if(asset.kind&&asset.kind!=='image')fail('INVALID_TARGET','配方参考必须是图片');}
    find(d.recipes,a.id).references=a.references;
  });
  define('prompt.binding','编辑配方或模块/配方节点的单个模块绑定；source 使用源内容，keep 保留本地内容并接受源版本，reset 只清除本地覆盖',{recipeId:string,nodeId:string,moduleId:string,action:enumeration('override','reset','safe','source','keep'),text:{type:'string',maxLength:100000}},['moduleId','action'],'document',(d,a)=>{
    if(!!a.recipeId===!!a.nodeId)fail('INVALID_ARGUMENT','指定 recipeId 或 nodeId 其中之一');
    let list;
    if(a.recipeId){const r=find(d.recipes,a.recipeId);r.moduleBindings=prompts.bindingsFor(d,r);list=r.moduleBindings;}
    else{const n=find(d.tugouCanvas?.nodes||[],a.nodeId);if(n.type==='module')list=[n.data.binding];else if(n.type==='recipe')list=n.data.snapshot.moduleBindings;else fail('INVALID_TARGET','请选择模块或配方节点');}
    const b=list.find(b=>b.moduleId===a.moduleId);if(!b)fail('NOT_FOUND','模块绑定不存在');
    if(a.action==='override'){if(a.text===undefined)fail('INVALID_ARGUMENT','覆盖内容需要 text');b.overrideText=a.text;}
    else if(a.action==='reset')delete b.overrideText;
    else {const next=structuredClone(prompts.refreshBinding(d,b,a.action));for(const key of Object.keys(b))delete b[key];Object.assign(b,next);}
  });
  define('canvas.refreshBinding','刷新模块或配方节点的源绑定，safe 保留冲突，source 使用源内容，keep 保留本地覆盖',{id:string,mode:enumeration('safe','source','keep')},['id'],'document',(d,a)=>{
    const n=find(d.tugouCanvas?.nodes||[],a.id);if(!['module','recipe'].includes(n.type))fail('INVALID_TARGET','请选择绑定节点');Object.assign(n,prompts.refreshNode(d,n,a.mode));
  });
  define('canvas.selectResult','选择节点的一个生成结果，后续连线使用该结果',{id:string,assetId:string},['id','assetId'],'document',(d,a)=>{
    const n=find(d.tugouCanvas?.nodes||[],a.id);find(d.assets,a.assetId);
    if(!(n.data.outputAssetIds||[n.data.outputAssetId]).includes(a.assetId))fail('INVALID_TARGET','素材不属于此节点的结果');n.data.outputAssetId=a.assetId;
  });
  define('canvas.resize','统一设置选中节点显示尺寸；不改素材像素尺寸',{ids,width:integer(160,10000),height:integer(140,10000)},['ids','width','height'],'document',(d,a)=>{
    for(const id of a.ids){const n=find(d.tugouCanvas?.nodes||[],id);Object.assign(n,require('./canvas-view.cjs').resizeAssetNode(n,{...n.position,width:a.width,height:a.height}));}
  });
  define('canvas.duplicate','复制节点、组内子节点和内部连线；重映射内部提示词与输入引用',{ids,offset:point},['ids'],'document',(d,a)=>{
    const g=d.tugouCanvas,selected=new Set(a.ids);a.ids.forEach(id=>find(g?.nodes||[],id));
    let changed=true;while(changed){changed=false;for(const n of g.nodes)if(selected.has(n.parentId)&&!selected.has(n.id)){selected.add(n.id);changed=true;}}
    const mapping=Object.fromEntries([...selected].map(id=>[id,randomUUID()])),remap=id=>mapping[id]||id,offset=a.offset||{x:40,y:40};
    const copies=g.nodes.filter(n=>selected.has(n.id)).map(original=>{
      const n=structuredClone(original);n.id=mapping[n.id];n.selected=false;delete n.measured;delete n.dragging;delete n.resizing;
      if(selected.has(n.parentId))n.parentId=remap(n.parentId);else{n.position={x:n.position.x+offset.x,y:n.position.y+offset.y};}
      for(const k of ['promptNodeId','firstFrameId','lastFrameId'])if(n.data[k])n.data[k]=remap(n.data[k]);
      for(const k of ['text','prompt'])if(typeof n.data[k]==='string')n.data[k]=n.data[k].replace(/@\[node:([^\]]+)\]/g,(_,id)=>`@[node:${remap(id)}]`);
      if(n.data.inputOrder)n.data.inputOrder=n.data.inputOrder.map(remap);
      if(n.data.inputRoles)n.data.inputRoles=Object.fromEntries(Object.entries(n.data.inputRoles).map(([id,role])=>[remap(id),role]));return n;
    });
    g.edges.push(...g.edges.filter(e=>selected.has(e.source)&&selected.has(e.target)).map(e=>({...e,id:randomUUID(),source:remap(e.source),target:remap(e.target)})));g.nodes.push(...copies);return {ids:copies.map(n=>n.id),mapping};
  });
  define('layout.update','设置画板网格、吸附和参考线；参考线位置相对画板',{artboardId:string,patch:object({grid:bool,snap:bool,gridSize:integer(1,10000),guides:{type:'array',maxItems:500,items:object({axis:enumeration('x','y'),position:num(-1e6,1e6)},['axis','position'])}})},['artboardId','patch'],'document',(d,a)=>{
    const b=find(d.layers,a.artboardId);editable(d,[b.id]);if(!b.artboard)fail('INVALID_TARGET','请选择画板');b.layout={...b.layout,...a.patch};
  });
  define('selection.feather','设置当前选区羽化半径',{artboardId:string,radius:num(0,1000)},['artboardId','radius'],'document',(d,a)=>{
    const b=find(d.layers,a.artboardId);editable(d,[b.id]);if(!b.artboard||!b.selection)fail('INVALID_TARGET','请先创建选区');b.selection.feather=a.radius;
  });
  define('mask.link','链接蒙版跟随图层，或解除链接固定世界坐标；保持当前外观',{id:string,linked:bool},['id','linked'],'document',(d,a)=>{
    editable(d,[a.id]);const l=find(d.layers,a.id);if(!l.mask)fail('INVALID_TARGET','请先创建蒙版');
    if(a.linked&&l.mask.anchor)fail('INVALID_TARGET','独立蒙版请先用 mask.relink 固化后重新链接');
    if(!a.linked&&!l.mask.anchor)l.mask.anchor={matrix:layers.worldMatrix(d.layers,l),width:l.width,height:l.height,...(l.warp?{warp:[...l.warp]}:{})};
  });
  define('mask.transform','移动或缩放解除链接的蒙版；坐标相对所属画板',{id:string,matrix:{type:'array',items:num(-1e6,1e6),minItems:6,maxItems:6},width:integer(1,100000),height:integer(1,100000)},['id','matrix','width','height'],'document',(d,a)=>{
    editable(d,[a.id]);const l=find(d.layers,a.id);if(!l.mask?.anchor)fail('INVALID_TARGET','请先解除蒙版链接');layers.inverse(a.matrix);
    const b=boards.owner(d,a.id),local=boards.extract(d,b.id);local.layers.find(l=>l.id===a.id).mask.anchor={...l.mask.anchor,matrix:a.matrix,width:a.width,height:a.height};return {document:boards.replace(d,b.id,local)};
  });
  const task=(name,desc,props,required)=>define(name,desc+'；返回任务 ID，task.result 读取结果，task.cancel 取消。文档变化时拒绝写回',{...props,requestId:string},[...required,'requestId'],'rendererTask');
  task('paint.create','创建透明绘画图层',{artboardId:string,name:string},['artboardId']);
  task('image.contentFill','在图片图层当前选区内执行内容识别填充',{id:string},['id']);
  task('paint.retouch','仿制、修复、模糊、涂抹或液化；点为画板坐标，source 为原图归一化坐标',{id:string,tool:enumeration('clone','heal','blur','smudge','liquify'),points:{type:'array',minItems:1,maxItems:256,items:object({x:num(-1e6,1e6),y:num(-1e6,1e6),pressure:num(0,1)},['x','y'])},source:object({u:num(0,1),v:num(0,1)},['u','v']),size:num(2,1000),opacity:num(1,100),hardness:num(0,100),smoothing:num(0,100),pressure:bool,blurRadius:num(1,100)},['id','tool','points','size']);
  task('selection.color','魔棒或色彩范围选区；contiguous 为 true 只选连续区域，id 省略时采样画板合成',{artboardId:string,id:string,x:integer(0,100000),y:integer(0,100000),tolerance:num(0,255),contiguous:bool,operation:enumeration('replace','add','subtract','intersect')},['artboardId','x','y']);
  task('selection.grow','扩展或收缩选区，正数扩展、负数收缩',{artboardId:string,radius:integer(-100,100)},['artboardId','radius']);
  task('artboard.cropSelection','按当前选区边界裁切画板',{artboardId:string},['artboardId']);
  task('layer.adjustmentFromSelection','新建调整图层并把选区作为蒙版',{artboardId:string,name:string,adjustment:adjustmentSchema},['artboardId','adjustment']);
  task('mask.relink','固化独立蒙版并重新链接，保持当前外观',{id:string},['id']);
  task('gif.create','将有序图片合并为 GIF 素材；重复素材可重复使用，时长单位毫秒',{name:string,frames:{type:'array',minItems:1,maxItems:240,items:object({assetId:string,delay:{...integer(10,655350),multipleOf:10}},['assetId','delay'])},width:integer(1,4096),height:integer(1,4096),loop:enumeration(0,1)},['frames','width','height']);
  task('artboard.exportAnimation','导出画板 GIF 或指定帧 PNG；帧号从 1 起，输出到会话文件根目录且不覆盖',{artboardId:string,path:string,format:enumeration('gif','png'),frame:integer(1,240),startFrame:integer(1,240),endFrame:integer(1,240),loop:enumeration(0,1)},['artboardId','path','format']);
  task('scene.captureAngles','围绕当前机位目标拍摄 4 或 12 个方位，生成独立素材和连线结果节点',{nodeId:string,count:enumeration(4,12),maxSize:integer(64,2048)},['nodeId','count']);
  task('scene.record','录制导演台关键帧动画为视频素材，时长 1–60 秒；支持取消',{nodeId:string,duration:num(1,60),maxSize:integer(64,2048)},['nodeId','duration']);
  define('artboard.timeline','读取画板 GIF 合成时间轴，返回从 1 起的帧号和毫秒时间',{artboardId:string},['artboardId'],'read');
  define('task.result','读取当前工程 MCP 本地处理任务的结果',{id:string},['id'],'read');
  define('asset.search','按素材来源、形状和名称筛选，可按时间/名称/像素排序',{query:{type:'string',maxLength:256},source:enumeration('all','processed','generated','imported'),shape:enumeration('all','portrait','landscape','square'),sort:enumeration('newest','oldest','name','pixels'),offset:integer(0,1000000),limit:integer(1,100)},[],'read');
  define('project.importLegacy','从会话文件目录导入旧版工程及相邻 resources 目录，不切换当前工程',{path:string},['path'],'file');
  define('project.migrateCanvas','导入历史画布快照 JSON 文件（state 和 images），保留原始归档；不切换工程',{path:string},['path'],'file');
}
module.exports={register,taskLabels};
