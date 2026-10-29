import React from "react";
import { Button, Input } from "./components.jsx";
export function SemanticControls({
  plan,
  update,
  save,
  analyze,
  read,
  analysis,
  canRead,
  analysisReady,
  disabled,
}) {
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="类别拆分参数"
    >
      <div className="tool-primary-input">
        <div className="image-tool-detail">
          <Input.TextArea
            aria-label="类别方案"
            value={plan}
            rows={7}
            maxLength={6000}
            onChange={(e) => update(e.target.value)}
            placeholder="每行一个对象，最多 12 个。如：左侧新娘、手中的花束、小狗"
          />
          <Button onClick={save}>保存方案</Button>
          <p>
            每类各请求一次模型。只提取原图可见像素，不补画遮挡内容；类别可能重叠，请逐层预览。
          </p>
        </div>
      </div>
      <span>{plan.split(/\r?\n/).filter((s) => s.trim()).length} 个对象</span>
      <Button
        disabled={disabled || !analysisReady.ready || ["queued", "running"].includes(analysis?.status)}
        title={analysisReady.reason}
        onClick={analyze}
      >
        识别类别
      </Button>
      {!analysisReady.ready && <p className="muted">{analysisReady.reason}；也可直接填写对象。</p>}
      <Button
        disabled={disabled || !canRead}
        onClick={read}
      >
        读取识别结果
      </Button>
      <span className="muted">可手填或识别后修改；原图将发送至已配置模型</span>
    </fieldset>
  );
}
