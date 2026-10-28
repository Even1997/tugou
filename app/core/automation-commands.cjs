const Ajv = require('ajv');
const {randomUUID} = require('node:crypto');
const layers = require('./layers.cjs');
const boards = require('./artboards.cjs');
const prompts = require('./prompts.cjs');
const {validateDocument} = require('./storage.cjs');

const string = {type:'string',minLength:1,maxLength:256};
const text = {type:'string',maxLength:100000};
const number = {type:'number',minimum:-1000000,maximum:1000000};
const size = {type:'integer',minimum:1,maximum:100000};
const bool = {type:'boolean'};
const enumeration = (...values) => ({enum:values});
const object = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
const ids = {type:'array',items:string,minItems:1,maxItems:500,uniqueItems:true};
const point = object({x:number,y:number},['x','y']);
const color = {type:'string',pattern:'^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$',maxLength:20};
const transform = {name:string,x:number,y:number,width:size,height:size,rotation:number,opacity:{type:'number',minimum:0,maximum:1},visible:bool,locked:bool,flipX:bool,flipY:bool};
const layerProps = {...transform,text,color,fill:bool,stroke:color,strokeWidth:{type:'number',minimum:0,maximum:1000},fontSize:{type:'number',minimum:1,maximum:1000},fontFamily:string,fontWeight:{type:'integer',minimum:1,maximum:1000},fontResource:{anyOf:[{type:'null'},object({resource:{type:'string',pattern:'^[a-f0-9]{64}\\.ttf$'},projectId:string,jobId:string},['resource','projectId','jobId'])]},fontStyle:enumeration('normal','bold','italic','bold italic'),align:enumeration('left','center','right'),shape:enumeration('rect','rounded','ellipse','triangle','diamond','star'),radius:{type:'number',minimum:0,maximum:10000},blend:enumeration('source-over','multiply','screen','overlay','darken','lighten','difference','exclusion'),assetId:string};
const nodeProps = {name:string,text,prompt:text,model:{type:'string',maxLength:512},size:string,count:{type:'integer',minimum:1,maximum:15},mode:enumeration('image','text'),quality:string,negativePrompt:text,role:string,inputOrder:{type:'array',items:string,maxItems:500,uniqueItems:true}};
Object.assign(nodeProps,{camera:text,excludeUpstreamText:bool,resultText:text,inputRoles:{type:'object',maxProperties:500,propertyNames:{maxLength:256},additionalProperties:{type:'string',maxLength:1000}}});
const catalog = new Map(), ajv = new Ajv({allErrors:true});
function define(name,description,properties={},required=[],effect='document',apply) {
  const inputSchema=object(properties,required);
  catalog.set(name,{name,description,effect,inputSchema,validate:ajv.compile(inputSchema),apply});
}
function fail(code,message) {const e=new Error(message);e.code=code;throw e;}
function find(list,id) {const found=list.find(v=>v.id===id);if(!found)fail('NOT_FOUND',`对象不存在：${id}`);return found;}
function imageAsset(doc,id){const asset=find(doc.assets,id);if(asset.kind&&asset.kind!=='image')fail('INVALID_TARGET','合成图片图层仅接受图片素材');return asset;}
function editable(doc,ids) {
  for(const id of ids){const layer=find(doc.layers,id);if(layers.inherited(doc.layers,layer,'locked'))fail('LOCKED',`图层已锁定：${id}`);}
}
function contentLayers(doc,ids){editable(doc,ids);if(ids.some(id=>find(doc.layers,id).artboard))fail('INVALID_TARGET','画板请使用 artboard 命令');}
const layerArgs={ids};
define('project.rename','修改当前工程名称',{name:string},['name'],'document',(d,a)=>{d.name=a.name;});
define('prompt.create','新建提示词模块',{name:string,kind:string,text,global:bool},['name','text'],'document',(d,a)=>{const item={id:randomUUID(),kind:'custom',...a,revision:1};d.modules.push(item);return {id:item.id};});
define('prompt.update','编辑模块并保留引用版本语义',{id:string,patch:object({name:string,kind:string,text,global:bool})},['id','patch'],'document',(d,a)=>{find(d.modules,a.id);return {document:prompts.editModule(d,a.id,a.patch)};});
define('prompt.delete','删除模块；引用按现有应用规则保留快照',{id:string},['id'],'document',(d,a)=>{find(d.modules,a.id);return {document:prompts.removeModule(d,a.id)};});
define('prompt.sync','同步全局模块和配方引用',{},[],'document',d=>({document:prompts.syncAll(d)}));
define('recipe.create','创建配方',{name:string,moduleIds:{type:'array',items:string,maxItems:500},output:text,size:string},['name'],'document',(d,a)=>{for(const id of a.moduleIds||[])find(d.modules,id);const r=prompts.pinRecipe(d,{...prompts.newRecipe(),...a});d.recipes.push(r);return {id:r.id};});
define('recipe.update','修改配方及模块绑定',{id:string,patch:object({name:string,moduleIds:{type:'array',items:string,maxItems:500},output:text,size:string})},['id','patch'],'document',(d,a)=>{const r=find(d.recipes,a.id);for(const id of a.patch.moduleIds||[])find(d.modules,id);Object.assign(r,prompts.pinRecipe(d,{...r,...a.patch}));});
define('recipe.delete','删除配方，已有节点保留快照',{id:string},['id'],'document',(d,a)=>{find(d.recipes,a.id);d.recipes=d.recipes.filter(r=>r.id!==a.id);});
define('canvas.create','创建节点；坐标相对于无限画布',{type:enumeration('text','asset','module','recipe','config','textgen','image','director'),sourceId:string,position:point,properties:object(nodeProps)},['type','position'],'document',(d,a)=>{d.tugouCanvas||=prompts.emptyCanvas();const n=prompts.createNode(d,a.type,a.sourceId,a.position);Object.assign(n.data,a.properties);d.tugouCanvas.nodes.push(n);return {id:n.id};});
define('canvas.update','修改节点位置或生成参数',{id:string,position:point,properties:object(nodeProps)},['id'],'document',(d,a)=>{const n=find(d.tugouCanvas?.nodes||[],a.id);if(a.position)n.position=a.position;Object.assign(n.data,a.properties);});
define('canvas.connect','连接两个节点，拒绝环和重复连线',{source:string,target:string},['source','target'],'document',(d,a)=>{if(!prompts.canConnect(d.tugouCanvas,a.source,a.target))fail('INVALID_LINK','不可连接这些节点');const edge={id:randomUUID(),...a};d.tugouCanvas.edges.push(edge);return {id:edge.id};});
define('canvas.disconnect','删除指定连线',{id:string},['id'],'document',(d,a)=>{find(d.tugouCanvas?.edges||[],a.id);d.tugouCanvas.edges=d.tugouCanvas.edges.filter(e=>e.id!==a.id);});
define('canvas.delete','删除节点及相连连线；删除组同时删除其子节点',layerArgs,['ids'],'document',(d,a)=>{const g=d.tugouCanvas;for(const id of a.ids)find(g?.nodes||[],id);const removed=new Set(a.ids);let changed=true;while(changed){changed=false;for(const n of g.nodes)if(removed.has(n.parentId)&&!removed.has(n.id)){removed.add(n.id);changed=true;}}g.nodes=g.nodes.filter(n=>!removed.has(n.id));g.edges=g.edges.filter(e=>!removed.has(e.source)&&!removed.has(e.target));});
define('canvas.group','组合至少两个根节点',layerArgs,['ids'],'document',(d,a)=>{for(const id of a.ids)find(d.tugouCanvas?.nodes||[],id);const old=new Set(d.tugouCanvas.nodes.map(n=>n.id));d.tugouCanvas.nodes=require('./canvas-groups.cjs').groupNodes(d.tugouCanvas.nodes,a.ids);const added=d.tugouCanvas.nodes.find(n=>!old.has(n.id));if(!added)fail('INVALID_TARGET','请选择至少两个未分组节点');return {id:added.id};});
define('canvas.ungroup','解除节点组合',{id:string},['id'],'document',(d,a)=>{if(find(d.tugouCanvas?.nodes||[],a.id).type!=='group')fail('INVALID_TARGET','请选择节点组');d.tugouCanvas.nodes=require('./canvas-groups.cjs').ungroupNodes(d.tugouCanvas.nodes,a.id);});
define('canvas.arrange','排列选中的节点',{ids,mode:enumeration('flow','grid','left','top','horizontal','vertical')},['ids','mode'],'document',(d,a)=>{for(const id of a.ids)find(d.tugouCanvas?.nodes||[],id);d.tugouCanvas.nodes=require('./canvas-layout.cjs').arrangeNodes(d.tugouCanvas.nodes,a.ids,a.mode,d.tugouCanvas.edges);});
define('canvas.viewport','设置画布视口',{x:number,y:number,zoom:{type:'number',minimum:.05,maximum:4}},['x','y','zoom'],'document',(d,a)=>{d.tugouCanvas||=prompts.emptyCanvas();d.tugouCanvas.viewport=a;});
define('artboard.create','新建画板并返回 ID；自动放在已有画板右侧',{name:string,width:size,height:size},['name','width','height'],'document',(d,a)=>boards.create(boards.normalize(d),a));
define('artboard.update','修改画板名称、位置、尺寸、背景',{id:string,patch:object({name:string,x:number,y:number,width:size,height:size,background:color,clipContent:bool}),scaleContent:bool},['id','patch'],'document',(d,a)=>({document:boards.update(boards.normalize(d),a.id,a.patch,{scaleContent:a.scaleContent})}));
define('artboard.duplicate','复制整个画板',{id:string},['id'],'document',(d,a)=>boards.duplicate(d,a.id));
define('artboard.delete','删除画板及内容，至少保留一个',{id:string},['id'],'document',(d,a)=>{find(boards.boards(d),a.id);return {document:boards.remove(d,a.id)};});
define('layer.create','在指定画板内创建文字、形状或图片，坐标相对画板',{artboardId:string,kind:enumeration('text','shape','image'),properties:object(layerProps)},['artboardId','kind'],'document',(d,a)=>{const n=boards.normalize(d),b=find(n.layers,a.artboardId);editable(n,[b.id]);if(!b.artboard)fail('INVALID_TARGET','必须指定画板');if(a.kind==='image')imageAsset(d,a.properties?.assetId);const l=layers.createLayer(a.kind,{text:'文字',color:'#aebcf2',fill:true,shape:'rect',fontSize:48,radius:a.properties?.shape==='rounded'?24:0,...a.properties,parentId:b.id});n.layers.push(l);return {document:n,id:l.id};});
define('layer.update','修改图层属性；坐标相对于父级。锁定图层须先解锁',{id:string,patch:object(layerProps)},['id','patch'],'document',(d,a)=>{const l=find(d.layers,a.id);if(l.artboard)fail('INVALID_TARGET','画板请使用 artboard.update');if(Object.keys(a.patch).length===1&&a.patch.locked===false){if(l.parentId)editable(d,[l.parentId]);}else editable(d,[a.id]);if(a.patch.assetId)imageAsset(d,a.patch.assetId);if(a.patch.fontFamily&&!Object.hasOwn(a.patch,'fontResource'))delete l.fontResource;Object.assign(l,a.patch);});
define('layer.replaceImage','替换图片素材并清除旧像素编辑，保留尺寸、变换、蒙版、层级与特效',{id:string,assetId:string},['id','assetId'],'document',(d,a)=>{
  editable(d,[a.id]);const l=find(d.layers,a.id);if(l.kind!=='image')fail('INVALID_TARGET','请选择图片图层');imageAsset(d,a.assetId);l.assetId=a.assetId;delete l.bitmap;
});
for(const [name,description,handler] of [
  ['delete','删除图层及子层',(d,a)=>{if(a.ids.some(id=>find(d.layers,id).artboard))fail('INVALID_TARGET','画板请使用 artboard.delete');d.layers=layers.deleteLayers(d.layers,a.ids);} ],
  ['duplicate','复制图层',(d,a)=>{const r=layers.duplicateLayers(d.layers,a.ids);d.layers=r.layers;return {ids:r.ids};}],
  ['group','组合图层',(d,a)=>{const r=layers.groupLayers(d.layers,a.ids);d.layers=r.layers;return {ids:r.ids};}],
])define('layer.'+name,description,layerArgs,['ids'],'document',(d,a)=>{contentLayers(d,a.ids);return handler(d,a);});
define('layer.ungroup','解除图层组合',{id:string},['id'],'document',(d,a)=>{editable(d,[a.id]);if(find(d.layers,a.id).artboard)fail('INVALID_TARGET','不能解除画板');const result=layers.ungroupLayers(d.layers,a.id);d.layers=result.layers;return {ids:result.ids};});
define('layer.move','以世界坐标增量移动图层',{ids,dx:number,dy:number},['ids','dx','dy'],'document',(d,a)=>{contentLayers(d,a.ids);d.layers=layers.moveLayers(d.layers,a.ids,a.dx,a.dy);});
define('layer.reorder','调整图层顺序',{ids,action:enumeration('top','bottom','up','down')},['ids','action'],'document',(d,a)=>{editable(d,a.ids);d.layers=layers.reorder(d.layers,a.ids,a.action);});
define('layer.reparent','将图层移动到画板或分组',{ids,targetId:string},['ids','targetId'],'document',(d,a)=>{editable(d,[...a.ids,a.targetId]);return {document:boards.relocate(d,a.ids,a.targetId)};});
define('layer.align','按选中图层边界对齐；单层相对于所属画板对齐',{ids,axis:enumeration('x','y'),mode:enumeration('start','center','end')},['ids','axis','mode'],'document',(d,a)=>{
  contentLayers(d,a.ids);const board=boards.owner(d,a.ids[0]);if(!board||a.ids.some(id=>boards.owner(d,id)?.id!==board.id))fail('INVALID_TARGET','请选择同一画板内的图层');
  const local=boards.extract(d,board.id);return {document:boards.replace(d,board.id,{...local,layers:layers.alignLayers(local,a.ids,a.axis,a.mode)})};
});
define('layer.distribute','均匀分布至少三个图层',{ids,axis:enumeration('x','y')},['ids','axis'],'document',(d,a)=>{editable(d,a.ids);if(a.ids.length<3)fail('INVALID_TARGET','至少选择三个图层');d.layers=layers.distributeLayers(d.layers,a.ids,a.axis);});
define('selection.polygon','创建自由多边形选区；坐标相对画板，可加减或相交',{artboardId:string,points:{type:'array',items:number,minItems:6,maxItems:20000},operation:enumeration('replace','add','subtract','intersect')},['artboardId','points'],'document',(d,a)=>{if(a.points.length%2)fail('INVALID_ARGUMENT','坐标必须为 x,y 配对');const b=find(d.layers,a.artboardId);if(!b.artboard)fail('INVALID_TARGET','必须指定画板');editable(d,[b.id]);if(b.selection?.inverted&&a.operation&&a.operation!=='replace')fail('INVALID_TARGET','反选后请先用 selection.rasterize 固化选区');const s=a.operation&&a.operation!=='replace'?b.selection||{}:{};b.selection={...s,paths:[...(s.paths||[]),{points:a.points,operation:a.operation||'add'}]};});
define('selection.rectangle','创建矩形选区',{artboardId:string,x:number,y:number,width:size,height:size},['artboardId','x','y','width','height'],'document',(d,a)=>{const {x,y,width:w,height:h}=a;return catalog.get('selection.polygon').apply(d,{artboardId:a.artboardId,points:[x,y,x+w,y,x+w,y+h,x,y+h]});});
for(const name of ['clear','invert'])define('selection.'+name,name==='clear'?'取消选区':'反向选择',{artboardId:string},['artboardId'],'document',(d,a)=>{const b=find(d.layers,a.artboardId);if(!b.artboard)fail('INVALID_TARGET','必须指定画板');editable(d,[b.id]);if(name==='clear')delete b.selection;else{if(!b.selection)fail('INVALID_TARGET','没有选区');b.selection={...b.selection,inverted:!b.selection.inverted};}});
define('mask.create','添加全白可见蒙版，不覆盖已有蒙版',{id:string},['id'],'document',(d,a)=>{contentLayers(d,[a.id]);const l=find(d.layers,a.id);if(l.mask)fail('INVALID_TARGET','已存在蒙版');l.mask={x:0,y:0,width:1,height:1};});
define('mask.update','设置蒙版启停、反相、浓度、羽化',{id:string,patch:object({disabled:bool,inverted:bool,density:{type:'number',minimum:0,maximum:100},feather:{type:'number',minimum:0,maximum:1000}})},['id','patch'],'document',(d,a)=>{editable(d,[a.id]);const l=find(d.layers,a.id);if(!l.mask)fail('INVALID_TARGET','没有蒙版');Object.assign(l.mask,a.patch);});
define('mask.delete','移除蒙版并保留原始图像',{id:string},['id'],'document',(d,a)=>{editable(d,[a.id]);delete find(d.layers,a.id).mask;});
define('asset.rename','修改素材名称',{id:string,name:string},['id','name'],'document',(d,a)=>{find(d.assets,a.id).name=a.name;});
define('asset.delete','移除未被引用的素材；保留磁盘原文件，可撤销',{ids},['ids'],'document',(d,a)=>{
  a.ids.forEach(id=>find(d.assets,id));const {assets,...content}=d,source=JSON.stringify(content);
  if(a.ids.some(id=>source.includes(JSON.stringify(id))))fail('IN_USE','素材仍被图层、画布或配方引用，请先解除引用');
  d.assets=assets.filter(asset=>!a.ids.includes(asset.id));
});
define('layer.lock','锁定或解锁图层、分组或画板',{id:string,locked:bool},['id','locked'],'document',(d,a)=>{const l=find(d.layers,a.id);if(l.parentId)editable(d,[l.parentId]);l.locked=a.locked;});

