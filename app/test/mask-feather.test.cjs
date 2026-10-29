const test=require('node:test'),assert=require('node:assert/strict');
const {featherMask}=require('../core/mask-feather.cjs');
const {prepare,finish,decode,encode}=require('../core/cloud-pixels.cjs');
const {cloudSettings}=require('../core/cloud-settings.cjs');
test('inward feather preserves empty/full masks, default identity, bounds and source bytes',()=>{
  const full=new Uint8Array(25).fill(255),empty=new Uint8Array(25);
  assert.equal(featherMask(full,5,5,0),full);
  assert.deepEqual(featherMask(full,5,5,20),full);
  assert.deepEqual(featherMask(empty,5,5,20),empty);
  const alpha=new Uint8Array(49);for(let y=1;y<6;y++)for(let x=1;x<6;x++)alpha[y*7+x]=255;
  alpha[3*7+3]=128;const before=alpha.slice(),result=featherMask(alpha,7,7,2);
  assert.deepEqual(alpha,before);assert.equal(result[8],64);assert.equal(result[16],191);assert.equal(result[24],128);
  for(let i=0;i<alpha.length;i++)assert.ok(result[i]>=0&&result[i]<=alpha[i]);
  // An erased hole is protected and feathered inward from every direction.
  alpha[24]=0;const hole=featherMask(alpha,7,7,2);assert.equal(hole[24],0);assert.equal(hole[23],64);
  assert.deepEqual(featherMask(new Uint8Array([255]),1,1,1000),new Uint8Array([255]));
});
test('asset feather validates all channels and uses the same coverage for upload and protected composite',async()=>{
  const width=9,height=9,src={width,height,data:Buffer.alloc(width*height*4)},gen={width,height,data:Buffer.alloc(width*height*4)},mask={width,height,data:Buffer.alloc(width*height*4)};
  for(let i=0;i<width*height;i++){src.data.set([70,80,90,128],i*4);gen.data.set([210,120,30,255],i*4);const x=i%width,y=Math.floor(i/width);mask.data.set([255,255,255,x>1&&x<7&&y>1&&y<7?255:0],i*4);}
  const bytes=await encode(src),generated=await encode(gen),mb=await encode(mask);
  for(const maskChannel of ['alpha','luminance'])for(const invertMask of [false,true]){
    const s={operation:'cloudEdit',instruction:'change',maskMode:'asset',maskId:'m',maskChannel,invertMask,feather:2};
    const p=await prepare(bytes,s,mb),sent=await decode(p.mask),output=await decode(await finish(bytes,generated,s,false,mb));
    for(let i=0;i<width*height;i++){
      const j=i*4,coverage=(255-sent.data[j+3])/255;
      if(!coverage)assert.deepEqual(output.data.subarray(j,j+4),src.data.subarray(j,j+4));
      else {const alpha=128*(1-coverage)+255*coverage;assert.equal(output.data[j+3],Math.round(alpha));assert.equal(output.data[j],Math.round((70*128*(1-coverage)+210*255*coverage)/alpha));}
    }
    for(const feather of [-1,1.5,1001,NaN])assert.throws(()=>cloudSettings({...s,feather},src),/feather/);
  }
});
test('excessive feather cannot silently submit a mask rounded down to empty',async()=>{
  const source=await encode({width:3,height:1,data:Buffer.from([50,50,50,255,50,50,50,255,50,50,50,255])});
  const mask=await encode({width:3,height:1,data:Buffer.from([0,0,0,0,255,255,255,255,0,0,0,0])});
  await assert.rejects(prepare(source,{operation:'cloudEdit',instruction:'change',maskMode:'asset',maskId:'m',feather:1000},mask),/羽化后没有/);
});
