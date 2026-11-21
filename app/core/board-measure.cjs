const units={px:'像素',mm:'毫米',cm:'厘米',in:'英寸'};
const perInch={mm:25.4,cm:2.54,in:1};
const factor=(unit,ppi)=>unit==='px'?1:ppi/perInch[unit];
function measure(width,height,unit='px',ppi=300){
  if(!Object.hasOwn(units,unit)||!Number.isFinite(ppi)||ppi<1||ppi>2400)throw Error('分辨率须在 1–2400 PPI 之间');
  const scale=factor(unit,ppi),w=Math.round(width*scale),h=Math.round(height*scale);
  if(![width,height].every(n=>Number.isFinite(n)&&n>0)||(unit==='px'&&![width,height].every(Number.isInteger))||w<1||h<1||w>30000||h>30000||w*h>100000000)throw Error('尺寸超出范围：单边 1–30000 像素，总计最多一亿像素');
  return {width:w,height:h,printSize:{width,height,unit,ppi}};
}
function dimensions(board,unit=board.printSize?.unit||'px',ppi=board.printSize?.ppi||300){
  const old=board.printSize,ratio=factor(unit,ppi);
  return Object.fromEntries(['width','height'].map(k=>{
    const exact=old&&Math.round(old[k]*factor(old.unit,old.ppi))===board[k];
    const value=unit==='px'?board[k]:exact&&old.unit!=='px'&&old.ppi===ppi?old[k]*perInch[unit]/perInch[old.unit]:board[k]/ratio;
    return [k,Number(value.toFixed(8))];
  }));
}
function sizePatch(board,{unit,ppi,width,height,...rest}){
  if([unit,ppi,width,height].every(v=>v===undefined))return rest;
  const target=unit||(width===undefined&&height===undefined?board.printSize?.unit:null)||'px';
  const current=dimensions(board,target);
  return {...rest,...measure(width??current.width,height??current.height,target,ppi??board.printSize?.ppi??300)};
}
module.exports={units,measure,dimensions,sizePatch};
