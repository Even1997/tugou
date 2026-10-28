import {
  worldMatrix,
  matrix,
  multiply,
  inverse,
  point,
  homography,
  inverse3,
  project,
  inherited,
} from "../core/layers.cjs";
import {surface,selectionCanvas} from './selection.js';

export async function targetSelection(doc,engine,{width,height,geometry}) {
  if(!doc.selection)return null;
  const world=await selectionCanvas(doc,engine),mask=surface(width,height);
  try {
    const warp=[[0,0],[doc.width,0],[doc.width,doc.height],[0,doc.height]].flatMap(([x,y])=>{const p=geometry.local(x,y);return [p.x,p.y]});
    engine.geometry(mask.getContext('2d'),world,{width,height,warp},[1,0,0,1,0,0]);
    return mask;
  } finally {world.width=world.height=1;}
}
export async function fillMaskSelection(doc,layer,engine,mode,maxPixels=Infinity) {
  if(!doc.selection)throw new Error('请先创建选区');
  if(!layer||inherited(doc.layers,layer,'locked')||inherited(doc.layers,layer,'hidden'))throw new Error('请先显示并解锁蒙版所属图层');
  const target=await paintTarget(doc,layer,engine,{target:'mask',maxPixels});
  try {
    const selection=await targetSelection(doc,engine,target),ctx=target.image.getContext('2d');
    try {
      const ink=selection.getContext('2d');ink.globalCompositeOperation='source-in';ink.fillStyle='#fff';ink.fillRect(0,0,selection.width,selection.height);
      ctx.globalCompositeOperation=(mode!=='reveal')!==Boolean(target.mask.inverted)?'destination-out':'source-over';
      ctx.drawImage(selection,0,0);ctx.globalCompositeOperation='source-over';
      return {canvas:target.image,mask:target.mask};
    } finally {selection.width=selection.height=1;}
  } catch(error){target.image.width=target.image.height=1;throw error;}
}
export async function fillPixelsSelection(doc,layer,engine,{mode,color,maxPixels=16000000}) {
  if(!doc.selection)throw Error('请先创建选区');
  if(!layer||layer.kind!=='image'||inherited(doc.layers,layer,'locked')||inherited(doc.layers,layer,'hidden'))throw Error('请选择已显示且未锁定的图片图层');
  if(mode==='fill'&&!color)throw Error('填色时必须指定颜色');
  const target=await paintTarget(doc,layer,engine,{target:'image',maxPixels});
  const selected=await targetSelection(doc,engine,target),out=surface(target.width,target.height);
  try{
    const ctx=out.getContext('2d');ctx.drawImage(target.image,0,0);
    if(mode==='fill'){const ink=selected.getContext('2d');ink.globalCompositeOperation='source-in';ink.fillStyle=color;ink.fillRect(0,0,selected.width,selected.height);}
    ctx.globalCompositeOperation=mode==='clear'?'destination-out':'source-over';ctx.drawImage(selected,0,0);
    return out;
  }catch(error){out.width=out.height=1;throw error;}
  finally{selected.width=selected.height=1;}
}
// Mask anchors and offsets describe a coordinate system independent of the layer.
export function paintGeometry(layers, layer, mask = false) {
  const m = mask ? layer.mask : null,
    anchor = m?.anchor;
  const width = anchor?.width || layer.width,
    height = anchor?.height || layer.height,
    warp = anchor ? anchor.warp : layer.warp;
  let transform = anchor?.matrix || worldMatrix(layers, layer);
  if (m?.offset)
    transform = multiply(
      transform,
      matrix({
        x: m.offset.x,
        y: m.offset.y,
        rotation: m.offset.rotation,
        scaleX: m.offset.scale,
        scaleY: m.offset.scale,
        width,
        height,
      }),
    );
  const back = inverse(transform),
    h = warp ? homography(warp) : null,
    inv = h ? inverse3(h) : null;
  return {
    width,
    height,
    local(x, y) {
      const p = point(back, x, y),
        q = { x: p.x / width, y: p.y / height };
      return inv ? project(inv, q.x, q.y) : q;
    },
    world(u, v) {
      const q = h ? project(h, u, v) : { x: u, y: v };
      return point(transform, q.x * width, q.y * height);
    },
  };
}

export async function paintTarget(doc, layer, engine, options) {
  const isMask = options.target === "mask",
    geometry = paintGeometry(doc.layers, layer, isMask);
  const checkSize = (width,height) => {
    if (width*height>(options.maxPixels??Infinity)) {
      const error=new Error('MCP 像素编辑目标限 1600 万像素，请缩小原图或蒙版');
      error.code='RESOURCE_LIMIT';throw error;
    }
  };
  if (!isMask) {
    const asset=layer.bitmap || doc.assets.find((a) => a.id === layer.assetId);
    checkSize(asset?.width,asset?.height);
    const image = await engine.image(asset);
    checkSize(image.naturalWidth,image.naturalHeight);
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      geometry,
    };
  }
  if (layer.mask?.disabled) throw new Error("请先启用蒙版，再绘制");
  const mask = layer.mask || { x: 0, y: 0, width: 1, height: 1 },
    asset =
      mask.bitmap ||
      (layer.kind === "image"
        ? layer.bitmap || doc.assets.find((a) => a.id === layer.assetId)
        : null);
  let width = Math.ceil(geometry.width),
    height = Math.ceil(geometry.height);
  if (asset) {
    checkSize(asset.width,asset.height);
    const image = await engine.image(asset);
    width = image.naturalWidth;
    height = image.naturalHeight;
  }
  checkSize(width,height);
  const raw = {
    ...layer,
    parentId: undefined,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    flipX: false,
    flipY: false,
    warp: undefined,
    width: geometry.width,
    height: geometry.height,
    mask: {
      ...mask,
      anchor: undefined,
      offset: undefined,
      inverted: false,
      feather: 0,
      density: 100,
    },
  };
  const image = await engine.mask(
    raw,
    { ...doc, layers: [raw] },
    {
      width,
      height,
      scale: 1,
      transform: [width / geometry.width, 0, 0, height / geometry.height, 0, 0],
    },
  );
  return { image, width, height, geometry, mask, owned: true };
}
