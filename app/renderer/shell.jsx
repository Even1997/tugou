import {Select} from './select.jsx';
import React, { useState, useRef, useEffect } from "react";
import {materialMime} from './material-drag.js';
import {
  Button,
  Icon,
  IconButton,
  ToolPopover,
  FormDialog,
  Input,
  useTheme,
} from "./components.jsx";

export function StudioHeader({
  projects,
  record,
  workspace,
  setWorkspace,
  busy,
  dirty,
  save,
  create,
  importProject,
  hotReload,
  openProject,
  connection,
  tasks,
  undo,
  redo,
  canUndo,
  canRedo,
  rename,
}) {
  const dragTimer=useRef(null);
  useEffect(()=>()=>clearTimeout(dragTimer.current),[]);
  const theme = useTheme(),
    [renaming, setRenaming] = useState(false),
    [name, setName] = useState("");
  return (
    <>
      <header className="studio-header toolbar">
        <div className="brand">
          <img className="brand-logo" src="brand/logo.png" alt="" draggable={false} />
          <span>土狗</span>
        </div>
        <div className="project-menu">
          <Select
            aria-label="当前工程"
            title={record?.document.name || "选择工程"}
            value={record?.id || ""}
            disabled={busy}
            onChange={(e) => openProject(e.target.value)}
          >
            <option value="" disabled>
              选择工程
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id} disabled={Boolean(p.error)}>
                {p.name}
                {p.canvasNodeCount !== undefined
                  ? ` · 画布（${p.canvasNodeCount} 节点）`
                  : ""}
              </option>
            ))}
          </Select>
          <Button
            iconOnly
            aria-label="新建工程"
            title="新建工程"
            icon="add"
            disabled={busy}
            onClick={create}
          />
          <Button
            iconOnly
            aria-label="导入工程"
            title="导入工程"
            icon="import"
            disabled={busy}
            onClick={importProject}
          />
        </div>
        <span className="workspace-title">{({prompts:"提示词工作台",canvas:"无限画布",layers:"图层合成",tools:"图像工具",assets:"素材库",fonts:"字体"})[workspace]}</span>
        <div className="header-space" />
        <div className="toolbar-end">
          <IconButton
            label="撤销"
            icon="undo"
            disabled={!canUndo || busy}
            onClick={undo}
          />
          <IconButton
            label="重做"
            icon="redo"
            disabled={!canRedo || busy}
            onClick={redo}
          />
          <span className="header-save-state">{workspace==='fonts'?'字体自动保存':busy ? "保存中" : dirty ? "未保存" : "已保存"}</span>
          <Button icon="tasks" onClick={tasks}>任务</Button>
          <Button
            primary
            title="保存"
            aria-label="保存"
            disabled={!dirty || busy}
            icon={busy ? "loading" : "save"}
            aria-busy={busy}
            onClick={save}
          >保存</Button>
          <Button aria-label="模型连接" icon="settings" onClick={connection}>模型连接</Button>
          {workspace==='layers'&&<span id="composition-export"/>}
          <ToolPopover label="更多操作" className="import-menu">
            <Button
              disabled={!record || busy}
              onClick={() => {
                setName(record.document.name);
                setRenaming(true);
              }}
            >
              重命名工程
            </Button>
            <Button onClick={tasks} icon="tasks">
              任务中心
            </Button>
            <Button disabled={busy} onClick={hotReload}>
              保存并热更新
            </Button>
          </ToolPopover>
        </div>
        <div className="window-controls">
          <IconButton
            label="最小化"
            icon="minimize"
            onClick={() => window.tugou.window("minimize")}
          />
          <IconButton
            label="最大化或还原"
            icon="maximize"
            onClick={() => window.tugou.window("maximize")}
          />
          <IconButton
            label="关闭窗口"
            icon="close"
            onClick={() => window.tugou.window("close")}
          />
        </div>
      </header>
        <nav className="workspace-rail" aria-label="工作区">
          {[
            ["prompts", "提示词工作台"],
            ["canvas", "无限画布"],
            ["layers", "图层合成"],
            ["tools", "图像工具"],
            ["assets", "素材库"],
            ["fonts", "字体"],
          ].map(([id, label]) => (
            <Button
              key={id}
              aria-label={label}
              icon={['prompts','fonts'].includes(id)?'text':id}
              title={label}
              aria-current={workspace === id ? "page" : undefined}
              onClick={() => setWorkspace(id)}
              onDragOver={event=>{
                if(!record||busy||!['canvas','layers','assets'].includes(id)||!(event.dataTransfer.types.includes(materialMime)||event.dataTransfer.types.includes('Files')))return;
                event.preventDefault();
                if(!dragTimer.current&&workspace!==id)dragTimer.current=setTimeout(()=>{setWorkspace(id);dragTimer.current=null;},400);
              }}
              onDragLeave={()=>{clearTimeout(dragTimer.current);dragTimer.current=null;}}
              onDrop={()=>{clearTimeout(dragTimer.current);dragTimer.current=null;}}
            ><span>{({prompts:"提示词",canvas:"画布",layers:"合成",tools:"工具",assets:"素材",fonts:"字体"})[id]}</span></Button>
          ))}
          <div className="rail-bottom">          <IconButton
            label={theme.mode === "dark" ? "切换浅色主题" : "切换深色主题"}
            icon={theme.mode === "dark" ? "sun" : "moon"}
            onClick={theme.toggle}
          />
</div>
        </nav>

      {renaming && (
        <FormDialog title="重命名工程" close={() => setRenaming(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                rename(name.trim());
                setRenaming(false);
              }
            }}
          >
            <Input
              autoFocus
              aria-label="新工程名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="dialog-footer">
              <Button onClick={() => setRenaming(false)}>取消</Button>
              <Button primary type="submit" disabled={!name.trim()}>
                保存名称
              </Button>
            </div>
          </form>
        </FormDialog>
      )}
    </>
  );
}
export function StudioStatus({
  dirty,
  notice,
  record,
  tasks,
  openTasks,
  connection,
}) {
  const running = tasks.filter((t) =>
    ["running", "queued"].includes(t.status),
  ).length;
  return (
    <footer className="statusbar">
      <span role="status">
        {dirty ? "有未保存修改" : notice || (record ? "已保存" : "就绪")}
      </span>
      <div>
        <Button iconOnly aria-label="任务" title={running ? `任务 · ${running} 项进行中` : "任务"} icon={running ? "loading" : "tasks"} onClick={openTasks}>
          任务{running ? ` · ${running}` : ""}
        </Button>
        {running > 0 && <span className="task-count" aria-label={`${running} 项任务进行中`}>{running}</span>}
        <Button iconOnly icon="model" onClick={connection}>连接模型</Button>
      </div>
    </footer>
  );
}
