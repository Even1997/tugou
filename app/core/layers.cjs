const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const point = (m, x, y) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
function inverse(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-10) throw new Error("变换不可逆");
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
function matrix(layer) {
  const r = ((layer.rotation || 0) * Math.PI) / 180,
    sx = layer.scaleX ?? 1,
    sy = layer.scaleY ?? 1;
  let m = multiply(
    [
      Math.cos(r),
      Math.sin(r),
      -Math.sin(r),
      Math.cos(r),
      layer.x || 0,
      layer.y || 0,
    ],
    [sx, 0, Math.tan(((layer.skewX || 0) * Math.PI) / 180) * sy, sy, 0, 0],
  );
  return multiply(m, [
    layer.flipX ? -1 : 1,
    0,
    0,
    layer.flipY ? -1 : 1,
    layer.flipX ? layer.width : 0,
    layer.flipY ? layer.height : 0,
  ]);
}
function worldMatrix(layers, layer, seen = new Set()) {
  if (seen.has(layer.id)) throw new Error("图层分组形成循环");
  seen.add(layer.id);
  const parent = layers.find((l) => l.id === layer.parentId);
  return parent
    ? multiply(worldMatrix(layers, parent, seen), matrix(layer))
    : matrix(layer);
}
function decompose(m) {
  const sx = Math.hypot(m[0], m[1]),
    sy = (m[0] * m[3] - m[1] * m[2]) / sx;
  if (sx < 0.00001 || Math.abs(sy) < 0.00001) throw new Error("变换不可逆");
  return {
    x: m[4],
    y: m[5],
    rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
    scaleX: sx,
    scaleY: sy,
    skewX: (Math.atan((m[0] * m[2] + m[1] * m[3]) / (sx * sy)) * 180) / Math.PI,
    flipX: false,
    flipY: false,
  };
}
// Homography from the unit square to a convex quadrilateral (row-major).
function homography(q = [0, 0, 1, 0, 1, 1, 0, 1]) {
  const rows = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].flatMap(([x, y], i) => {
    const u = q[i * 2],
      v = q[i * 2 + 1];
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++)
      if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const divisor = rows[i][i];
    if (Math.abs(divisor) < 1e-10) throw new Error("透视四角不能重合或折叠");
    for (let k = i; k < 9; k++) rows[i][k] /= divisor;
    for (let j = 0; j < 8; j++)
      if (j !== i) {
        const factor = rows[j][i];
        for (let k = i; k < 9; k++) rows[j][k] -= factor * rows[i][k];
      }
  }
  return [...rows.map((row) => row[8]), 1];
}
function project(h, x, y) {
  const d = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / d,
    y: (h[3] * x + h[4] * y + h[5]) / d,
  };
}
function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const result = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * result[0] + b * result[3] + c * result[6];
  if (Math.abs(det) < 1e-12) throw new Error("透视不可逆");
  return result.map((n) => n / det);
}
function localPoint(layers, layer, x, y) {
  const p = point(inverse(worldMatrix(layers, layer)), x, y);
  if (!layer.warp) return p;
  const q = project(
    inverse3(homography(layer.warp)),
    p.x / layer.width,
    p.y / layer.height,
  );
  return { x: q.x * layer.width, y: q.y * layer.height };
}
function localBounds(layers, layer) {
  const fallback={x:0,y:0,width:layer.width,height:layer.height};
  if(layer.kind!=='group'||layer.artboard)return fallback;
  const children=layers.filter(l=>l.parentId===layer.id&&l.visible!==false&&l.kind!=='adjustment');
  if(!children.length)return fallback;
  const points=children.flatMap(child=>localCorners(layers,child).map(p=>point(matrix(child),p.x,p.y)));
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(1,Math.max(...points.map(p=>p.x))-x),height:Math.max(1,Math.max(...points.map(p=>p.y))-y)};
}
function localCorners(layers,layer) {
  const b=localBounds(layers,layer),q=layer.warp||[0,0,1,0,1,1,0,1];
  return [0,2,4,6].map(i=>({x:b.x+q[i]*b.width,y:b.y+q[i+1]*b.height}));
}
function corners(layers, layer) {
  const m = worldMatrix(layers, layer);
  return localCorners(layers,layer).map(p=>point(m,p.x,p.y));
}
function bounds(layers, ids) {
  const pts = layers
    .filter((l) => ids.includes(l.id))
    .flatMap((l) => corners(layers, l));
  if (!pts.length) return null;
  const x = Math.min(...pts.map((p) => p.x)),
    y = Math.min(...pts.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...pts.map((p) => p.x)) - x,
    height: Math.max(...pts.map((p) => p.y)) - y,
  };
}
function inherited(layers, layer, key) {
  const seen = new Set();
  while (layer) {
    if (seen.has(layer.id)) return true;
    seen.add(layer.id);
    if (key === "locked" ? layer.locked : layer.visible === false) return true;
    layer = layers.find((l) => l.id === layer.parentId);
  }
  return false;
}
function roots(layers, ids) {
  const selected = new Set(ids);
  return layers
    .filter((l) => selected.has(l.id) && !inherited(layers, l, "locked"))
    .filter((l) => {
      let p = l.parentId;
      while (p) {
        if (selected.has(p)) return false;
        p = layers.find((n) => n.id === p)?.parentId;
      }
      return true;
    });
}
function descendants(layers, ids) {
  const found = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of layers)
      if (found.has(l.parentId) && !found.has(l.id)) {
        found.add(l.id);
        changed = true;
      }
  }
  return found;
}
function createLayer(kind, patch = {}) {
  return {
    id: crypto.randomUUID(),
    kind,
    name: { image: "图片", text: "文字", shape: "形状", group: "分组" }[kind],
    x: 80,
    y: 80,
    width: 400,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    flipY: false,
    blend: "source-over",
    ...patch,
  };
}
function moveLayers(layers, ids, dx, dy) {
  const selected = new Set(roots(layers, ids).map((l) => l.id));
  return layers.map((l) => {
    if (!selected.has(l.id)) return l;
    const parent = layers.find((p) => p.id === l.parentId),
      m = parent ? inverse(worldMatrix(layers, parent)) : identity;
    return {
      ...l,
      x: l.x + m[0] * dx + m[2] * dy,
      y: l.y + m[1] * dx + m[3] * dy,
    };
  });
}
function deleteLayers(layers, ids) {
  const selected = descendants(
    layers,
    roots(layers, ids).map((l) => l.id),
  );
  return layers
    .filter((l) => !selected.has(l.id))
    .map((l) =>
      selected.has(l.maskSourceId) ? { ...l, maskSourceId: undefined } : l,
    );
}
function duplicateLayers(layers, ids) {
  const selected = descendants(
      layers,
      roots(layers, ids).map((l) => l.id),
    ),
    mapping = new Map([...selected].map((id) => [id, crypto.randomUUID()]));
  const copies = layers
    .filter((l) => selected.has(l.id))
    .map((l) => ({
      ...structuredClone(l),
      id: mapping.get(l.id),
      parentId: mapping.get(l.parentId) || l.parentId,
      maskSourceId: mapping.get(l.maskSourceId) || l.maskSourceId,
      name: `${l.name} 副本`,
      x: l.x + (selected.has(l.parentId) ? 0 : 20),
      y: l.y + (selected.has(l.parentId) ? 0 : 20),
    }));
  return {
    layers: [...layers, ...copies],
    ids: roots(layers, ids).map((l) => mapping.get(l.id)),
  };
}
function groupLayers(layers, ids) {
  const chosen = roots(layers, ids);
  if (!chosen.length) throw new Error("请选择可编辑图层");
  if (chosen.some((l) => l.parentId !== chosen[0].parentId))
    throw new Error("请先选择同一组内的图层");
  const group = createLayer("group", {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    parentId: chosen[0].parentId,
  });
  const local = chosen.flatMap((l) => {
    const m = matrix(l);
    return localCorners(layers,l).map(p=>point(m,p.x,p.y));
  });
  group.x = Math.min(...local.map((p) => p.x));
  group.y = Math.min(...local.map((p) => p.y));
  group.width = Math.max(1, Math.max(...local.map((p) => p.x)) - group.x);
  group.height = Math.max(1, Math.max(...local.map((p) => p.y)) - group.y);
  const set = new Set(chosen.map((l) => l.id)),
    position = Math.max(...chosen.map((l) => layers.indexOf(l)));
  const next = layers.map((l) =>
    set.has(l.id)
      ? { ...l, parentId: group.id, x: l.x - group.x, y: l.y - group.y }
      : l,
  );
  next.splice(position + 1, 0, group);
  return { layers: next, ids: [group.id] };
}
function ungroupLayers(layers, id) {
  const group = layers.find((l) => l.id === id);
  if (!group || group.kind !== "group" || inherited(layers, group, "locked"))
    throw new Error("请选择未锁定的分组");
  if (
    group.opacity !== 1 ||
    group.mask ||
    group.maskSourceId ||
    group.effects?.some(e=>e.enabled) ||
    group.clipping ||
    group.blend !== "source-over"
  )
    throw new Error("带混合、蒙版或特效的分组请先合并，避免取消分组改变外观");
  const children = layers.filter((l) => l.parentId === id);
  if(children.some(l=>l.kind==='adjustment'&&!l.clipping&&l.visible!==false))throw new Error('分组中的调整图层会改变作用范围，请先合并分组再拆组');
  const transformed = children.map((l) => ({
    ...l,
    ...decompose(multiply(matrix(group), matrix(l))),
    parentId: group.parentId,
    visible: group.visible !== false && l.visible !== false,
  }));
  const childIds = new Set(children.map((l) => l.id));
  return {
    layers: layers.flatMap((l) =>
      l.id === id ? transformed : childIds.has(l.id) ? [] : [l],
    ),
    ids: children.map((l) => l.id),
  };
}
function reorder(layers, ids, action) {
  const selected = new Set(roots(layers, ids).map((l) => l.id));
  let next = [...layers];
  for (const parentId of new Set(
    layers.filter((l) => selected.has(l.id)).map((l) => l.parentId),
  )) {
    const indices = next
      .map((l, i) => (l.parentId === parentId ? i : -1))
      .filter((i) => i >= 0);
    let siblings = indices.map((i) => next[i]);
    if (action === "top" || action === "bottom") {
      const a = siblings.filter((l) => selected.has(l.id)),
        b = siblings.filter((l) => !selected.has(l.id));
      siblings = action === "top" ? [...b, ...a] : [...a, ...b];
    } else if (action === "up") {
      for (let i = siblings.length - 2; i >= 0; i--)
        if (selected.has(siblings[i].id) && !selected.has(siblings[i + 1].id))
          [siblings[i], siblings[i + 1]] = [siblings[i + 1], siblings[i]];
    } else {
      for (let i = 1; i < siblings.length; i++)
        if (selected.has(siblings[i].id) && !selected.has(siblings[i - 1].id))
          [siblings[i], siblings[i - 1]] = [siblings[i - 1], siblings[i]];
    }
    indices.forEach((index, i) => {
      next[index] = siblings[i];
    });
  }
  return next;
}
function relocateLayers(layers, ids, targetId, placement = "inside") {
  validateLayers(layers);
  const chosen = roots(layers, ids),
    target = layers.find((l) => l.id === targetId);
  if (
    !chosen.length ||
    ids.some((id) =>
      inherited(
        layers,
        layers.find((l) => l.id === id),
        "locked",
      ),
    )
  )
    throw new Error("请选择未锁定的图层");
  const moving = new Set(chosen.map((l) => l.id)),
    subtree = descendants(layers, [...moving]);
  if (targetId && (!target || subtree.has(targetId)))
    throw new Error("不能把图层放入自身或子层");
  const parentId = placement === "inside" ? targetId : target?.parentId;
  const parent = layers.find((l) => l.id === parentId);
  if (
    parentId &&
    (!parent || parent.kind !== "group" || inherited(layers, parent, "locked"))
  )
    throw new Error("目标必须是未锁定分组");
  if (target && inherited(layers, target, "locked"))
    throw new Error("目标图层已锁定");
  const neutral = (id) => {
    while (id) {
      const l = layers.find((n) => n.id === id);
      if (
        l.opacity !== 1 ||
        l.visible === false ||
        l.mask ||
        l.maskSourceId ||
        l.clipping ||
        l.effects?.some((e) => e.enabled) ||
        l.blend !== "source-over"
      )
        throw new Error("跨组移动会改变蒙版、混合或透明度，请先解除关联");
      id = l.parentId;
    }
  };
  for (const l of chosen)
    if (l.parentId !== parentId) {
      neutral(l.parentId);
      neutral(parentId);
      const siblings = layers.filter((n) => n.parentId === l.parentId),
        next = siblings[siblings.indexOf(l) + 1];
      if (l.clipping || next?.clipping || l.blend !== "source-over")
        throw new Error("请先解除跨组图层的剪贴或混合关联");
    }
  const transform = parent ? inverse(worldMatrix(layers, parent)) : identity;
  const moved = chosen.map((l) =>
    l.parentId === parentId
      ? l
      : {
          ...l,
          ...decompose(multiply(transform, worldMatrix(layers, l))),
          parentId,
        },
  );
  const remaining = layers.filter((l) => !moving.has(l.id));
  const index =
    placement === "inside"
      ? remaining.length
      : remaining.indexOf(target) + (placement === "above" ? 1 : 0);
  remaining.splice(index, 0, ...moved);
  validateLayers(remaining);
  return remaining;
}
function alignLayers(document, ids, axis, mode) {
  const layers = document.layers,
    chosen = roots(layers, ids);
  if (!chosen.length) return layers;
  const extent =
    chosen.length === 1
      ? { x: 0, y: 0, width: document.width, height: document.height }
      : bounds(
          layers,
          chosen.map((l) => l.id),
        );
  const dimension = axis === "x" ? "width" : "height",
    factor = mode === "start" ? 0 : mode === "center" ? 0.5 : 1;
  return chosen.reduce((next, l) => {
    const box = bounds(layers, [l.id]);
    const delta =
      extent[axis] +
      extent[dimension] * factor -
      box[axis] -
      box[dimension] * factor;
    return moveLayers(
      next,
      [l.id],
      axis === "x" ? delta : 0,
      axis === "y" ? delta : 0,
    );
  }, layers);
}
function distributeLayers(layers, ids, axis) {
  const chosen = roots(layers, ids)
    .map((l) => ({ l, b: bounds(layers, [l.id]) }))
    .sort((a, b) => a.b[axis] - b.b[axis]);
  if (chosen.length < 3) throw new Error("等距分布需要至少三个图层");
  const d = axis === "x" ? "width" : "height",
    first = chosen[0].b,
    last = chosen.at(-1).b,
    gap =
      (last[axis] +
        last[d] -
        first[axis] -
        chosen.reduce((sum, { b }) => sum + b[d], 0)) /
      (chosen.length - 1);
  let cursor = first[axis],
    next = layers;
  for (const { l, b } of chosen) {
    const delta = cursor - b[axis];
    next = moveLayers(
      next,
      [l.id],
      axis === "x" ? delta : 0,
      axis === "y" ? delta : 0,
    );
    cursor += b[d] + gap;
  }
  return next;
}
function validateLayers(layers) {
  const ids = new Set();
  for (const l of layers) {
    if (!l || typeof l.id !== "string" || ids.has(l.id))
      throw new Error("图层标识重复或无效");
    ids.add(l.id);
    if(l.fontResource&&(l.kind!=='text'||!/^[a-f0-9]{64}\.ttf$/.test(l.fontResource.resource)||typeof l.fontResource.projectId!=='string'||typeof l.fontResource.jobId!=='string'))throw Error('文字字体资源无效');
    if (l.kind === 'adjustment') require('./adjustments.cjs').validateAdjustment(l.adjustment);
    if(l.effects!==undefined){
      if(!Array.isArray(l.effects)||new Set(l.effects.map(e=>e?.id)).size!==l.effects.length)throw new Error('图层特效列表或标识无效');
      l.effects.forEach(require('./effects.cjs').validateEffect);
      if(l.kind==='adjustment'&&l.effects.some(e=>e.enabled))throw new Error('请将特效应用到图片、文字、形状或分组');
    }
    if (!["image", "text", "shape", "group", "adjustment"].includes(l.kind))
      throw new Error(`不支持的图层类型：${l.kind}`);
    for (const key of ["x", "y", "width", "height", "rotation", "opacity"])
      if (!Number.isFinite(l[key])) throw new Error("图层参数无效");
    if(l.mask?.density!==undefined&&(!Number.isFinite(l.mask.density)||l.mask.density<0||l.mask.density>100))throw Error('蒙版浓度需要在 0–100 之间');
    if (l.width <= 0 || l.height <= 0 || l.opacity < 0 || l.opacity > 1)
      throw new Error("图层尺寸或透明度无效");
    for (const key of ["scaleX", "scaleY", "skewX"])
      if (l[key] !== undefined && !Number.isFinite(l[key]))
        throw new Error("图层变换参数无效");
    if (l.scaleX === 0 || l.scaleY === 0) throw new Error("图层缩放不能为零");
    if (l.warp) {
      if (l.warp.length !== 8 || l.warp.some((n) => !Number.isFinite(n)))
        throw new Error("透视坐标无效");
      const q = l.warp,
        cross = [0, 2, 4, 6].map((i) => {
          const j = (i + 2) % 8,
            k = (i + 4) % 8;
          return (
            (q[j] - q[i]) * (q[k + 1] - q[j + 1]) -
            (q[j + 1] - q[i + 1]) * (q[k] - q[j])
          );
        });
      if (
        cross.some((n) => Math.abs(n) < 1e-6) ||
        !cross.every((n) => Math.sign(n) === Math.sign(cross[0]))
      )
        throw new Error("透视四角不能交叉或折叠");
    }
  }
  for (const l of layers) {
    if (
      l.parentId &&
      !layers.some((p) => p.id === l.parentId && p.kind === "group")
    )
      throw new Error("图层分组引用缺失");
    worldMatrix(layers, l);
  }
}
const nativeBlends = [
  "source-over",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];
