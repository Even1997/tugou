import { useEffect, useRef, useState } from "react";
import { createStroke } from "./painting.js";
import { createRetouchStroke } from "./retouch.js";
import {RasterEncoder} from './raster-encoder.js';
import { worldMatrix } from "../core/layers.cjs";

const endpointSignature = (doc, id) => {
  const layer = doc.layers.find((l) => l.id === id);
  return layer
    ? JSON.stringify([
        layer,
        worldMatrix(doc.layers, layer),
        doc.assets.find((a) => a.id === layer.assetId),
      ])
    : null;
};

export function usePainting({ latest, engine, change, setMessage }) {
  const active = useRef(null),
    lastEnd = useRef(null),
    alive = useRef(true);
  const encoder=useRef(null),queued=useRef([]),pointer=useRef(null),committed=useRef(null),api=useRef(null),replayFrame=useRef(null);
  const [waiting,setWaiting]=useState(0);
  const [preview, setPreview] = useState(null),
    [guide, setGuide] = useState(null),
    [busy, setBusy] = useState(false);
  const cancel = (clearQueue=true) => {
    if(clearQueue){encoder.current?.dispose();queued.current=[];pointer.current=null;cancelAnimationFrame(replayFrame.current);if(alive.current)setWaiting(0);}
    const a = active.current;
    if (a) {
      cancelAnimationFrame(a.frame);
      a.stroke?.dispose();
      active.current = null;
    }
    if (alive.current) {
      setPreview(null);
      setGuide(null);
      setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (window.document.hidden) cancel();
    };
    const blur=()=>cancel();
    window.addEventListener("blur", blur);
    window.document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", blur);
      window.document.removeEventListener("visibilitychange", hidden);
      alive.current = false;
      cancel();
      encoder.current?.dispose();
    };
  }, []);
  useEffect(() => {
    const own=committed.current,v=latest.current;
    if(own&&own.document.id===v.document.id&&own.layerId===v.selected[0]&&own.tool===v.tool&&own.target===v.paintTarget&&endpointSignature(own.document,own.layerId)===endpointSignature(v.document,own.layerId))committed.current=null;
    else if(active.current||queued.current.length)cancel();
    if (
      lastEnd.current?.document !== latest.current.document &&
      lastEnd.current
    ) {
      if (
        lastEnd.current.signature ===
        endpointSignature(latest.current.document, lastEnd.current.layerId)
      )
        lastEnd.current.document = latest.current.document;
      else lastEnd.current = null;
    }
  }, [
    latest.current.document,
    latest.current.tool,
    latest.current.paintTarget,
    latest.current.selected.join(","),
  ]);
  const show = (a) => {
    if (active.current !== a || !a.stroke) return;
    if (a.line && !a.finishing) {
      setGuide({ from: a.start, to: a.pointer });
      return;
    }
    setGuide(null);
    a.stroke.render();
    setPreview({
      document: a.stroke.mask
        ? {
            ...a.document,
            layers: a.document.layers.map((l) =>
              l.id === a.layer.id ? { ...l, mask: a.stroke.mask } : l,
            ),
          }
        : a.document,
      [a.stroke.mask ? "maskOverrides" : "overrides"]: new Map([
        [a.layer.id, a.stroke.canvas],
      ]),
    });
  };
  const move = (point) => {
    const a = active.current;
    if (!a || a.finishing) return;
    a.pointer = point;
    a.points.push(point);
    if (a.stroke) drain(a);
  };
  const drain = (a) => {
    if (a.processing) return a.processing;
    a.processing = (async () => {
      while (active.current === a && a.points.length) {
        await a.stroke.add(a.points.shift());
        if (!a.frame)
          a.frame = requestAnimationFrame(() => {
            a.frame = null;
            show(a);
          });
      }
    })()
      .catch((e) => {
        if (active.current === a) {
          cancel();
          if (e.name !== "AbortError") setMessage(e.message);
        }
      })
      .finally(() => {
        a.processing = null;
      });
    return a.processing;
  };
  const flush=()=>{
    if(active.current||!queued.current[0]?.ended)return;
    const q=queued.current.shift(),v=latest.current;setWaiting(queued.current.length);
    if(v.disabled||q.layerId!==v.selected[0]||q.options.target!==v.paintTarget||q.options.tool!==v.tool){cancel();setMessage('编辑目标已变化，等待中的笔画已取消');return;}
    api.current.begin(q.points[0],q.options,true);for(const p of q.points.slice(1,-1))move(p);api.current.end(q.points.at(-1),true);
  };
  const schedule=()=>{cancelAnimationFrame(replayFrame.current);replayFrame.current=requestAnimationFrame(flush)};
  api.current = {
    preview,
    guide,
    busy:busy||waiting>0,
    pending:waiting,
    cancel,
    move(point){if(pointer.current)pointer.current.points.push(point);else move(point);},
    begin(point, options, replaying=false) {
      if(!replaying&&(active.current?.finishing||queued.current.length)){
        if(queued.current.length>=32){setMessage('等待提交的笔画过多，请稍候再画');return;}
        const q={points:[point],options,layerId:latest.current.selected[0]};queued.current.push(q);pointer.current=q;setWaiting(queued.current.length);return;
      }
      if (active.current) return;
      const v = latest.current,
        layer = v.document.layers.find(
          (l) => v.selected.length === 1 && l.id === v.selected[0],
        );
      const paint = ["brush", "eraser"].includes(options.tool),
        target = paint && options.target === "mask" ? "mask" : "image",
        previous = lastEnd.current;
      const a = {
        document: v.document,
        layer,
        points: [point],
        start: point,
        pointer: point,
        line: paint && options.line,
        paint,
        target,
        zoom: v.view.zoom,
        linkFrom:
          options.connect &&
          previous?.document === v.document &&
          previous.layerId === layer?.id &&
          previous.target === target
            ? previous.point
            : null,
      };
      active.current = a;
      const factory = paint ? createStroke : createRetouchStroke;
      a.ready = factory(a.document, layer, engine.current, {
        ...options,
        zoom: v.view.zoom,
      })
        .then(async (stroke) => {
          if (active.current !== a) {
            stroke.dispose();
            return;
          }
          a.stroke = stroke;
          await drain(a);
        })
        .catch((e) => {
          if (active.current === a) {
            cancel();
            setMessage(e.message);
          }
        });
    },
    async end(point,replaying=false) {
      if(!replaying&&pointer.current){pointer.current.points.push(point);pointer.current.ended=true;pointer.current=null;schedule();return;}
      const a = active.current;
      if (!a || a.finishing) return;
      if (point.pointerType === "pen" && !point.pressure)
        point = { ...point, pressure: a.pointer.pressure };
      move(point);
      a.finishing = true;
      setBusy(true);
      let encoded;
      try {
        await a.ready;
        await a.processing;
        if (active.current !== a || !a.stroke) return;
        const from =
          a.linkFrom &&
          Math.hypot(point.x - a.start.x, point.y - a.start.y) * a.zoom < 3
            ? a.linkFrom
            : undefined;
        a.stroke.finish?.(point, from);
        cancelAnimationFrame(a.frame);
        show(a);
        encoder.current??=new RasterEncoder();encoded=await encoder.current.encode(a.stroke.canvas);
        if(active.current!==a)return;
        const bitmap = await window.tugou.storeRaster(
          encoded.bytes,
          "绘画修订",
        );
        if (active.current !== a) return;
        if (latest.current.document !== a.document)
          throw new Error("绘画期间工程已变化，笔触未覆盖新修改，请重画");
        engine.current.prime(bitmap,encoded.image);encoded=null;
        const previous = a.stroke.mask
          ? a.layer.mask?.bitmap
          : a.layer.bitmap ||
            a.document.assets.find((asset) => asset.id === a.layer.assetId);
        const remember = (document) => {
          lastEnd.current = a.paint
            ? {
                document,
                layerId: a.layer.id,
                target: a.target,
                point,
                signature: endpointSignature(document, a.layer.id),
              }
            : null;
        };
        if (previous?.resource === bitmap.resource) {
          remember(a.document);
          return;
        }
        const next = {
          ...a.document,
          layers: a.document.layers.map((l) =>
            l.id === a.layer.id
              ? {
                  ...l,
                  ...(a.stroke.mask
                    ? { mask: { ...a.stroke.mask, bitmap } }
                    : { bitmap }),
                }
              : l,
          ),
        };
        committed.current={document:next,layerId:a.layer.id,tool:latest.current.tool,target:a.target};
        if (change(next) === false)
          throw new Error("工程正在保存，笔触未写入，请完成保存后重画");
        remember(next);
      } catch (e) {
        if (active.current === a){cancel();setMessage(e.message);}
      } finally {
        encoded?.image.close();
        if (active.current === a){cancel(false);schedule();}
      }
    },
  };
  return api.current;
}