const adjustments=require('./adjustments.cjs'),effects=require('./effects.cjs');
const ranges=fields=>Object.fromEntries(Object.entries(fields).map(([key,[,,minimum,maximum]])=>[key,{type:'number',minimum,maximum}]));
const adjustmentSchema={oneOf:Object.entries(adjustments.fields).map(([type,spec])=>object({type:{const:type},...ranges(spec.values),
  ...(type==='curves'?{channels:object(Object.fromEntries(['rgb','red','green','blue'].map(k=>[k,{type:'array',minItems:2,maxItems:32,items:{type:'array',items:{type:'number',minimum:0,maximum:255},minItems:2,maxItems:2}}])),['rgb','red','green','blue'])}:{}),
  ...(type==='gradientMap'?{dark:color,light:color}:{}),...(type==='colorBalance'?{range:enumeration('shadows','midtones','highlights'),preserveLightness:bool}:{}),
  ...(['noise','grain'].includes(type)?{monochrome:bool,seed:{type:'integer',minimum:0,maximum:1000000}}:{})},['type']))};
define('layer.adjustment','新建或更新调整图层；未填参数使用该类型默认值',{artboardId:string,id:string,name:string,adjustment:adjustmentSchema},['artboardId','adjustment'],'document',(d,a)=>{
  const normalized=boards.normalize(d),board=find(normalized.layers,a.artboardId);editable(normalized,[board.id]);if(!board.artboard)fail('INVALID_TARGET','必须指定画板');
  const adjustment={...adjustments.defaults(a.adjustment.type),...a.adjustment};adjustments.validateAdjustment(adjustment);
  if(a.id){editable(normalized,[a.id]);const l=find(normalized.layers,a.id);if(l.kind!=='adjustment'||boards.owner(normalized,l.id)?.id!==board.id)fail('INVALID_TARGET','调整图层不属于指定画板');Object.assign(l,{adjustment,...(a.name?{name:a.name}:{})});return {document:normalized,id:l.id};}
  const l=layers.createLayer('adjustment',{name:a.name||adjustments.fields[adjustment.type].label,x:0,y:0,width:board.width,height:board.height,parentId:board.id,adjustment});normalized.layers.push(l);return {document:normalized,id:l.id};
});
define('layer.effects','设置图层完整特效列表；空列表清除特效',{id:string,effects:{type:'array',maxItems:12,items:{oneOf:Object.entries(effects.types).map(([type,spec])=>object({type:{const:type},enabled:bool,color,opacity:{type:'number',minimum:0,maximum:100},blend:enumeration(...effects.blends),...ranges(spec.values)},['type']))}}},['id','effects'],'document',(d,a)=>{
  editable(d,[a.id]);const l=find(d.layers,a.id);l.effects=a.effects.map(e=>({...effects.defaults(e.type),...e}));l.effects.forEach(effects.validateEffect);
});

