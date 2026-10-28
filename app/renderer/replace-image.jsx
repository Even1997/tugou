import {Select} from './select.jsx';
import React, { useRef, useEffect, useState } from "react";
import { Button, FormDialog } from "./components.jsx";
import { assetUrl } from "./canvas.jsx";
import { replaceCanvasAsset } from "../core/canvas-media.cjs";

export function ReplaceImageDialog({
  document,
  change,
  targetId,
  assetId,
  close,
  replaceDocument = replaceCanvasAsset,
  description = "仅替换当前节点，保留位置、连线和参考角色。",
}) {
  const [chosen, setChosen] = useState(""),
    [imported, setImported] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef(document),
    mounted = useRef(true);
  current.current = document;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const asset =
    imported?.id === chosen
      ? imported
      : document.assets.find((a) => a.id === chosen);
  return (
    <FormDialog
      title="替换图片"
      close={() => {
        if (!busy) close();
      }}
      width={640}
    >
      <p className="muted">{description}</p>
      <label>
        素材库
        <Select
          aria-label="替换素材"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">选择图片</option>
          {document.assets.filter(a=>!a.kind||a.kind==='image')
            .filter((a) => a.id !== assetId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          {imported && (
            <option value={imported.id}>{imported.name}（待加入）</option>
          )}
        </Select>
      </label>
      {asset && (
        <img
          className="material-preview"
          style={{ maxHeight: "35vh" }}
          src={assetUrl(asset)}
          alt="替换图片预览"
        />
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <Button
          icon="import"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const added = await window.tugou.importImage(true);
              if (mounted.current && added[0]) {
                setImported(added[0]);
                setChosen(added[0].id);
              }
            } catch (e) {
              if (mounted.current) setError(e.message);
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        >
          导入替换图片
        </Button>
        <span />
        <Button disabled={busy} onClick={close}>
          取消
        </Button>
        <Button
          primary
          disabled={busy || !asset}
          onClick={() => {
            try {
              const next = replaceDocument(
                current.current,
                targetId,
                assetId,
                asset,
              );
              if (change(next) === false)
                throw Error("工程正在保存，请稍后替换");
              close();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          确认替换
        </Button>
      </div>
    </FormDialog>
  );
}
