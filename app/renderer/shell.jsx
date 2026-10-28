import {Select} from './select.jsx';
import React, { useState, useRef, useEffect } from "react";
import {materialMime} from './material-drag.js';
import {usePreferences} from './preferences.jsx';
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
  const {t,update}=usePreferences();
  const dragTimer=useRef(null);
  useEffect(()=>()=>clearTimeout(dragTimer.current),[]);
  const theme = useTheme(),
    [renaming, setRenaming] = useState(false),
    [name, setName] = useState("");
  return (
    <>
      <header className="studio-header toolbar" data-platform={window.tugou.platform}>
        <div className="brand">
          <img className="brand-logo" src="brand/logo.png" alt="土狗" draggable={false} />
        </div>
        <div className="project-menu">
          <Select
            aria-label={t('projectSelect')}
            title={record?.document.name || t('projectSelect')}
            value={record?.id || ""}
            disabled={busy}
            onChange={(e) => openProject(e.target.value)}
          >
            <option value="" disabled>
              {t('projectSelect')}
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
            aria-label={t('create')}
            title={t('create')}
            icon="add"
            disabled={busy}
            onClick={create}
          />
          <Button
            iconOnly
            aria-label={t('importProject')}
            title={t('importProject')}
            icon="import"
            disabled={busy}
            onClick={importProject}
          />
        </div>
        <span className="workspace-title">{t(workspace)}</span>
        <div className="header-space" />
        <div className="toolbar-end">
          <IconButton
            label={t('undo')}
            icon="undo"
            disabled={!canUndo || busy}
            onClick={undo}
          />
          <IconButton
            label={t('redo')}
            icon="redo"
            disabled={!canRedo || busy}
            onClick={redo}
          />
          <span className="header-save-state">{workspace==='fonts'?t('fontAuto'):busy ? t('saving') : dirty ? t('unsavedLabel') : t('saved')}</span>
          <Button icon="tasks" onClick={tasks}>{t('tasks')}</Button>
          <Button
            primary
            title={t('save')}
            aria-label={t('save')}
            disabled={!dirty || busy}
            icon={busy ? "loading" : "save"}
            aria-busy={busy}
            onClick={save}
          >{t('save')}</Button>
          <Button aria-label={t('models')} icon="settings" onClick={connection}>{t('models')}</Button>
          {workspace==='layers'&&<span id="composition-export"/>}
          <ToolPopover label={t('more')} className="import-menu">
            <Button
              disabled={!record || busy}
              onClick={() => {
                setName(record.document.name);
                setRenaming(true);
              }}
            >
              {t('rename')}
            </Button>
            <Button onClick={tasks} icon="tasks">
              {t('tasks')}
            </Button>
            <Button disabled={busy} onClick={hotReload}>
              {t('reload')}
            </Button>
          </ToolPopover>
        </div>
        {window.tugou.platform!=='darwin'&&<div className="window-controls">
          <IconButton
            label={t('minimize')}
            icon="minimize"
            onClick={() => window.tugou.window("minimize")}
          />
          <IconButton
            label={t('maximize')}
            icon="maximize"
            onClick={() => window.tugou.window("maximize")}
          />
          <IconButton
            label={t('close')}
            icon="close"
            onClick={() => window.tugou.window("close")}
          />
        </div>}
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
              aria-label={t(id)}
              icon={['prompts','fonts'].includes(id)?'text':id}
              title={t(id)}
              aria-current={workspace === id ? "page" : undefined}
              onClick={() => setWorkspace(id)}
              onDragOver={event=>{
                if(!record||busy||!['canvas','layers','assets'].includes(id)||!(event.dataTransfer.types.includes(materialMime)||event.dataTransfer.types.includes('Files')))return;
                event.preventDefault();
                if(!dragTimer.current&&workspace!==id)dragTimer.current=setTimeout(()=>{setWorkspace(id);dragTimer.current=null;},400);
              }}
              onDragLeave={()=>{clearTimeout(dragTimer.current);dragTimer.current=null;}}
              onDrop={()=>{clearTimeout(dragTimer.current);dragTimer.current=null;}}
            ><span>{t(id)}</span></Button>
          ))}
          <div className="rail-bottom"><IconButton label={t('settings')} className={['available','ready'].includes(update?.status)?'has-update':''} icon="settings" aria-current={workspace==='settings'?'page':undefined} onClick={()=>setWorkspace('settings')}/><IconButton
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