// Non-transactional commands have explicit effects; a batch cannot hide file or network writes.
define('project.list','列出已保存工程',{},[],'read');
define('project.create','创建并打开工程；有未保存修改时拒绝',{name:string},['name'],'session');
define('project.open','打开已保存工程；有未保存修改时拒绝',{id:string},['id'],'session');
define('project.save','保存当前实时文档，使用磁盘版本检查',{},[],'session');
define('history.undo','撤销一次编辑或整个批次',{},[],'session');
define('history.redo','重做一次编辑或整个批次',{},[],'session');
define('workspace.show','切换工作区',{workspace:enumeration('canvas','layers','prompts','assets','tools','fonts'),layerIds:ids},['workspace'],'session');
define('models.status','读取供应商及模型可用状态；不返回 Key',{},[],'read');
define('tools.status','读取本地图像工具与主体识别组件状态',{},[],'read');
define('canvas.compile','预览节点最终提示词和输入引用',{id:string},['id'],'read');
define('generation.start','提交生成任务；同 requestId 不会重复提交。可能产生费用',{nodeId:string,requestId:string},['nodeId','requestId'],'network');
define('analysis.start','对素材执行视觉分析。可能产生费用',{assetId:string,instruction:text,requestId:string},['assetId','instruction','requestId'],'network');
define('analysis.results','读取当前工程的视觉分析草稿、模块及不确定项',{},[],'read');
define('analysis.apply','把分析草稿加入提示词模块，可选创建配方；一次撤销。useReview 显式应用已保存的审阅内容',{id:string,useReview:bool,moduleIndices:{type:'array',minItems:1,maxItems:40,uniqueItems:true,items:{type:'integer',minimum:0,maximum:39}},createRecipe:bool,recipeName:string,reference:bool},['id'],'resourceEdit');
const cloudDefaults=require('./cloud-settings.cjs').cloudDefaults;
define('cloud.process','提交云端增强、放大、局部编辑、扩图或单类别拆分；可能产生费用',{assetId:string,requestId:string,settings:{oneOf:Object.entries(cloudDefaults).map(([operation,defaults])=>object({operation:{const:operation},...Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof v==='number'?number:typeof v==='boolean'?bool:k==='instruction'?text:{type:'string',maxLength:512}]))},['operation']))}},['assetId','requestId','settings'],'network');
define('cloud.review','读取云端原始结果和待确认原因',{id:string},['id'],'read');
define('cloud.resolve','处理待确认的云端结果；复用已返回图，不再次请求模型',{id:string,action:enumeration('keepRaw','compose'),fit:bool},['id','action'],'task');
define('task.list','列出任务及执行阶段',{},[],'read');
define('task.get','读取单个任务',{id:string},['id'],'read');
define('task.cancel','取消任务；已提交供应商的请求可能仍计费',{id:string},['id'],'task');
define('task.wait','有界等待任务结束，最多 30 秒',{id:string,timeoutMs:{type:'integer',minimum:0,maximum:30000}},['id'],'read');
define('asset.import','从会话文件根目录导入图片、音视频并添加到当前工程',{path:string},['path'],'file');
define('asset.export','导出原始素材到会话文件根目录；不覆盖文件',{id:string,path:string},['id','path'],'file');
define('artboard.export','导出指定画板 PNG 到会话文件根目录；不覆盖文件',{artboardId:string,path:string},['artboardId','path'],'file');
define('mask.fill','只修改指定图层蒙版，在当前画板选区内填黑或白',{id:string,mode:enumeration('hide','reveal')},['id','mode'],'pixels');
define('image.fillSelection','在所属画板当前选区内填色或清除图片像素；保留蒙版，产生一次撤销',{id:string,mode:enumeration('fill','clear'),color},['id','mode'],'pixels');
define('layer.merge','合并同画板内相邻顶层图层或分组，单层可栅格化；保留外观，一次撤销。不支持跨组/外部混合依赖',{ids},['ids'],'pixels');
define('mask.loadSelection','把指定蒙版载入所属画板选区',{id:string},['id'],'pixels');
define('selection.rasterize','固化画板当前选区，之后可继续加减自由选区',{artboardId:string},['artboardId'],'pixels');
define('selection.ellipse','创建椭圆选区；坐标相对画板',{artboardId:string,x:number,y:number,width:size,height:size},['artboardId','x','y','width','height'],'document',(d,a)=>{
  const points=Array.from({length:128},(_,i)=>{const t=i/128*Math.PI*2;return [a.x+a.width/2+Math.cos(t)*a.width/2,a.y+a.height/2+Math.sin(t)*a.height/2];}).flat();
  return catalog.get('selection.polygon').apply(d,{artboardId:a.artboardId,points});
});
define('selection.subject','异步本地 AI 主体选区；返回任务 ID。完成时若文档已变化则拒绝覆盖',{id:string,requestId:string},['id','requestId'],'localTask');
define('asset.preview','查看图片素材缩略图',{id:string,maxSize:{type:'integer',minimum:64,maximum:2048}},['id'],'read');
define('paint.stroke','绘制一次笔画并产生一次撤销；必须指定 image 或 mask 目标，点坐标相对画板',{id:string,target:enumeration('image','mask'),maskMode:enumeration('hide','reveal'),color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},erase:bool,points:{type:'array',items:point,minItems:1,maxItems:256},size:{type:'number',minimum:2,maximum:1000},opacity:{type:'number',minimum:1,maximum:100},hardness:{type:'number',minimum:0,maximum:100}},['id','target','points','size'],'pixels');
const imageDefaults={...require('./image-tools.cjs').defaults,...require('./image-composition.cjs').compositionDefaults,mirror:{},rotate:{},upscale:{model:'general',scale:4},cutout:{}};
define('image.process','异步执行本地图像处理；返回任务 ID，结果进入素材库。抠图/超分需已安装模型',{ids,requestId:string,settings:{oneOf:Object.entries(imageDefaults).map(([operation,defaults])=>object({operation:{const:operation},...Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof v==='number'?number:typeof v==='boolean'?bool:{type:'string',maxLength:512}])),...(operation==='resize'?{scale:{type:'number',minimum:.01,maximum:16}}:{}),...(operation==='extend'?{padding:{type:'number',minimum:0,maximum:10000}}:{})},['operation']))}},['ids','settings','requestId'],'localTask');

