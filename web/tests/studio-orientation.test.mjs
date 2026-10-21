import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareCloudImage, finishCloudImage, normalizeImageOrientation } from '../src/app/api/studio/cloud-image-tools.js';

const url=b=>'data:image/jpeg;base64,'+b.toString('base64'),bytes=s=>Buffer.from(s.split(',')[1],'base64'),signal=()=>new AbortController().signal;
async function fixture(orientation) {
 const data=Buffer.alloc(12*8*3);for(let y=0;y<8;y++)for(let x=0;x<12;x++){const i=(y*12+x)*3;data[i]=x*20;data[i+1]=y*30;data[i+2]=(x+y)*10}
 return sharp(data,{raw:{width:12,height:8,channels:3}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).withMetadata({orientation}).toBuffer();
}
function oriented(raw,orientation) {
 const width=orientation>=5?8:12,height=orientation>=5?12:8,output=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const [sx,sy]=[[x,y],[11-x,y],[11-x,7-y],[x,7-y],[y,x],[y,7-x],[11-y,7-x],[11-y,x]][orientation-1];
  raw.copy(output,(y*width+x)*4,(sy*12+sx)*4,(sy*12+sx+1)*4);
 }
 return {width,height,data:output};
}
test('all eight EXIF orientations share displayed coordinates across cloud input, mask and protected output',async()=>{
 for(let orientation=1;orientation<=8;orientation++){
  const encoded=await fixture(orientation),source=url(encoded),raw=await sharp(encoded).toColourspace('srgb').ensureAlpha().raw().toBuffer(),expected=oriented(raw,orientation);
  const op={kind:'edit',sourceId:'photo',sourceWidth:expected.width,sourceHeight:expected.height,left:1,top:1,width:2,height:2};
  const prepared=await prepareCloudImage(source,op,signal()),input=await sharp(bytes(prepared.image)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([input.info.width,input.info.height],[expected.width,expected.height]);assert.deepEqual(input.data,expected.data);
  const mask=await sharp(bytes(prepared.mask)).ensureAlpha().raw().toBuffer();assert.equal(mask[(1*expected.width+1)*4+3],0);assert.equal(mask[3],255);
  const generated='data:image/png;base64,'+(await sharp({create:{width:expected.width,height:expected.height,channels:4,background:'#ff0000'}}).png().toBuffer()).toString('base64');
  const result=await sharp(bytes(await finishCloudImage(source,generated,op,signal()))).ensureAlpha().raw().toBuffer();
  for(let y=0;y<expected.height;y++)for(let x=0;x<expected.width;x++){const i=(y*expected.width+x)*4;assert.deepEqual([...result.subarray(i,i+4)],x>=1&&x<3&&y>=1&&y<3?[255,0,0,255]:[...expected.data.subarray(i,i+4)])}
 }
});
test('model output with EXIF orientation is checked and decoded in displayed coordinates',async()=>{
 const source=url(await fixture(1)),generated=url(await fixture(6)),op={kind:'enhance',sourceId:'photo',sourceWidth:12,sourceHeight:8,left:0,top:0,width:12,height:8};
 await assert.rejects(finishCloudImage(source,generated,op,signal()),/未拉伸/);
 const rotatedSource=url(await fixture(6)),rotatedOp={...op,sourceWidth:8,sourceHeight:12,width:8,height:12};
 const result=await sharp(bytes(await finishCloudImage(rotatedSource,generated,rotatedOp,signal()))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.deepEqual([result.info.width,result.info.height],[8,12]);
 const expected=oriented(await sharp(bytes(generated)).toColourspace('srgb').ensureAlpha().raw().toBuffer(),6);assert.deepEqual(result.data,expected.data);
});
test('orientation normalization preserves already upright original bytes and fixes provider MIME without re-encoding',async()=>{
 const encoded=await fixture(1),source=url(encoded);assert.equal(await normalizeImageOrientation(source),source);
 assert.equal(await normalizeImageOrientation(source.replace('image/jpeg','image/png')),source);
 const rotated=await normalizeImageOrientation(url(await fixture(6))),meta=await sharp(bytes(rotated)).metadata();assert.equal(meta.orientation,undefined);assert.deepEqual([meta.width,meta.height],[8,12]);
});
