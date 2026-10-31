const fs=require('node:fs/promises'),path=require('node:path');
const {atomicWrite}=require('./storage.cjs');
const {defaults,languageFor}=require('./preference-values.cjs');
const {validateShortcuts}=require('./shortcuts.cjs');
const choices={language:['zh-CN','zh-TW','en','ja','ko'],theme:['dark','light','system'],zoom:[80,90,100,110,125],grid:['dots','lines','none'],imageConcurrency:Array.from({length:32},(_,i)=>i+1)};
function validate(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('INVALID_SETTINGS');
  for(const [key,value] of Object.entries(patch)){
    if(key==='shortcuts'){validateShortcuts(value);continue;}
    if(!Object.hasOwn(defaults,key)||(choices[key]?!choices[key].includes(value):typeof value!=='boolean'))throw Error('INVALID_SETTINGS');
  }
}
class Preferences {
  constructor(profile){this.file=path.join(profile,'preferences.json');this.value={...defaults};this.pending=Promise.resolve();}
  async init(){try{const value=JSON.parse(await fs.readFile(this.file,'utf8'));validate(value);this.value={...defaults,...value};}catch(e){if(e.code!=='ENOENT')throw e;}return this.value;}
  save(patch){validate(patch);const next=this.pending.then(async()=>{const value={...this.value,...patch};await atomicWrite(this.file,JSON.stringify(value));this.value=value;return {...value};});this.pending=next.catch(()=>{});return next;}
}
module.exports={Preferences,defaults,validate,languageFor};