function validate(name,args) {
  const c=catalog.get(name);if(!c)fail('UNKNOWN_COMMAND',`未知命令：${name}`);
  if(!c.validate(args))fail('INVALID_ARGUMENT',`${name}: ${ajv.errorsText(c.validate.errors)}`);
  return c;
}
function listCommands(domain,schemas=true){return [...catalog.values()].filter(c=>!domain||c.name.startsWith(domain+'.')).map(({validate,apply,inputSchema,...c})=>schemas?{...c,inputSchema}:{...c,required:inputSchema.required});}
function resolveRefs(value,results) {
  if(Array.isArray(value))return value.map(v=>resolveRefs(v,results));
  if(value&&typeof value==='object'){
    if(Object.keys(value).length===1&&typeof value.$ref==='string'){
      const [step,...keys]=value.$ref.split('.');let found=results[step];
      for(const key of keys){if(!found||!Object.hasOwn(found,key)||['__proto__','constructor','prototype'].includes(key))fail('INVALID_REFERENCE','批次引用不存在');found=found[key];}
      if(found===undefined)fail('INVALID_REFERENCE','只能引用已执行步骤');return structuredClone(found);
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveRefs(v,results)]));
  }
  return value;
}
function batch(document,steps) {
  if(!Array.isArray(steps)||!steps.length||steps.length>100)fail('INVALID_ARGUMENT','批次需要 1–100 步');
  let draft=structuredClone(document);const results=Object.create(null);
  for(let i=0;i<steps.length;i++){
    const step=steps[i];
    if(!step||Object.keys(step).some(k=>!['name','command','args'].includes(k))||!/^[a-zA-Z][\w-]{0,63}$/.test(step.name)||Object.hasOwn(results,step.name))fail('INVALID_ARGUMENT','步骤名称无效或重复');
    try {
      const args=resolveRefs(step.args||{},results),c=validate(step.command,args);
      if(c.effect!=='document')fail('NON_TRANSACTIONAL','批次仅允许可撤销文档编辑');
      const result=c.apply(draft,args)||{};draft=result.document||draft;
      const {document:ignored,...output}=result;results[step.name]=output;
      validateDocument(draft);layers.validateLayers(draft.layers);
    }catch(e){e.message=`步骤 ${i+1} (${step.name}): ${e.message}`;throw e;}
  }
  return {document:draft,results};
}
require('./automation-scene.cjs').register(define,{string,object,enumeration,find,fail});
require('./automation-models.cjs').register(define,{string,object,enumeration});
require('./automation-font.cjs').register(define,{string,object,enumeration});
define('asset.details','读取素材生成提示词、来源及参数记录',{id:string,nodeId:string},['id'],'read');
define('task.retry','按原快照重试失败/取消/中断任务；云任务可能再次收费。相同 requestId 去重',{id:string,requestId:string},['id','requestId'],'network');
define('cloud.batch','批量提交 1–64 张图片的云处理；可能收费，返回批次及任务 ID',{ids:{...ids,maxItems:64},requestId:string,settings:catalog.get('cloud.process').inputSchema.properties.settings},['ids','settings','requestId'],'network');
define('cloud.cancelBatch','取消当前工程云处理批次中的运行任务',{id:string},['id'],'task');
define('semantic.analyze','识别图片中可独立提取的对象类别；可能收费',{assetId:string,requestId:string},['assetId','requestId'],'network');
define('semantic.read','读取当前工程已完成的类别识别方案',{id:string},['id'],'read');
define('semantic.generate','按已审阅的类别方案逐项生成蒙版并提取原图；可能收费',{assetId:string,plan:{type:'string',minLength:1,maxLength:6000},requestId:string},['assetId','plan','requestId'],'network');
define('generation.angle','从图片节点生成新视角，保留来源关系；可能收费',{nodeId:string,assetId:string,requestId:string,params:object({horizontalAngle:{type:'integer',minimum:-60,maximum:60},pitchAngle:{type:'integer',minimum:-45,maximum:45},cameraDistance:{type:'number',minimum:1,maximum:10},wideAngle:bool})},['nodeId','assetId','requestId'],'network');
define('analysis.review','保存分析草稿的人工审阅文本、选用和全局设置；之后用 analysis.apply 的 useReview 应用',{id:string,review:object({modules:{type:'array',minItems:1,maxItems:40,items:object({name:{type:'string',minLength:1,maxLength:120},kind:{type:'string',minLength:1,maxLength:40},text:{type:'string',minLength:1,maxLength:4000},enabled:bool,global:bool},['name','kind','text'])},createRecipe:bool,recipeName:{type:'string',maxLength:120},reference:bool},['modules'])},['id','review'],'file');
module.exports={listCommands,validate,batch,fail,find,editable,object,string,ids,enumeration};
