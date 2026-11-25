import React, { useMemo, useState } from "react";
import { Button, FormDialog, Icon } from "./components.jsx";

const PRESETS = [
  ["艺术风格", "水彩插画质感\n胶片复古颗粒\n极简平面设计"],
  ["光线氛围", "清晨柔光\n黄金时刻逆光\n影棚高对比布光"],
  ["构图镜头", "正面特写\n俯拍平面构图\n广角电影感"],
];

export function MatrixRunDialog({ node, connection, onRun, close }) {
  const [variantsText, setVariantsText] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [autoRun, setAutoRun] = useState(false);

  const availableModels = useMemo(() => {
    const out = [];
    const seen = new Set();
    const push = (id) => {
      const value = String(id || "").trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    };
    push(node?.data?.model);
    push(connection?.model);
    push(connection?.imageModel);
    if (Array.isArray(connection?.connections)) {
      for (const c of connection.connections) {
        if (Array.isArray(c.models)) {
          for (const m of c.models) {
            if (!m.purposes || m.purposes.includes("image")) push(m.id);
          }
        }
      }
    }
    return out;
  }, [node?.data?.model, connection]);

  const [pickedModels, setPickedModels] = useState([]);

  const toggleModel = (id) => {
    setPickedModels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const variants = useMemo(
    () =>
      variantsText
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [variantsText],
  );

  const customModels = useMemo(
    () =>
      modelsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [modelsText],
  );

  const models = useMemo(() => {
    const merged = [...pickedModels, ...customModels];
    return merged.length ? [...new Set(merged)] : [""];
  }, [pickedModels, customModels]);

  const combos = useMemo(() => {
    const vList = variants.length ? variants : [""];
    const out = [];
    for (const variant of vList) {
      for (const model of models) {
        out.push({ variant, model });
      }
    }
    return out;
  }, [variants, models]);

  const tooMany = combos.length > 9;
  const canSubmit = combos.length >= 2 && !tooMany;

  return (
    <FormDialog title="多变量 / 多模型矩阵跑图" className="matrix-run-dialog" width={580} close={close}>
      <div className="matrix-run-body">
        <p className="muted">
          以当前生成节点为基准，复用所有上游输入连线，在右侧自动展开对齐的对比节点网格，方便生成后直接框选「多图对比」定稿。
        </p>

        <section className="matrix-run-section">
          <div className="matrix-run-head">
            <strong>变量 / 风格词（每行一项）</strong>
            <div className="matrix-run-presets">
              {PRESETS.map(([label, value]) => (
                <button key={label} type="button" onClick={() => setVariantsText(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            rows={4}
            value={variantsText}
            onChange={(e) => setVariantsText(e.target.value)}
            placeholder={"每行写一个风格或变量追加到提示词，例如：\n水彩插画\n胶片纪实\n极简留白"}
          />
        </section>

        <section className="matrix-run-section">
          <div className="matrix-run-head">
            <strong>对比模型（可多选，不选则沿用当前模型）</strong>
          </div>
          {availableModels.length > 0 && (
            <div className="matrix-run-models">
              {availableModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={pickedModels.includes(m)}
                  onClick={() => toggleModel(m)}
                >
                  <Icon name="model" />
                  <span>{m}</span>
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            className="matrix-run-model-input"
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder="也可逗号分隔补充模型 ID（可选）"
          />
        </section>

        <label className="matrix-run-check">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
          <span>展开节点后立即提交全部生成任务（将调用已配置的模型 API）</span>
        </label>

        <div className="matrix-run-summary">
          <span>
            将生成 <strong>{combos.length}</strong> 个对比节点
            {combos.length < 2 ? "（请至少填写 2 行变量或选择 2 个模型）" : tooMany ? "（单次最多 9 组，请精简）" : ""}
          </span>
        </div>

        <div className="dialog-footer">
          <Button onClick={close}>取消</Button>
          <Button
            primary
            icon="matrix"
            disabled={!canSubmit}
            onClick={() => {
              onRun({ combos, autoRun });
              close();
            }}
          >
            {autoRun ? `展开并跑图（${combos.length} 组）` : `展开对比节点（${combos.length} 组）`}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
