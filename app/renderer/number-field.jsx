import React, { useState, useRef, useEffect } from "react";
import { Input } from "./components.jsx";
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  shortLabel,
}) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const edited = useRef(false);
  useEffect(
    () => setDraft(String(Math.round((value ?? 0) * 100) / 100)),
    [value],
  );
  const commit = () => {
    if (!edited.current) return;
    edited.current = false;
    const n = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(n) &&
      (min === undefined || n >= min) &&
      (max === undefined || n <= max)
    ) {
      if (n !== value) onChange(n);
    } else setDraft(String(value ?? 0));
  };
  return (
    <label className={shortLabel ? 'compact-number' : undefined}>
      {shortLabel ? <span>{shortLabel}</span> : label}
      <Input
        aria-label={label}
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          edited.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
