const fs=require('node:fs/promises');
const path=require('node:path');
const {atomicWrite}=require('./storage.cjs');

async function automationEnabled(profile,requested){
  const file=path.join(profile,'mcp-enabled.json');
  if(requested){await atomicWrite(file,JSON.stringify({enabled:true}));return true;}
  try{return JSON.parse(await fs.readFile(file,'utf8')).enabled===true;}
  catch(e){if(e.code==='ENOENT')return false;throw e;}
}
module.exports={automationEnabled};
