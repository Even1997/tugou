// Font sources have their own revision; they never mutate the current canvas.
function register(define,{string,object,enumeration}) {
  const project={projectId:string}, revision={...project,fontRevision:{type:'integer',minimum:0}}, request={requestId:string};
  const list={type:'array',minItems:1,maxItems:512,uniqueItems:true,items:string};
  define('font.status','字体运行环境和边界；不安装依赖',{},[],'read');
  define('font.library','列出本机字体和已发布的自定义字体；未发布的项目不进入字体选择列表',{},[],'read');
  define('font.face','取得已发布自定义字体的工程内资源引用；把结果传给文字图层属性即可使用，不安装系统字体',{projectId:string,jobId:string},['projectId','jobId'],'read');
  define('font.publish','将基于当前字形源的已完成build/refine发布到土狗字体列表；不公开上传，不改变已有文字的字体版本。尚无编译产物时先font.build并等待完成',{...revision,...request,jobId:string},['projectId','fontRevision','requestId','jobId'],'file');
  define('font.project.create','新建独立字体工程，字符顺序去重；返回 fontRevision',{name:{type:'string',minLength:1,maxLength:64},characters:{type:'string',maxLength:131066},...request},['name','characters','requestId'],'file');
  define('font.project.list','列出独立字体工程',{},[],'read');
  define('font.project.get','读取字符覆盖、图集、当前版本和检查状态',project,['projectId'],'read');
  define('font.atlas.preview','读取本字体已导入的原图缩略图',{...project,atlasId:string,maxSize:{type:'integer',minimum:64,maximum:2048}},['projectId','atlasId'],'read');
  define('font.atlas.plan','创建分页模板及固定字符映射；grid256 为 16×16 无边框图集，1440×2560；默认 markers 保留定位标记',{...revision,...request,layout:enumeration('markers','grid256'),cellSize:{type:'integer',minimum:256,maximum:512}},['projectId','fontRevision','requestId'],'file');
  define('font.atlas.import','导入任意字数原图；识别模式不需要模板。仅固定网格工具需同时指定 planId/page；保留原图摘要和来源',{...revision,...request,planId:string,page:{type:'integer',minimum:0,maximum:127},path:string,sourceNote:{type:'string',maxLength:1000}},['projectId','fontRevision','requestId','path'],'file');
  const corner={type:'array',items:{type:'number',minimum:0,maximum:16000},minItems:2,maxItems:2};
  const glyphBox={type:'array',items:{type:'integer',minimum:0,maximum:16000},minItems:4,maxItems:4};
  const mapping=object({jobId:string,glyphs:{type:'array',minItems:1,maxItems:65533,items:object({character:{type:'string',minLength:1,maxLength:2},box:glyphBox},['character','box'])}},['jobId','glyphs']);
  define('font.atlas.recognize','本地 OCR 检测字形与身份，不依赖排列顺序；返回候选和置信度，不写入字体。用 job.get 查看，再以 process.mapping 提交经确认的字符与裁切框',{...revision,...request,atlasId:string},['projectId','fontRevision','requestId','atlasId'],'file');
  define('font.atlas.review','保存识别复核草稿及左右逐字确认进度；默认纳入不等于身份已核对。可修正字与框，库外有效字符应用时自动加入',{...revision,...request,jobId:string,entries:{type:'array',maxItems:65533,items:object({character:{type:'string',maxLength:2},box:glyphBox,included:{type:'boolean'},reviewed:{type:'boolean'}},['character','box','included','reviewed'])}},['projectId','fontRevision','requestId','jobId','entries'],'file');
  const normalization=object({center:{type:'boolean'},size:{type:'boolean'},baseline:{type:'boolean'},weight:{type:'boolean'},cjkExtent:{type:'number',minimum:500,maximum:800},capHeight:{type:'number',minimum:550,maximum:780},xHeight:{type:'number',minimum:350,maximum:550},strokeWidth:{type:'number',minimum:4,maximum:160}},[]);
  define('font.atlas.process','定位、描图；mapping 为已确认 OCR 对应关系，坐标使用原图像素，仅支持单图，不可与 alignment 同用。省略时按固定模板。normalization 开启逐字校正，merge 合并当前字体并替换本批同字符；不自动应用候选',{...revision,...request,mapping,merge:{type:'boolean'},atlasIds:list,background:enumeration('light','alpha'),threshold:{type:'integer',minimum:1,maximum:254},normalization,alignment:{type:'array',maxItems:64,items:object({atlasId:string,corners:{type:'array',items:corner,minItems:4,maxItems:4}},['atlasId','corners'])}},['projectId','fontRevision','requestId','atlasIds','background'],'file');
  define('font.job.get','读取字体任务候选、诊断、可导出产物 ID',{...project,id:string},['projectId','id'],'read');
  define('font.revision.apply','按 fontRevision 原子应用处理完成的候选；保留旧源版本',{...revision,...request,candidateId:string},['projectId','fontRevision','requestId','candidateId'],'file');
  define('font.glyph.query','分页读取当前字形的来源、几何和审阅状态',{...project,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['projectId'],'read');
  define('font.glyph.preview','读取当前已保存字形的真实矢量轮廓，无需先编译字体；仅返回本字体已有字形，最多256字符一页',{...project,characters:{type:'string',minLength:1,maxLength:256}},['projectId','characters'],'read');
  define('font.review.record','为当前字形摘要记录外部审阅；身份与风格分别标记，不是 OCR',{...revision,...request,characters:{type:'string',minLength:1,maxLength:512},identity:enumeration('verified','rejected'),style:enumeration('accepted','rejected'),note:{type:'string',minLength:1,maxLength:1000}},['projectId','fontRevision','requestId','characters','identity','style','note'],'file');
  define('font.build','编译实际 TTF/WOFF2、源包和试排；strict 要求全覆盖且当前字形审阅通过',{...revision,...request,mode:enumeration('draft','strict')},['projectId','fontRevision','requestId','mode'],'file');
  define('font.outline.refine','对静态 TTF 自动平滑并加粗，保护连通块/字腔和字宽；path（交换目录内 TTF）与 jobId（本工程已完成构建/精修）必须二选一。path字符集须与工程一致；jobId按来源覆盖范围处理，受 TrueType 字形数上限约束。smoothing 默认14、bold 默认4，单位为千分之一 em，0关闭对应效果。生成独立 TTF/WOFF2、逐字记录和实际字体前后对照，不替换当前 UFO、不继承审阅结论',{...revision,...request,path:string,jobId:string,smoothing:{type:'number',minimum:0,maximum:24},bold:{type:'number',minimum:0,maximum:12}},['projectId','fontRevision','requestId'],'file');
  define('font.artifact.preview','读取模板、校正图或实际导出字体的 PNG；返回原生 MCP 图片',{...project,jobId:string,artifactId:string,maxSize:{type:'integer',minimum:64,maximum:2048}},['projectId','jobId','artifactId'],'read');
  define('font.artifact.export','将已登记的字体、源包、报告或图像写到会话目录；不覆盖文件',{...project,jobId:string,artifactId:string,path:string},['projectId','jobId','artifactId','path'],'file');
}
module.exports={register};
