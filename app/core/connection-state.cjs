const purposes=[['image','图片生成','model'],['analysis','视觉分析','analysisModel'],['text','文本生成','textModel'],['video','视频生成','videoModel'],['audio','语音生成','audioModel']];
// A route always names a Key and a selected, explicitly classified model.
function reconcile(manager) {
  const routes={...manager.routes};
  const connections=manager.connections.map(c=>{
    const next={...c};for(const [purpose,,field] of purposes){
      if(!c.models.some(m=>m.id===c[field]&&m.purposes.includes(purpose))||!(c.apiKey?.trim()||c.hasKey)){
        next[field]='';if(routes[purpose]===c.id)routes[purpose]=null;
      }
    }return next;
  });
  for(const [purpose] of purposes)if(!connections.some(c=>c.id===routes[purpose]))routes[purpose]=null;
  return {...manager,connections,routes,activeId:null};
}
function affected(manager,ids) { return purposes.filter(([p])=>ids.includes(manager.routes[p])).map(([,label])=>label); }
module.exports={purposes,reconcile,affected};