function snapDelta(layers, ids, dx, dy, layout, zoom = 1) {
  const b = bounds(
    layers,
    roots(layers, ids).map((l) => l.id),
  );
  if (!layout?.snap || !b) return { dx, dy };
  const step = layout.gridSize || 20;
  dx = Math.round((b.x + dx) / step) * step - b.x;
  dy = Math.round((b.y + dy) / step) * step - b.y;
  for (const axis of ["x", "y"]) {
    const dimension = axis === "x" ? "width" : "height",
      delta = axis === "x" ? dx : dy;
    let closest = 6 / zoom,
      offset = 0;
    for (const guide of layout.guides || [])
      if (guide.axis === axis)
        for (const factor of [0, 0.5, 1]) {
          const distance =
            guide.position - (b[axis] + delta + b[dimension] * factor);
          if (Math.abs(distance) < closest) {
            closest = Math.abs(distance);
            offset = distance;
          }
        }
    if (axis === "x") dx += offset;
    else dy += offset;
  }
  return { dx, dy };
}
function cropToSelection(document) {
  const paths = document.selection?.paths;
  if (!paths?.length) throw new Error("请先绘制裁切选区");
  if (document.selection.inverted || paths.some((p) => p.operation !== "add"))
    throw new Error("裁切画布请使用普通或相加选区");
  const points = paths.flatMap((path) => path.points),
    xs = points.filter((_, i) => i % 2 === 0),
    ys = points.filter((_, i) => i % 2 === 1),
    x = Math.max(0, Math.floor(Math.min(...xs))),
    y = Math.max(0, Math.floor(Math.min(...ys))),
    right = Math.min(document.width, Math.ceil(Math.max(...xs))),
    bottom = Math.min(document.height, Math.ceil(Math.max(...ys)));
  if (right <= x || bottom <= y) throw new Error("选区不在画布内");
  return {
    ...document,
    width: right - x,
    height: bottom - y,
    selection: undefined,
    layers: document.layers.map((l) => ({
      ...l,
      ...(!l.parentId ? { x: l.x - x, y: l.y - y } : {}),
      ...(l.mask?.anchor
        ? {
            mask: {
              ...l.mask,
              anchor: {
                ...l.mask.anchor,
                matrix: l.mask.anchor.matrix.map((n, i) =>
                  i === 4 ? n - x : i === 5 ? n - y : n,
                ),
              },
            },
          }
        : {}),
    })),
    ...(document.layout
      ? {
          layout: {
            ...document.layout,
            guides: document.layout.guides?.map((g) => ({
              ...g,
              position: g.position - (g.axis === "x" ? x : y),
            })),
          },
        }
      : {}),
  };
}
function unsupported(layers) {
  return layers
    .filter(
      (l) =>
        !nativeBlends.includes(l.blend || "source-over"),
    )
    .map((l) => `${l.name}：混合模式尚未支持`);
}
module.exports = {
  identity,
  multiply,
  point,
  inverse,
  matrix,
  worldMatrix,
  decompose,
  homography,
  project,
  inverse3,
  localPoint,
  corners,
  localBounds,
  bounds,
  inherited,
  roots,
  descendants,
  createLayer,
  moveLayers,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  ungroupLayers,
  reorder,
  alignLayers,
  distributeLayers,
  validateLayers,
  nativeBlends,
  unsupported,
  snapDelta,
  cropToSelection,
  relocateLayers,
};
