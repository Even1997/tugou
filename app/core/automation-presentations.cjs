const ppt=require('./presentations.cjs'),effects=require('./effects.cjs');
const {contentOf,contentTitle,contentStatus,setContent,applyContent,syncContent}=require('./presentation-content.cjs');
function register({define,string,object,enumeration,find,fail}){
  const hex={type:'string',pattern:'^#[a-fA-F0-9]{6}$'},bool={type:'boolean'},range=(minimum,maximum)=>({type:'number',minimum,maximum});
  const name={type:'string',minLength:1,maxLength:120},index={type:'integer',minimum:0,maximum:199};
  const ids={presentationId:string,slideId:string},itemIds={...ids,id:string};
  const deck=(d,a)=>find(d.presentations||[],a.presentationId||a.id),page=(d,a)=>find(deck(d,a).slides,a.slideId),item=(d,a)=>find(page(d,a).elements,a.id);
  const editable=e=>{if(e.locked)fail('LOCKED','PPT 元素已锁定，请先解锁');};
  const props={x:range(-5000,5000),y:range(-5000,5000),w:range(8,5000),h:range(8,5000),rotation:range(-360,360),visible:bool,locked:bool,
    text:{type:'string',maxLength:10000},fontSize:range(8,240),fontFamily:{type:'string',minLength:1,maxLength:100},fontWeight:{type:'integer',minimum:1,maximum:1000},bold:bool,italic:bool,color:hex,align:enumeration('left','center','right'),
    fontResource:{anyOf:[{type:'null'},object({resource:{type:'string',pattern:'^[a-f0-9]{64}\\.ttf$'},projectId:string,jobId:string},['resource','projectId','jobId'])]},fill:hex,assetId:string,cornerRadius:{...range(0,2500),description:'仅矩形：固定圆角半径 px；设置时清除 cornerRounding'},cornerRounding:{description:'仅矩形：0–100 圆角程度，100 为短边一半；数值为四角联动，或完整对象 topLeft/topRight/bottomRight/bottomLeft 分别调整四角。设置时清除 cornerRadius。',anyOf:[range(0,100),object(Object.fromEntries(ppt.cornerKeys.map(k=>[k,range(0,100)])),ppt.cornerKeys)]}};
  const applyProps=(e,p)=>{
    const common=['x','y','w','h','rotation','visible','locked'],specific=e.kind==='text'?['text','fontSize','fontFamily','fontWeight','fontResource','bold','italic','color','align']:e.kind==='image'?['assetId']:e.kind==='rect'?['fill','cornerRadius','cornerRounding']:['fill'];
    if(Object.keys(p).some(k=>!common.includes(k)&&!specific.includes(k)))fail('INVALID_ARGUMENT','属性不适用于此 PPT 元素类型');
    if(p.cornerRadius!==undefined&&p.cornerRounding!==undefined)fail('INVALID_ARGUMENT','请选择像素半径或圆角程度，不可同时设置');
    if(p.cornerRounding!==undefined)delete e.cornerRadius;if(p.cornerRadius!==undefined)delete e.cornerRounding;
    if(p.fontFamily&&!Object.hasOwn(p,'fontResource'))delete e.fontResource;
    if(Object.hasOwn(p,'bold')&&!Object.hasOwn(p,'fontWeight'))e.fontWeight=p.bold?700:400;
    Object.assign(e,p);if(p.fontWeight!==undefined)e.bold=p.fontWeight>=600;
  };
  const move=(list,id,to)=>{if(to>=list.length)fail('INVALID_ARGUMENT','目标位置超出范围');const from=list.findIndex(e=>e.id===id);if(from<0)fail('NOT_FOUND','对象不存在');list.splice(to,0,list.splice(from,1)[0]);};
  define('ppt.list','列出当前工程的全部 PPT 名称、比例与页数',{},[],'read');
  define('ppt.get','读取 PPT 页面大纲和待应用数量；指定 slideId 时返回完整元素、逐块内容草稿、冲突状态与讲稿',{presentationId:string,slideId:string},['presentationId'],'read');
  define('ppt.create','创建独立 PPT；内容阶段传 layout:blank 创建空白首屏，默认 cover。返回 presentationId、首个 slideId 和 id',{name,ratio:enumeration('16:9','4:3'),accent:hex,layout:enumeration('blank','cover')},[],'document',(d,a)=>{const p=ppt.create(a.name,a.ratio,a.accent,a.layout);(d.presentations||=[]).push(p);return {id:p.id,presentationId:p.id,slideId:p.slides[0].id};});
  define('ppt.rename','重命名指定 PPT',{presentationId:string,name},['presentationId','name'],'document',(d,a)=>{deck(d,a).name=a.name;});
  define('ppt.duplicate','复制整份 PPT，页面、元素使用新 ID，素材和字体资源共享',{presentationId:string,name},['presentationId'],'document',(d,a)=>{const p=ppt.duplicate(deck(d,a));p.name=a.name||(p.name+' 副本').slice(0,120);d.presentations.push(p);return {id:p.id,presentationId:p.id,slideId:p.slides[0].id};});
  define('ppt.delete','删除指定 PPT；可撤销，素材不删除',{presentationId:string},['presentationId'],'document',(d,a)=>{deck(d,a);d.presentations=d.presentations.filter(p=>p.id!==a.presentationId);});
  define('ppt.slide.create','新建封面、内容或空白页；index 从 0 开始，省略时追加',{presentationId:string,layout:enumeration('cover','content','blank'),index},['presentationId'],'document',(d,a)=>{const p=deck(d,a),s=ppt.slide(a.layout,ppt.sizes[p.ratio][0],p.accent);if(a.index>p.slides.length)fail('INVALID_ARGUMENT','插入位置超出范围');p.slides.splice(a.index??p.slides.length,0,s);return {id:s.id,slideId:s.id};});
  define('ppt.slide.update','修改页面背景或演讲备注',{...ids,patch:object({background:hex,notes:{type:'string',maxLength:10000}})},['presentationId','slideId','patch'],'document',(d,a)=>{Object.assign(page(d,a),a.patch);});
  const contentText={type:'string',maxLength:10000},contentId={type:'string',minLength:1,maxLength:100};
  define('ppt.content.update','保存逐页内容草稿，不修改画面。text 为整页自由文本，优先用于内容编辑；完成页面排版并核对完整性后，显式 text:null 清除已落实草稿。省略 text 保留。objective 核心观点、chartData 图表数据/依据、visuals 配图需求；blocks 为完整文字块列表（不传则保留），读取 ppt.get 后保留 id/elementId；新块可省略 id。AI 可在 blank 页先准备内容，视觉确认后再制作。',{...ids,patch:object({text:{anyOf:[{type:'string',maxLength:2040000},{type:'null'}]},objective:contentText,chartData:contentText,visuals:contentText,blocks:{type:'array',maxItems:200,items:object({id:contentId,elementId:contentId,label:{type:'string',maxLength:80},text:contentText},['label','text'])}})},['presentationId','slideId','patch'],'document',(d,a)=>{const s=page(d,a);Object.assign(s,setContent(s,a.patch));return {content:contentOf(s),contentStatus:contentStatus(s)};});
  define('ppt.content.apply','显式把结构化 blocks 草稿更新到页面文字；存在整页 text 草稿时拒绝，先整理并核对排版后清除 text。保留现有位置/字体/效果；未关联块生成基础文字框，仍需设计排版。锁定拒绝；双向冲突先核对当前元素与草稿，得到用户覆盖授权后才设 confirmConflicts。图表/配图需求不会自动生成素材。',{...ids,confirmConflicts:bool},['presentationId','slideId'],'document',(d,a)=>{const s=page(d,a);Object.assign(s,applyContent(s,a));return {content:contentOf(s),contentStatus:contentStatus(s)};});
  define('ppt.slide.duplicate','复制页面到原页后方，元素使用新 ID',ids,['presentationId','slideId'],'document',(d,a)=>{const p=deck(d,a),s=page(d,a),copy=ppt.duplicate(s);p.slides.splice(p.slides.indexOf(s)+1,0,copy);return {id:copy.id,slideId:copy.id};});
  define('ppt.slide.delete','删除指定页面，每份 PPT 至少保留一页',ids,['presentationId','slideId'],'document',(d,a)=>{const p=deck(d,a);page(d,a);if(p.slides.length===1)fail('INVALID_TARGET','至少保留一页');p.slides=p.slides.filter(s=>s.id!==a.slideId);});
  define('ppt.slide.move','调整页面顺序，index 从 0 开始',{...ids,index},['presentationId','slideId','index'],'document',(d,a)=>move(deck(d,a).slides,a.slideId,a.index));
  define('ppt.element.create','创建文字、图片、矩形或椭圆；矩形支持 cornerRounding 0–100 圆角程度及四角独立；图片先 asset.import；字体可通过 font.library 查询、font.publish 发布',{...ids,kind:enumeration('text','image','rect','ellipse'),properties:object(props)},['presentationId','slideId','kind'],'document',(d,a)=>{const e=ppt.element(a.kind);applyProps(e,a.properties||{});page(d,a).elements.push(e);return {id:e.id};});
  define('ppt.element.update','修改内容、字体、位置、尺寸、旋转、矩形圆角（含四角独立）、可见性与锁定；锁定元素只允许改变 visible/locked',{...itemIds,patch:object(props)},['presentationId','slideId','id','patch'],'document',(d,a)=>{const e=item(d,a);if(Object.keys(a.patch).some(k=>!['visible','locked'].includes(k)))editable(e);applyProps(e,a.patch);const s=page(d,a);Object.assign(s,syncContent(s));});
  define('ppt.element.duplicate','复制元素到顶层并偏移 20 px，原元素不变',itemIds,['presentationId','slideId','id'],'document',(d,a)=>{const e=item(d,a);editable(e);const copy=ppt.duplicate(e);copy.x=Math.min(5000,e.x+20);copy.y=Math.min(5000,e.y+20);page(d,a).elements.push(copy);return {id:copy.id};});
  define('ppt.element.delete','删除一个元素及对应内容关联，可撤销',itemIds,['presentationId','slideId','id'],'document',(d,a)=>{editable(item(d,a));const s=page(d,a);s.elements=s.elements.filter(e=>e.id!==a.id);Object.assign(s,syncContent(s));});
  define('ppt.element.move','调整元素叠放顺序；index=0 是底层，最后一个是顶层',{...itemIds,index},['presentationId','slideId','id','index'],'document',(d,a)=>{editable(item(d,a));move(page(d,a).elements,a.id,a.index);});
  const effectList={type:'array',maxItems:3,items:{oneOf:['shadow','innerShadow','stroke'].map(type=>object({type:{const:type},enabled:bool,color:hex,opacity:range(0,100),...(type==='stroke'?{size:range(0,200)}:{radius:range(0,100),distance:range(0,200),angle:range(-180,180)})},['type']))}};
  define('ppt.element.effects','替换元素完整效果列表；shadow 外阴影、innerShadow 内阴影、stroke 外框边框。每类最多一个，空列表清除。省略参数使用默认值',{...itemIds,effects:effectList},['presentationId','slideId','id','effects'],'document',(d,a)=>{const e=item(d,a);editable(e);e.effects=a.effects.map(f=>({...effects.defaults(f.type),...f,...(f.type==='stroke'?{position:'center'}:{})}));});
  define('ppt.open','进入 PPT，可定位页面/元素，sidebar 切换 pages/outline，panel 切换 content/design/notes；只改变视图',{...ids,elementId:string,sidebar:enumeration('pages','outline'),panel:enumeration('content','design','notes')},['presentationId'],'view');
  define('ppt.close','返回 PPT 列表，停止当前演示；不会保存或丢弃工程修改',{},[],'view');
  define('ppt.preview','获取 PPT 单页截图：打开指定页预览，直接返回 MCP image/png 图片内容及页 ID、尺寸和 revision，供 AI 查看结果。读取当前未保存内容，只截幻灯片、不含工具栏；窗口需可见。会改变视图；每页截图后用 ppt.present action:stop 退出再截下一页。maxSize 为尺寸上限，不放大窗口像素',{...ids,maxSize:{type:'integer',minimum:256,maximum:2048}},['presentationId'],'view');
  define('ppt.present','控制演示：start 可指定 presentationId/slideId 和 fullscreen；next/previous/goto/stop 控制当前演示，goto 使用 slideId',{...ids,action:enumeration('start','next','previous','goto','stop'),fullscreen:bool},['action'],'view');
  define('ppt.export','导出当前实时快照为可编辑 PPTX，含字体名称、备注、阴影与边框；path 相对 MCP filesRoot，须 .pptx，不覆盖已有文件',{presentationId:string,path:string},['presentationId','path'],'file');
}
const deckSummary=p=>({id:p.id,name:p.name,ratio:p.ratio,accent:p.accent,slides:p.slides.length});
const slideSummary=(s,i)=>({id:s.id,index:i,background:s.background,elements:s.elements.length,hasNotes:!!s.notes,title:contentTitle(s),objective:contentOf(s).objective,contentStatus:contentStatus(s)});
module.exports={register,deckSummary,slideSummary};
