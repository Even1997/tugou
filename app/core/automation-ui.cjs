function register({define,string,enumeration}){
  const region={type:'string',minLength:1,maxLength:80},page={type:'integer',minimum:0,maximum:10000};
  define('ui.inspect','检查真实界面：可见区域、滚动范围、折叠项、控件和加载状态；不读取输入值。返回的区域/控件 ID 仅当前界面有效',{offset:page,limit:{type:'integer',minimum:1,maximum:200}},[],'read');
  define('ui.capture','截取当前可见应用界面或 inspect 返回的区域，直接返回 PNG 和覆盖说明。不自动滚动或抢焦点；屏幕外内容需 navigate 分段检查。原生系统对话框不包含在图内',{region,maxSize:{type:'integer',minimum:256,maximum:2048}},[],'read');
  define('ui.navigate','只改变视图：切换工作区/设置页、定位画布节点或概览、滚动指定区域、展开折叠项。返回 restoreToken；连续导航可传回同一令牌保留最初视图；不会保存或改变文档。有弹窗、输入焦点或无法安全离开的草稿时拒绝',{workspace:enumeration('canvas','layers','prompts','assets','settings','fonts','tools'),settingsTab:enumeration('general','appearance','storage','models','mcp','shortcuts','updates'),nodeId:string,overview:{type:'boolean'},region,scroll:enumeration('next','previous','start','end'),detailsId:region,expanded:{type:'boolean'},restoreToken:string},[],'view');
  define('ui.restore','用导航返回的令牌恢复原工作区、滚动位置和已支持的面板视图，不回滚工程内容。令牌限当前会话、同一工程，10分钟内最多保留10个',{restoreToken:string},['restoreToken'],'view');
}
module.exports={register};
