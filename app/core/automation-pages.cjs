function register({define,string,enumeration}){
  const pages=require('./pages.cjs'),kind=enumeration('canvas','layers'),name={type:'string',minLength:1,maxLength:80};
  define('page.list','列出当前工程的画布或合成页面；内容和编辑命令默认作用于该类型当前页',{kind},['kind'],'read');
  define('page.activate','切换当前画布或合成页并进入对应工作区；保留工程历史，不提交保存',{kind,id:string},['kind','id'],'view');
  define('page.create','新建独立画布或合成并激活；素材、提示词、配方仍共享',{kind,name},['kind'],'document',(d,a)=>pages.create(d,a.kind,a.name));
  define('page.rename','重命名页面',{kind,id:string,name},['kind','id','name'],'document',(d,a)=>({document:pages.rename(d,a.kind,a.id,a.name)}));
  define('page.duplicate','复制页面，节点/图层使用新 ID，素材引用共享',{kind,id:string},['kind','id'],'document',(d,a)=>pages.duplicate(d,a.kind,a.id));
  define('page.delete','删除页面及内容，可撤销；每种类型至少保留一页，运行任务阻止删除',{kind,id:string},['kind','id'],'document',(d,a)=>({document:pages.remove(d,a.kind,a.id)}));
}
module.exports={register};
