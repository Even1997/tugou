// One writer for automatic, manual and leave-page saves. Editing stays unlocked.
const IDLE_MS=1500,INTERVAL_MS=10000;
function createAutosave({read,dirty,snapshot,write,commit,status,blocked}) {
  let timer=null,first=null,last=0,version=0,pending=null,disposed=false,nextAutoAt=0,saveFailed=false;
  const clear=()=>{clearTimeout(timer);timer=null;};
  const schedule=()=>{
    clear();
    if(disposed||pending||first===null)return;
    const due=Math.max(nextAutoAt,Math.min(last+IDLE_MS,first+INTERVAL_MS));
    timer=setTimeout(()=>{
      timer=null;
      if(blocked()){timer=setTimeout(schedule,100);return;}
      void save().catch(()=>{});
    },Math.max(0,due-Date.now()));
  };
  const save=()=>{
    if(pending)return pending;
    if(disposed||!read()||!dirty()){clear();first=null;return Promise.resolve();}
    clear();first=null;
    const current=read(),at=version;
    nextAutoAt=Date.now()+INTERVAL_MS;
    saveFailed=false;
    status('saving');
    pending=Promise.resolve().then(()=>write(current.id,snapshot(),current.revision)).then(saved=>{
      if(disposed||read()?.id!==current.id)return;
      // Keep the live document reference: paint/gesture jobs may still be using it.
      commit(saved,at===version);
      status(dirty()?'pending':'saved');
    }).catch(error=>{
      clear();first=null;
      saveFailed=true;
      if(!disposed)status('saveFailed',error.message);
      throw error;
    }).finally(()=>{
      pending=null;
      if(first!==null)schedule();
    });
    return pending;
  };
  return {
    changed(autoSave=true){
      version++;
      if(!pending&&(autoSave||!saveFailed))status('pending');
      if(!autoSave)return;
      last=Date.now();first??=last;schedule();
    },
    reset(){version++;clear();first=null;saveFailed=false;status('saved');},
    async flush(){
      clear();
      if(pending)await pending;
      while(!disposed&&read()&&dirty())await save();
      clear();
    },
    get saving(){return pending!==null;},
    dispose(){disposed=true;clear();},
  };
}
module.exports={createAutosave};
