import React from 'react';
import {Button} from './components.jsx';
import {Select} from './select.jsx';

export const selectionTools=[['rect','矩形选区'],['ellipse','椭圆选区'],['lasso','套索选区'],['polygon','多边形选区'],['wand','魔棒'],['range','颜色范围']];
export function SelectionActions({operation,onOperation,hasSelection,invert,clear,subject,canSubject,busy,subjectStatus,subjectStage}) {
  return <div className="selection-actions">
    <Select aria-label="选区组合方式" value={operation} disabled={busy} onChange={e=>onOperation(e.target.value)}>{[['replace','新选区'],['add','添加选区'],['subtract','减去选区'],['intersect','相交选区']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>
    <Button disabled={!canSubject||busy||!subjectStatus?.ready} onClick={subject}>AI 选择主体</Button>
    {canSubject&&<span className="subject-status" role="status">{subjectStage||subjectStatus?.reason}</span>}
    {canSubject&&<Button aria-label="刷新 AI 状态" disabled={busy||subjectStatus?.checking} onClick={subjectStatus?.refresh}>刷新</Button>}
    <Button title="反选 · Ctrl+Shift+I" disabled={!hasSelection||busy} onClick={invert}>反选</Button>
    <Button title="取消选区 · Ctrl+D" disabled={!hasSelection||busy} onClick={clear}>取消选区</Button>
  </div>;
}
