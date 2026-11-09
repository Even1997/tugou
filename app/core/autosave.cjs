// One writer for automatic, manual and leave-page saves. Editing stays unlocked.
function createAutosave({read,dirty,snapshot,write,commit,status,blocked}) {
  let timer=null,first=null,last=0,version=0,pending=null,disposed=false;
  const clear=()=>{clearTimeout(timer);timer=null;};
  const schedule=()=>{
    clear();
    if(disposed||first===null)return;
    timer=setTimeout(()=>{
      timer=null;
      if(blocked()){timer=setTimeout(schedule,100);return;}
      void save().catch(()=>{});
    },Math.max(0,Math.min(last+500,first+3000)-Date.now()));
  };
  const save=()=>{
    if(pending)return pending;
    if(disposed||!read()||!dirty()){clear();first=null;return Promise.resolve();}
    clear();first=null;
    const current=read(),at=version;
    status('saving');
    pending=Promise.resolve().then(()=>write(current.id,snapshot(),current.revision)).then(saved=>{
      if(disposed||read()?.id!==current.id)return;
      // Keep the live document reference: paint/gesture jobs may still be using it.
      commit(saved,at===version);
      status(dirty()?'pending':'saved');
    }).catch(error=>{
      clear();first=null;
      if(!disposed)status('saveFailed',error.message);
      throw error;
    }).finally(()=>{
      pending=null;
      if(first!==null)schedule();
    });
    return pending;
  };
  return {
    changed(){version++;first??=Date.now();last=Date.now();if(!pending)status('pending');schedule();},
    reset(){version++;clear();first=null;status('saved');},
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
