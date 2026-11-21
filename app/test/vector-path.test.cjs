const test=require('node:test'),assert=require('node:assert/strict');
const {measure,dimensions,sizePatch}=require('../core/board-measure.cjs');
const {penShape,moveAnchor,insertAnchor,removeAnchor,validatePaths}=require('../core/vector-path.cjs');
const {traceImage}=require('../core/trace-image.cjs');
const {createLayer}=require('../core/layers.cjs');
const {pathSvg}=require('../core/path-svg.cjs');
const sharp=require('sharp');

test('physical sizes round once and pixel edits preserve the other axis',()=>{
  const board=measure(14,20,'cm',300);
  assert.deepEqual([board.width,board.height],[1654,2362]);
  assert.deepEqual(dimensions(board,'mm'),{width:140,height:200});
  assert.deepEqual(sizePatch(board,{ppi:150}),measure(14,20,'cm',150));
  assert.equal(sizePatch(board,{width:120,ppi:150}).width,120);
  assert.deepEqual(sizePatch(board,{unit:'mm'}).printSize,{unit:'mm',ppi:300,width:140,height:200});
  for(const args of [[1.2,2,'px'],[100,100,'in',300],[1,2,'cm',0],[1,2,'cm',Infinity],[1,2,'points']])assert.throws(()=>measure(...args));
});
test('pen bounds contain the control points and anchor edits translate their tangents',()=>{
  const layer=penShape([{x:10,y:10},{x:30,y:50,in:[20,55],out:[40,45]}],false);
  assert.equal(layer.width,30);assert.equal(layer.height,45);
  const old=layer.paths[0].nodes[1],moved=moveAnchor(layer,0,1,'anchor',old.x+.25,old.y).paths[0].nodes[1];
  assert.ok(Math.abs(moved.in[0]-old.in[0]-.25)<1e-12);assert.equal(moved.out[1],old.out[1]);
  assert.throws(()=>validatePaths([{closed:true,nodes:[old,{x:Infinity,y:0}]}]));
});
test('splitting the closing cubic preserves its entire curve and the other contour',()=>{
  const n=[{x:0,y:0,in:[-.5,.3]},{x:1,y:0},{x:.7,y:1,out:[.5,1.3]}],other={closed:false,nodes:n.slice(0,2)};
  const layer={shape:'path',paths:[{closed:true,nodes:n},other]},result=insertAnchor(layer,0,2),split=result.paths[0].nodes;
  const sample=(a,b,t)=>[0,1].map((axis)=>{
    const key=axis?'y':'x',u=1-t;
    return u**3*a[key]+3*u*u*t*(a.out?.[axis]??a[key])+3*u*t*t*(b.in?.[axis]??b[key])+t**3*b[key];
  });
  for(let i=0;i<=100;i++){
    const t=i/100,expected=sample(n[2],n[0],t),actual=t<=.5?sample(split[2],split[3],2*t):sample(split[3],split[0],2*t-1);
    assert.ok(actual.every((v,k)=>Math.abs(v-expected[k])<1e-12));
  }
  assert.equal(result.paths[1],other);assert.equal(n.length,3);
  assert.equal(removeAnchor(result,0,3).paths[0].nodes.length,3);
  assert.throws(()=>removeAnchor(layer,1,0),/两个/);assert.throws(()=>insertAnchor(layer,1,1),/末端/);
  assert.throws(()=>insertAnchor({shape:'path',paths:[other,{closed:true,nodes:Array(11998).fill(n[0])}]},1,1),/12000/);
});
test('black tracing retains transparent holes and disjoint contours in an actual SVG raster',async()=>{
  const width=64,height=40,data=new Uint8ClampedArray(width*height*4);
  for(let y=2;y<36;y++)for(let x=2;x<60;x++){
    if((x>12&&x<22&&y>12&&y<24)||(x>=35&&x<=45))continue;
    data[(y*width+x)*4+3]=255;
  }
  const paths=traceImage({width,height,data});
  assert.equal(paths.length,3);
  const l=createLayer('shape',{shape:'path',paths,x:0,y:0,width,height,color:'#126633'});
  const bytes=await sharp(Buffer.from(pathSvg([l],l.id))).ensureAlpha().raw().toBuffer();
  const alpha=(x,y)=>bytes[(y*width+x)*4+3];
  assert.equal(alpha(8,8),255);assert.equal(alpha(17,18),0);assert.equal(alpha(40,18),0);assert.equal(alpha(52,18),255);
  assert.throws(()=>traceImage({width,height,data:new Uint8ClampedArray(width*height*4)}),/轮廓/);
  assert.throws(()=>pathSvg([{...l,fill:true,color:'url(external)'}],l.id),/颜色/);
});
