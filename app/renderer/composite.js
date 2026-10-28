import {shapePoints} from '../core/shapes.cjs';
import {loadTextFont,textFontFamily} from './font-face.js';
import {textFontWeight} from '../core/font-weights.cjs';
import {ImageCache} from '../core/image-cache.cjs';
import {
  matrix,
  worldMatrix,
  homography,
  multiply,
  corners,
  unsupported,
  validateLayers,
} from "../core/layers.cjs";
import { adjustPixels } from "../core/adjustments.cjs";
import { effectPadding } from '../core/effects.cjs';
import { applyEffects } from './effects.js';

const surface = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  if (c.width * c.height > 100000000) throw new Error("合成表面超过一亿像素");
  return c;
};
// Keep Canvas2D sampling stable across cold loads and readback-heavy editing.
// Perspective uses WebGL; 2D surfaces opt into the same CPU raster path.
export function originalUrl(asset) {
  return asset?.resource
    ? `tugou-media://original/${asset.resource}`
    : asset?.dataUrl?.startsWith("/api/studio/resource/")
      ? `tugou-media://original/${asset.dataUrl.split("/").at(-1)}`
      : asset?.dataUrl?.startsWith("data:image/")
        ? asset.dataUrl
        : null;
}
function warpEngine() {
  const canvas = surface(1, 1),
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
  if (!gl) throw new Error("当前设备不支持透视渲染");
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("透视着色器初始化失败");
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      "attribute vec2 p; uniform mat3 h; uniform vec2 size; varying vec2 uv; void main(){vec3 q=h*vec3(p,1.0);gl_Position=vec4(2.0*q.x/size.x-q.z,q.z-2.0*q.y/size.y,0.0,q.z);uv=p;}",
    ),
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      "precision highp float; varying vec2 uv; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,uv);}",
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("透视程序初始化失败");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  return {
    draw(ctx, image, h) {
      canvas.width = ctx.canvas.width;
      canvas.height = ctx.canvas.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(
        gl.getUniformLocation(program, "size"),
        canvas.width,
        canvas.height,
      );
      gl.uniformMatrix3fv(
        gl.getUniformLocation(program, "h"),
        false,
        new Float32Array([
          h[0],
          h[3],
          h[6],
          h[1],
          h[4],
          h[7],
          h[2],
          h[5],
          h[8],
        ]),
      );
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.drawImage(canvas, 0, 0);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.width = canvas.height = 1;
    },
  };
}
function paths(ctx, list, width = 1, height = 1) {
  for (const path of list || []) {
    const points = path.points;
    if (!points?.length) continue;
    const temporary = surface(ctx.canvas.width, ctx.canvas.height),
      c = temporary.getContext("2d", { willReadFrequently: true });
    c.setTransform(ctx.getTransform());
    c.fillStyle = "#fff";
    c.beginPath();
    c.moveTo(points[0] * width, points[1] * height);
    for (let i = 2; i < points.length; i += 2)
      c.lineTo(points[i] * width, points[i + 1] * height);
    c.closePath();
    c.fill();
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation =
      path.operation === "subtract"
        ? "destination-out"
        : path.operation === "intersect"
          ? "destination-in"
          : "source-over";
    ctx.drawImage(temporary, 0, 0);
    ctx.restore();
    temporary.width = temporary.height = 1;
  }
}
function textLines(ctx, text, width) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const ch of paragraph) {
      const metrics=ctx.measureText(line+ch);
      if (line && Math.max(metrics.width,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight) > width) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines;
}
function paintText(ctx, l) {
  ctx.font = `${l.fontStyle?.includes('italic')?'italic':'normal'} ${textFontWeight(l)} ${l.fontSize || 32}px "${textFontFamily(l).replace(/["\\]/g, "")}"`;
  ctx.fillStyle = l.color || "#222222";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${l.letterSpacing || 0}px`;
  const padding=2,lines = textLines(ctx, l.text || "", Math.max(1,l.width-padding*2));
  // A top baseline can put CJK accents and italic overhang outside the bitmap.
  const ascent=Math.ceil(Math.max(0,...lines.map(line=>ctx.measureText(line).actualBoundingBoxAscent)));
  const height = (l.fontSize || 32) * (l.lineHeight || 1.4);
  lines.forEach((line, i) => {
    if (i * height >= l.height) return;
    const y=padding+ascent+i*height;
    ctx.textAlign = ["center", "right"].includes(l.align) ? l.align : "left";
    const metrics=ctx.measureText(line),anchor=l.align==='center'?l.width/2:l.align==='right'?l.width-padding:padding;
    const x=Math.max(padding+metrics.actualBoundingBoxLeft,Math.min(l.width-padding-metrics.actualBoundingBoxRight,anchor));
    if (l.align === "justify" && i < lines.length - 1 && line.length > 1) {
      ctx.textAlign = "left";
      const chars = [...line],
        gap = (l.width-padding*2 - ctx.measureText(line).width) / (chars.length - 1);
      let at = padding;
      for (const ch of chars) {
        ctx.fillText(ch, at, y);
        at += ctx.measureText(ch).width + gap;
      }
    } else ctx.fillText(line, x, y);
  });
}
function paintShape(ctx, l) {
  let fill = l.color || "#b0bff2";
  if (l.gradient) {
    const angle = (l.gradient.angle * Math.PI) / 180,
      dx = (Math.cos(angle) * l.width) / 2,
      dy = (Math.sin(angle) * l.height) / 2;
    fill = ctx.createLinearGradient(
      l.width / 2 - dx,
      l.height / 2 - dy,
      l.width / 2 + dx,
      l.height / 2 + dy,
    );
    fill.addColorStop(0, l.color || "#b0bff2");
    fill.addColorStop(1, l.gradient.endColor);
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = l.stroke || "#222222";
  ctx.lineWidth = l.strokeWidth || 0;
  ctx.beginPath();
  const polygon=shapePoints(l.shape);
  if(polygon){polygon.forEach(([x,y],i)=>i?ctx.lineTo(x*l.width,y*l.height):ctx.moveTo(x*l.width,y*l.height));ctx.closePath();}
  else if (l.shape === "ellipse")
    ctx.ellipse(
      l.width / 2,
      l.height / 2,
      l.width / 2,
      l.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  else if (l.shape === "line") {
    ctx.moveTo(0, 0);
    ctx.lineTo(l.width, l.height);
  } else
    ctx.roundRect(
      0,
      0,
      l.width,
      l.height,
      Math.min(l.radius || 0, l.width / 2, l.height / 2),
    );
  if (l.shape !== "line" && l.fill !== false) ctx.fill();
  if (ctx.lineWidth > 0 && l.strokeWidth > 0) ctx.stroke();
}

export function renderPadding(layers) {
  const nodePad = (l, visited) => {
    if (visited.has(l.id)) throw new Error("图层或蒙版形成循环");
    const next = new Set([...visited, l.id]);
    const source = layers.find((n) => n.id === l.maskSourceId);
    return Math.max(
      l.kind === "group" ? walk(l.id, next) : 0,
      l.mask && !l.mask.disabled ? (l.mask.feather || 0) * 4 : 0,
      source && source.visible !== false ? nodePad(source, next) : 0,
    ) + Math.max(0,...(l.effects||[]).map(effectPadding));
  };
  const walk = (parent, visited = new Set()) => {
    let pad = 0;
    for (const l of layers.filter(
      (l) => l.parentId === parent && l.visible !== false,
    )) {
      if (visited.has(l.id)) throw new Error("图层形成循环");
      if (l.kind === "adjustment")
        pad +=
          l.adjustment?.type === "blur" ? (l.adjustment.radius || 0) * 4 : 0;
      pad = Math.max(pad, nodePad(l, visited));
    }
    return Math.ceil(pad);
  };
  return walk(undefined);
}
export class Compositor {
  constructor({imageBudget}={}) {
    this.images = new ImageCache(imageBudget);
    this.warp = null;
  }
  async image(asset) {
    const url = originalUrl(asset);
    if (!url) throw new Error("图层素材缺失，请检查素材库");
    return this.images.load(url,()=>new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => {
          reject(new Error("原图加载失败，未导出不完整画面"));
        };
        img.src = url;
      }));
  }
  prime(asset,image){return this.images.put(originalUrl(asset),image);}
  dispose() {
    this.images.clear();
    this.warp?.dispose();
  }
  async content(l, doc, scale) {
    const face=l.kind==='text'?await loadTextFont(l):null;
    if (l.kind === "image")
      return this.image(l.bitmap || doc.assets.find((a) => a.id === l.assetId));
    const resolution = Math.min(4, Math.max(0.01, scale)),
      c = surface(l.width * resolution, l.height * resolution),
      ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.scale(c.width / l.width, c.height / l.height);
    if (l.kind === "text") {
      // Another concurrent preview may evict this face while the load is awaited.
      const cached=!face||document.fonts.has(face);
      if(face&&!cached)document.fonts.add(face);
      try{paintText(ctx,l);}finally{if(face&&!cached)document.fonts.delete(face);}
    }
    if (l.kind === "shape") paintShape(ctx, l);
    return c;
  }
  geometry(ctx, image, l, m) {
    if (!l.warp) {
      ctx.save();
      ctx.setTransform(...m);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, l.width, l.height);
      ctx.restore();
      return;
    }
    const h = homography(l.warp);
    const a = [
      m[0] * l.width,
      m[1] * l.width,
      m[2] * l.height,
      m[3] * l.height,
      m[4],
      m[5],
    ];
    const q = [
      a[0] * h[0] + a[2] * h[3] + a[4] * h[6],
      a[0] * h[1] + a[2] * h[4] + a[4] * h[7],
      a[0] * h[2] + a[2] * h[5] + a[4],
      a[1] * h[0] + a[3] * h[3] + a[5] * h[6],
      a[1] * h[1] + a[3] * h[4] + a[5] * h[7],
      a[1] * h[2] + a[3] * h[5] + a[5],
      h[6],
      h[7],
      1,
    ];
    this.warp ||= warpEngine();
    this.warp.draw(ctx, image, q);
  }
  async mask(l, doc, frame) {
    const mask = l.mask,
      c = surface(frame.width, frame.height),
      ctx = c.getContext("2d", { willReadFrequently: true });
    if (!mask || mask.disabled) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      return c;
    }
    const anchor = mask.anchor,
      geometry = {
        width: anchor?.width || l.width,
        height: anchor?.height || l.height,
        warp: anchor ? anchor.warp : l.warp,
      };
    let m = anchor?.matrix || worldMatrix(doc.layers, l);
    if (mask.offset)
      m = multiply(
        m,
        matrix({
          x: mask.offset.x,
          y: mask.offset.y,
          rotation: mask.offset.rotation,
          scaleX: mask.offset.scale,
          scaleY: mask.offset.scale,
          width: geometry.width,
          height: geometry.height,
        }),
      );
    m = multiply(frame.transform, m);
    const preview = frame.maskOverrides?.get(l.id);
    if (preview || mask.bitmap) {
      this.geometry(
        ctx,
        preview || (await this.image(mask.bitmap)),
        geometry,
        m,
      );
    } else if (geometry.warp) {
      const resolution = Math.min(1, frame.scale),
        local = surface(
          geometry.width * resolution,
          geometry.height * resolution,
        ),
        localCtx = local.getContext("2d", { willReadFrequently: true });
      localCtx.scale(local.width, local.height);
      if (mask.paths) paths(localCtx, mask.paths);
      else {
        localCtx.fillStyle = "#fff";
        localCtx.fillRect(
          mask.x ?? 0,
          mask.y ?? 0,
          mask.width ?? 1,
          mask.height ?? 1,
        );
      }
      this.geometry(ctx, local, geometry, m);
      local.width = local.height = 1;
    } else {
      ctx.setTransform(
        ...multiply(m, [geometry.width, 0, 0, geometry.height, 0, 0]),
      );
      if (mask.paths) paths(ctx, mask.paths);
      else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(
          mask.x ?? 0,
          mask.y ?? 0,
          mask.width ?? 1,
          mask.height ?? 1,
        );
      }
      ctx.resetTransform();
    }
    if (mask.feather) {
      const blurred = surface(c.width, c.height),
        b = blurred.getContext("2d", { willReadFrequently: true });
      b.filter = `blur(${mask.feather * frame.scale}px)`;
      b.drawImage(c, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(blurred, 0, 0);
      blurred.width = blurred.height = 1;
    }
    if (mask.inverted) {
      ctx.globalCompositeOperation = "source-out";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
    }
    if(mask.density!==undefined&&mask.density<100){
      ctx.globalAlpha=1-Math.max(0,mask.density)/100;ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.globalAlpha=1;
    }
    return c;
  }
  async node(l, doc, frame, seen = new Set()) {
    frame.signal?.throwIfAborted();
    if (seen.has(l.id)) throw new Error("图层或蒙版形成循环");
    seen = new Set(seen);
    seen.add(l.id);
    if (l.visible === false) return surface(1,1);
    const intersects = (layer, margin = 2) => {
      if (layer.visible === false || layer.kind === "adjustment") return false;
      const padding = margin + Math.max(0, ...(layer.effects || []).map(effectPadding)) * frame.scale;
      if (layer.kind === "group" && !layer.artboard)
        return doc.layers.some(child => child.parentId === layer.id && intersects(child, padding));
      if (layer.artboard && layer.clipContent===false && doc.layers.some(child=>child.parentId===layer.id&&intersects(child,padding)))return true;
      const points = corners(doc.layers, layer).map(({x, y}) => [
        x * frame.scale + frame.transform[4],
        y * frame.scale + frame.transform[5],
      ]);
      return !(Math.max(...points.map(p => p[0])) + padding < 0 ||
          Math.max(...points.map(p => p[1])) + padding < 0 ||
          Math.min(...points.map(p => p[0])) - padding > frame.width ||
          Math.min(...points.map(p => p[1])) - padding > frame.height);
    };
    // Keep an empty surface as the clipping base; only skip invisible raster work.
    if (l.kind !== "adjustment" && !intersects(l)) return surface(1,1);
    const c = surface(frame.width, frame.height),
      ctx = c.getContext("2d", { willReadFrequently: true });
    if (l.kind === "group") {
      if (l.artboard) {
        const m=multiply(frame.transform,worldMatrix(doc.layers,l));
        ctx.save();ctx.setTransform(...m);
        if(l.clipContent!==false){ctx.beginPath();ctx.rect(0,0,l.width,l.height);ctx.clip();}
        if(l.background!=='transparent'){ctx.fillStyle=l.background;ctx.fillRect(0,0,l.width,l.height);}
        ctx.setTransform(1,0,0,1,0,0);
        await this.siblings(ctx,doc,l.id,frame,seen);ctx.restore();
      } else await this.siblings(ctx, doc, l.id, frame, seen);
    }
    else if (l.kind !== "adjustment") {
      const content =
        frame.overrides?.get(l.id) ||
        (await this.content(
          l,
          doc,
          frame.scale *
            Math.max(Math.abs(l.scaleX || 1), Math.abs(l.scaleY || 1)),
        ));
      this.geometry(
        ctx,
        content,
        l,
        multiply(frame.transform, worldMatrix(doc.layers, l)),
      );
      if (l.kind !== "image") content.width = content.height = 1;
    }
    const preview = frame.maskPreview?.id === l.id ? frame.maskPreview.mode : null;
    if (l.mask && (preview === 'overlay' || (!preview && !l.mask.disabled))) {
      const mask = await this.mask(preview ? {...l,mask:{...l.mask,disabled:false}} : l, doc, frame);
      if (preview === 'overlay') {
        // Tint only hidden source pixels; keep transparent pixels and board clipping intact.
        const tint = surface(c.width,c.height), ink = tint.getContext('2d');
        ink.fillStyle='#ff354f';ink.fillRect(0,0,tint.width,tint.height);
        ink.globalCompositeOperation='destination-out';ink.drawImage(mask,0,0);
        ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=.5;ctx.drawImage(tint,0,0);ctx.globalAlpha=1;
        tint.width=tint.height=1;
      } else {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask, 0, 0);
      }
      mask.width = mask.height = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    if (l.maskSourceId) {
      const source = doc.layers.find((item) => item.id === l.maskSourceId);
      if (!source) throw new Error("蒙版来源图层缺失");
      const mask = await this.node(source, doc, frame, seen);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = source.opacity;
      ctx.drawImage(mask, 0, 0);
      mask.width = mask.height = 1;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    applyEffects(c,l.effects,frame.scale);
    return c;
  }
  async adjustment(ctx, layer, doc, frame) {
    if (layer.visible === false || !layer.opacity) return;
    frame.signal?.throwIfAborted();
    const source = ctx.getImageData(0, 0, frame.width, frame.height),
      result = new ImageData(
        new Uint8ClampedArray(source.data),
        frame.width,
        frame.height,
      );
    if (layer.adjustment.type === "blur" && layer.adjustment.radius > 0) {
      const blurred = surface(frame.width, frame.height),
        b = blurred.getContext("2d", { willReadFrequently: true });
      try {
        b.filter = `blur(${layer.adjustment.radius * frame.scale}px)`;
        b.drawImage(ctx.canvas, 0, 0);
        result.data.set(b.getImageData(0, 0, frame.width, frame.height).data);
      } finally {
        blurred.width = blurred.height = 1;
      }
    } else
      adjustPixels(result.data, frame.width, layer.adjustment, {
        scale: frame.scale,
        x: -frame.transform[4] / frame.scale,
        y: -frame.transform[5] / frame.scale,
      });
    let mask;
    if ((layer.mask && !layer.mask.disabled) || layer.maskSourceId) {
      mask = await this.mask(layer, doc, frame);
      if (layer.maskSourceId) {
        const sourceLayer = doc.layers.find((l) => l.id === layer.maskSourceId);
        if (!sourceLayer || sourceLayer.kind === "adjustment")
          throw new Error("调整蒙版需要普通来源图层");
        const linked = await this.node(sourceLayer, doc, frame),
          m = mask.getContext("2d");
        m.globalCompositeOperation = "destination-in";
        m.globalAlpha = sourceLayer.opacity;
        m.drawImage(linked, 0, 0);
        linked.width = linked.height = 1;
      }
    }
    try {
      const alpha = mask
        ?.getContext("2d")
        .getImageData(0, 0, frame.width, frame.height).data;
      if (layer.blend && layer.blend !== "source-over") {
        const blend = surface(frame.width, frame.height),
          over = surface(frame.width, frame.height),
          b = blend.getContext("2d", { willReadFrequently: true }),
          o = over.getContext("2d", { willReadFrequently: true }),
          opaque = new ImageData(
            new Uint8ClampedArray(source.data),
            frame.width,
            frame.height,
          );
        try {
          for (let i = 3; i < result.data.length; i += 4) {
            opaque.data[i] = 255;
            result.data[i] = 255;
          }
          b.putImageData(opaque, 0, 0);
          o.putImageData(result, 0, 0);
          b.globalCompositeOperation = layer.blend;
          b.drawImage(over, 0, 0);
          result.data.set(b.getImageData(0, 0, frame.width, frame.height).data);
        } finally {
          blend.width = blend.height = over.width = over.height = 1;
        }
      }
      for (let i = 0; i < source.data.length; i += 4) {
        const weight = layer.opacity * (alpha ? alpha[i + 3] / 255 : 1);
        for (let c = 0; c < 3; c++)
          source.data[i + c] +=
            (result.data[i + c] - source.data[i + c]) * weight;
      }
      ctx.putImageData(source, 0, 0);
    } finally {
      if (mask) mask.width = mask.height = 1;
    }
  }
  async siblings(ctx, doc, parentId, frame, seen, sequence) {
    const children =
      sequence ||
      doc.layers.filter((l) => l.parentId === parentId && l.visible !== false);
    if (children.some((l) => l.kind === "adjustment" && l.clipping)) {
      const chains = [];
      for (const l of children) {
        if (!l.clipping || !chains.length) chains.push([]);
        chains.at(-1).push(l);
      }
      if (chains.length > 1) {
        for (const chain of chains)
          await this.siblings(ctx, doc, parentId, frame, seen, chain);
        return;
      }
    }
    // Only clipped adjustments need an isolated color target. Ordinary clipping
    // retains its existing backdrop blend and independent opacity semantics.
    if (!children.some((l) => l.kind === "adjustment" && l.clipping)) {
      let base = null,
        baseOpacity = 1;
      try {
        for (const l of children) {
          if (l.kind === "adjustment") {
            await this.adjustment(ctx, l, doc, frame);
            continue;
          }
          const c = await this.node(l, doc, frame, seen);
          if (l.clipping) {
            const local = c.getContext("2d", { willReadFrequently: true });
            local.globalCompositeOperation = "destination-in";
            local.globalAlpha = baseOpacity;
            if (base) local.drawImage(base, 0, 0);
            else local.clearRect(0, 0, c.width, c.height);
          }
          ctx.globalAlpha = l.opacity;
          ctx.globalCompositeOperation = l.blend || "source-over";
          ctx.drawImage(c, 0, 0);
          if (!l.clipping) {
            if (base) base.width = base.height = 1;
            base = c;
            baseOpacity = l.opacity;
          } else c.width = c.height = 1;
        }
      } finally {
        if (base) base.width = base.height = 1;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      return;
    }
    let base = null,
      baseLayer = null,
      clipMask = null;
    const flush = () => {
      if (!base) return;
      ctx.globalCompositeOperation = baseLayer.blend || "source-over";
      ctx.globalAlpha = baseLayer.opacity;
      ctx.drawImage(base, 0, 0);
      base.width = base.height = 1;
      base = null;
      if (clipMask) clipMask.width = clipMask.height = 1;
      clipMask = null;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };
    try {
      for (const l of children) {
        if (l.visible === false) continue;
        if (l.kind === "adjustment") {
          if (l.clipping) {
            if (base)
              await this.adjustment(
                base.getContext("2d", { willReadFrequently: true }),
                l,
                doc,
                frame,
              );
          } else {
            flush();
            await this.adjustment(ctx, l, doc, frame);
          }
          continue;
        }
        if (!l.clipping) flush();
        const c = await this.node(l, doc, frame, seen);
        if (l.clipping) {
          if (base) {
            if (!clipMask) {
              clipMask = surface(frame.width, frame.height);
              clipMask.getContext("2d").drawImage(base, 0, 0);
            }
            const b = base.getContext("2d", { willReadFrequently: true }),
              local = c.getContext("2d", { willReadFrequently: true });
            local.globalCompositeOperation = "destination-in";
            local.drawImage(clipMask, 0, 0);
            b.globalCompositeOperation = l.blend || "source-over";
            b.globalAlpha = l.opacity;
            b.drawImage(c, 0, 0);
            b.globalAlpha = 1;
            b.globalCompositeOperation = "source-over";
          }
          c.width = c.height = 1;
        } else {
          base = c;
          baseLayer = l;
        }
      }
      flush();
    } finally {
      if (base) base.width = base.height = 1;
      if (clipMask) clipMask.width = clipMask.height = 1;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }
  async render(
    doc,
    target,
    {
      scale = 1,
      x = 0,
      y = 0,
      width = doc.width,
      height = doc.height,
      transparent = false,
      signal,
      overrides,
      maskOverrides,
      maskPreview,
      padded = false,
    } = {},
  ) {
    signal?.throwIfAborted();
    validateLayers(doc.layers);
    const effectWork=doc.layers.some(l=>l.effects?.some(e=>e.enabled&&e.opacity>0));
    if(effectWork && Math.ceil(width*scale)*Math.ceil(height*scale)*64>384*1024*1024)throw new Error('特效临时内存超出384 MiB，请缩小预览范围或使用分块导出');
    if (!padded) {
      const pad = renderPadding(doc.layers);
      if (pad > 0) {
        const pixelPad = Math.ceil(pad * scale),
          margin = pixelPad / scale;
        if (
          (Math.ceil(width * scale) + 2 * pixelPad) *
            (Math.ceil(height * scale) + 2 * pixelPad) *
          (effectWork?64:24) >
          384 * 1024 * 1024
        )
          throw new Error("滤镜临时内存超出384 MiB，请减小预览范围或滤镜半径");
        const expanded = surface(1, 1);
        try {
          await this.render(doc, expanded, {
            scale,
            x: x - margin,
            y: y - margin,
            width: width + 2 * margin,
            height: height + 2 * margin,
            transparent,
            signal,
            overrides,
            maskOverrides,
            maskPreview,
            padded: true,
          });
          target.width = Math.ceil(width * scale);
          target.height = Math.ceil(height * scale);
          target
            .getContext("2d", { willReadFrequently: true })
            .drawImage(
              expanded,
              pixelPad,
              pixelPad,
              target.width,
              target.height,
              0,
              0,
              target.width,
              target.height,
            );
          return target;
        } finally {
          expanded.width = expanded.height = 1;
        }
      }
    }
    // Raster edits and undo must not retain every decoded historical image.
    const retained = new Set([originalUrl(doc.selection?.bitmap)]);
    for (const layer of doc.layers) {
      if (layer.kind === "image")
        retained.add(
          originalUrl(
            layer.bitmap || doc.assets.find((a) => a.id === layer.assetId),
          ),
        );
      retained.add(originalUrl(layer.mask?.bitmap));
    }
    for (const url of this.images.keys())
      if (!retained.has(url)) this.images.delete(url);
    target.width = Math.ceil(width * scale);
    target.height = Math.ceil(height * scale);
    const ctx = target.getContext("2d", { willReadFrequently: true }),
      frame = {
        width: target.width,
        height: target.height,
        scale,
        transform: [scale, 0, 0, scale, -x * scale, -y * scale],
        signal,
        overrides,
        maskOverrides,
        maskPreview,
      };
    ctx.save();
    if (!doc.infiniteWorkspace) {
      ctx.beginPath();
      ctx.rect(-x * scale, -y * scale, doc.width * scale, doc.height * scale);
      ctx.clip();
    }
    if (!doc.infiniteWorkspace && !transparent && doc.background !== "transparent") {
      ctx.fillStyle = doc.background;
      ctx.fillRect(
        -x * scale,
        -y * scale,
        doc.width * scale,
        doc.height * scale,
      );
    }
    await this.siblings(ctx, doc, undefined, frame, new Set());
    ctx.restore();
    signal?.throwIfAborted();
    return target;
  }
  async export(doc, { transparent = false, signal, progress = () => {} } = {}) {
    const issues = unsupported(doc.layers);
    if (issues.length) throw new Error(issues.join("；"));
    if (
      doc.width > 32767 ||
      doc.height > 32767 ||
      doc.width * doc.height > 100000000
    )
      throw new Error("PNG 导出支持单边32767、总计一亿像素；请调整画布尺寸");
    await document.fonts.ready;
    const out = surface(doc.width, doc.height),
      ctx = out.getContext("2d", { willReadFrequently: true });
    try {
      const total = Math.ceil(doc.width / 1024) * Math.ceil(doc.height / 1024);
      let count = 0;
      for (let y = 0; y < doc.height; y += 1024)
        for (let x = 0; x < doc.width; x += 1024) {
          signal?.throwIfAborted();
          const pad = 0,
            left = Math.max(0, x - pad),
            top = Math.max(0, y - pad),
            width = Math.min(
              doc.width - left,
              Math.min(1024, doc.width - x) + pad * 2,
            ),
            height = Math.min(
              doc.height - top,
              Math.min(1024, doc.height - y) + pad * 2,
            );
          const tile = surface(width, height);
          await this.render(doc, tile, {
            x: left,
            y: top,
            width,
            height,
            transparent,
            signal,
          });
          ctx.drawImage(
            tile,
            x - left,
            y - top,
            Math.min(1024, doc.width - x),
            Math.min(1024, doc.height - y),
            x,
            y,
            Math.min(1024, doc.width - x),
            Math.min(1024, doc.height - y),
          );
          tile.width = tile.height = 1;
          progress(++count / total);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      signal?.throwIfAborted();
      const blob = await new Promise((resolve) =>
        out.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG 编码失败");
      signal?.throwIfAborted();
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      out.width = out.height = 1;
    }
  }
}
