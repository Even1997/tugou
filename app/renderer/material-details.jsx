import React, { useEffect, useState } from "react";
import {
  Button,
  FormDialog,
  Input,
  TextArea,
  ToolPopover,
} from "./components.jsx";
import { exportMaterial, originalUrl } from "./image-processing.js";
import {MediaPreview} from './media-preview.jsx';

export async function copyAssetPrompt(details) {
  if (!details?.prompt) throw Error(details?.reason || "没有可复制的提示词");
  await window.tugou.copyText(details.prompt);
}

export function MaterialDetails({
  projectId,
  document,
  assetId,
  nodeId,
  change,
  close,
  editImages,
  analyzeImage,
  addToLayers,
  addToCanvas,
}) {
  const asset = document.assets.find((a) => a.id === assetId);
  const [details, setDetails] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let stopped = false;
    setDetails(null);
    setError("");
    setNotice("");
    window.tugou
      .assetDetails(projectId, document, assetId, nodeId)
      .then((value) => {
        if (!stopped) setDetails(value);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [projectId, assetId, nodeId, asset?.resource]);
  const run = async (operation) => {
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(e.message);
    }
  };
  if (!asset)
    return (
      <FormDialog title="素材详情" close={close}>
        <p>素材已移除。</p>
      </FormDialog>
    );
  return (
    <FormDialog title="素材详情" close={close} width={800}>
      <div
        className="dialog-footer"
        style={{ marginTop: 0, marginBottom: 16, flexWrap: "wrap" }}
      >
        <Button iconOnly
          icon="copy"
          disabled={!details?.prompt}
          onClick={() =>
            run(async () => {
              await copyAssetPrompt(details);
              setNotice("提示词已复制");
            })
          }
        >
          复制提示词
        </Button>
        <Button iconOnly icon="analyze"
          disabled={asset.kind&&asset.kind!=='image'}
          onClick={() => {
            close();
            analyzeImage(asset.id, nodeId);
          }}
        >
          图片反推
        </Button>
        <Button iconOnly
          icon="tools"
          disabled={asset.kind&&asset.kind!=='image'}
          onClick={() => {
            close();
            editImages([asset.id]);
          }}
        >
          处理图片
        </Button>
        <ToolPopover label="素材操作">
          <div className="image-tool-detail">
            <Button
              icon="export"
              onClick={() => run(() => asset.kind&&asset.kind!=='image'?window.tugou.exportAsset(projectId,document,asset.id):exportMaterial(asset))}
            >
              {asset.kind&&asset.kind!=='image'?'导出原文件':'导出 PNG'}
            </Button>
            <Button
              disabled={asset.kind&&asset.kind!=='image'}
              onClick={() => {
                addToLayers(asset);
                close();
              }}
            >
              加入画面
            </Button>
            <Button
              onClick={() => {
                addToCanvas("asset", asset.id);
                close();
              }}
            >
              加入画布
            </Button>
          </div>
        </ToolPopover>
        <span>
          {asset.width} × {asset.height} px
        </span>
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="message">
          {notice}
        </p>
      )}
      <MediaPreview asset={asset} full
        className="material-preview"
        style={{ maxHeight: "30vh" }}
        src={originalUrl(asset)}
        alt={asset.name}
      />
      <label>
        名称
        <Input
          aria-label="素材名称"
          value={asset.name}
          onChange={(e) =>
            change({
              ...document,
              assets: document.assets.map((a) =>
                a.id === asset.id ? { ...a, name: e.target.value } : a,
              ),
            })
          }
        />
      </label>
      <label>
        {details?.label || "生成提示词"}
        <TextArea
          aria-label="素材提示词"
          readOnly
          rows={5}
          value={details?.prompt || ""}
          placeholder={details?.reason || (error ? "读取失败" : "正在读取…")}
        />
      </label>
      {details?.model && (
        <p className="muted">
          {details.model}
          {details.requestedSize ? ` · 请求尺寸 ${details.requestedSize}` : ""}
        </p>
      )}
      {details?.label?.startsWith("来源素材") && (
        <p className="muted">
          来源：{details.sourceName}。后续处理不改变这条原始记录。
        </p>
      )}
    </FormDialog>
  );
}
