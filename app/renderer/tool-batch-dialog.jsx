import React, { useState } from "react";
import { FormDialog, SearchField, Button } from "./components.jsx";
import { assetUrl } from "./canvas.jsx";
export function ToolBatchDialog({
  assets,
  sourceId,
  operation,
  close,
  submit,
  initialIds = [],
}) {
  const [selected, setSelected] = useState(()=>initialIds.length ? initialIds.filter(id=>assets.some(a=>a.id===id)) : sourceId ? [sourceId] : []),
    [query, setQuery] = useState("");
  const visible = assets.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <FormDialog title="批量处理" close={close} width={620}>
      <p>{operation} · 使用当前参数。{['云端增强', '创意放大', 'AI 局部修改', 'AI 扩图'].includes(operation) ? '逐张请求模型、逐张入库；每张单独计费，失败项手动重试。区域与蒙版使用原像素坐标。' : '完成后整批进入素材库。'}</p>
      <SearchField label="搜索批量素材" value={query} onChange={setQuery} />
      <div className="dialog-actions">
        <Button
          onClick={() => setSelected(visible.slice(0, 64).map((a) => a.id))}
        >
          选择当前列表
        </Button>
        <Button onClick={() => setSelected([])}>清空选择</Button>
        <span>{selected.length} / 64</span>
      </div>
      <div className="batch-assets">
        {visible.map((a) => (
          <label className="batch-asset" key={a.id}>
            <input
              type="checkbox"
              aria-label={`批量选择 ${a.name}`}
              checked={selected.includes(a.id)}
              disabled={!selected.includes(a.id) && selected.length >= 64}
              onChange={(e) =>
                setSelected((p) =>
                  e.target.checked
                    ? [...p, a.id]
                    : p.filter((id) => id !== a.id),
                )
              }
            />
            <img src={assetUrl(a)} alt="" />
            <span>
              {a.name}
              <small>
                {a.width} × {a.height}
              </small>
            </span>
          </label>
        ))}
      </div>
      <footer>
        <Button onClick={close}>返回</Button>
        <Button
          primary
          disabled={!selected.length}
          onClick={() => submit(selected)}
        >
          提交 {selected.length} 张
        </Button>
      </footer>
    </FormDialog>
  );
}
