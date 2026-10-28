function issue(entry,width,height){
  if([...entry.character].length!==1||/[\s\p{C}]/u.test(entry.character))return '填写一个有效字符';
  const [l,t,r,b]=entry.box;
  if(l<0||t<0||r<=l||b<=t||r>width||b>height)return '裁切范围无效';
  return '';
}
function initialize(candidates,saved,width,height,exactScores=true){
  const best=new Map();
  candidates.forEach((e,i)=>{if(!issue(e,width,height)&&(!best.has(e.character)||e.score>candidates[best.get(e.character)].score))best.set(e.character,i);});
  const rows=saved||candidates.map((e,i)=>({character:e.character,box:e.box,included:best.get(e.character)===i,reviewed:false}));
  return rows.map((e,i)=>({...candidates[i],score:candidates[i]?.score||0,warnings:candidates[i]?.warnings||[],...e,needsReview:!exactScores||(candidates[i]?.score||0)<1||!!candidates[i]?.warnings?.length||best.get(candidates[i]?.character)!==i}));
}
const draft=entries=>entries.map(({character,box,included,reviewed})=>({character,box,included,reviewed}));
const confidence=(score,exactScores=true)=>score===1?(exactScores?'100%':'约 100%'):`${Math.min(99.99,Math.floor(score*10000)/100)}%`;
function edit(entries,index,patch,width,height){
  return entries.map((entry,i)=>{
    if(i!==index)return entry;
    const next={...entry,...patch,reviewed:false,needsReview:true};
    // Correcting an OCR identity restores it automatically; explicit exclusions stay until edited.
    if(patch.character!==undefined||patch.box!==undefined)next.included=!issue(next,width,height);
    return next;
  });
}
module.exports={issue,initialize,draft,confidence,edit};
