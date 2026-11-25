import React,{useEffect,useState} from 'react';
import {Button,Icon,Input,FormDialog} from './components.jsx';
import {McpConnectionInfo} from './settings-connections.jsx';
import {usePreferences} from './preferences.jsx';
import {ContextMenu,useContextMenu,menuAction as item,menuDivider as divider} from './context-menu.jsx';
import {RemovalDialog} from './removal-dialog.jsx';
import './home.css';

const verifyPrompt='请连接土狗，先调用 get_state 查看当前工程，再调用 list_commands 查看画布可用命令。只读取信息，暂不修改工程或生成图片。';
const pageSize=6;
export const workspaceNames={prompts:'提示词工作台',canvas:'无限画布',layers:'图层编辑器',ppt:'PPT',tools:'图像工具',assets:'素材库',fonts:'字体'};
const moduleCards=[
  ['canvas','无限画布','节点串联生图与工具',true],
  ['layers','图层编辑器','多画板排版与蒙版',true],
  ['ppt','PPT','大纲、设计与讲稿',false],
  ['prompts','提示词','可复用模块与配方',true],
  ['tools','图像工具','抠图、超分与 GIF',true],
  ['fonts','字体','图集识别导出字库',false],
];
const taskLabels={queued:'排队中',running:'进行中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',review:'待确认'};
const previewSrc=asset=>asset?.resource?`tugou-media://resource/${asset.resource}`:asset?.dataUrl?.startsWith('/api/studio/resource/')?`tugou-media://resource/${asset.dataUrl.split('/').at(-1)}`:asset?.dataUrl?.startsWith('data:image/')?asset.dataUrl:undefined;

export function HomeWorkspace({projects,projectsReady,record,dirty,tasks,tasksReady,busy,create,open,renameProject,deleteProject,navigate,showTasks,lastWorkspace}){
  const {t,locale}=usePreferences();
  const [mcp,setMcp]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[configOpen,setConfigOpen]=useState(false);
  const [guideOpen,setGuideOpen]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0),[promptCopied,setPromptCopied]=useState(false);
  const projectMenu=useContextMenu(),[renaming,setRenaming]=useState(false),[renameValue,setRenameValue]=useState(''),[deleting,setDeleting]=useState(null);
  const menuProject=projects.find(p=>p.id===projectMenu.context?.id);
  useEffect(()=>{let live=true;const refresh=()=>window.tugou.settings('mcpStatus').then(value=>{if(live){setMcp(value);setError('');}}).catch(e=>live&&setError(e.message));refresh();window.addEventListener('focus',refresh);return()=>{live=false;window.removeEventListener('focus',refresh);};},[]);
  const perform=async action=>{setPending(true);setError('');setNotice('');try{await action();}catch(e){setError(e.message);}finally{setPending(false);}};
  const stats=[
    ['本机工程',projectsReady?projects.filter(p=>!p.error).length:null,'可读取的已保存工程','open'],
    ['工程素材',record?record.document.assets.length:null,record?'当前打开工程，含未保存内容':'打开工程后显示','assets'],
    ['已完成任务',tasksReady?tasks.filter(task=>task.status==='completed').length:null,'本机保留的任务记录','check'],
    ['进行中任务',tasksReady?tasks.filter(task=>['queued','running'].includes(task.status)).length:null,'本机排队及运行中的任务','tasks'],
  ];
  const nameOf=project=>project.id===record?.id?record.document.name:project.name;
  const matching=projects.filter(project=>nameOf(project).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageCount=Math.max(1,Math.ceil(matching.length/pageSize)),currentPage=Math.min(page,pageCount-1),recent=matching.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间未记录';
  const mcpStatus=<span className={`home-mcp-status ${mcp?.enabled?'enabled':''}`} role="status">{mcp?(mcp.enabled?'本地服务已启用':'本地服务未启用'):'读取状态中'}</span>;
  const quickTargets=['canvas','prompts','layers','ppt'].filter(id=>id!==lastWorkspace).slice(0,3);
  const thumbs=(record?.document?.assets||[]).filter(a=>!a.kind||a.kind==='image').map(a=>({id:a.id,name:a.name,src:previewSrc(a)})).filter(a=>a.src).slice(-3).reverse();
  const quickCards=[['canvas','无限画布'],['layers','图层编辑'],['ppt','PPT 设计']];
  const recentTasks=(tasks||[]).slice(-3).reverse();
  return <div className="home-workspace"><div className="home-content">
    <header className="home-heading">
      <div>
        <h1>首页</h1>
        <section className="home-stats" aria-label="创作统计">{stats.map(([label,value,hint])=><article key={label} title={hint}><strong aria-label={`${label}数量`}>{value===null?'—':value.toLocaleString(locale)}</strong><span>{label}</span></article>)}</section>
      </div>
      <div className="home-actions"><Button type="default" icon="connect" onClick={()=>setGuideOpen(true)}>MCP 连接</Button><Button primary className="home-create" icon="add" disabled={busy} onClick={create}>新建工程</Button></div>
    </header>

    <section className="home-section home-current">
      <div className="home-current-main">
        <header><h2><Icon name={lastWorkspace||'open'}/>继续创作</h2>{record&&<span className="home-current-count">{record.document.assets.length} 项素材</span>}</header>
        {record?<>
          <h3 title={record.document.name}>{record.document.name}</h3>
          <p>{lastWorkspace?`返回${workspaceNames[lastWorkspace]}继续编辑，保留当前未保存的内容。`:'从下方或左侧选择工作区，自由开始创作。'}</p>
          <div className="home-actions">
            {lastWorkspace&&<Button primary icon={lastWorkspace} disabled={busy} onClick={()=>navigate(lastWorkspace)}>继续{workspaceNames[lastWorkspace]}</Button>}
            {quickTargets.map(id=><Button key={id} icon={id} disabled={busy} onClick={()=>navigate(id)}>{workspaceNames[id]}</Button>)}
            {lastWorkspace!=='tools'&&<Button icon="tools" disabled={busy} onClick={()=>navigate('tools')}>图像工具</Button>}
          </div>
        </>:<>
          <h3>从一个工程开始</h3>
          <p>新建工程，或打开下方最近保存的工程；所有模块共用同一本机工程与素材库。</p>
          <div className="home-actions"><Button primary icon="add" disabled={busy} onClick={create}>创建新工程</Button><Button icon="tools" disabled={busy} onClick={()=>navigate('tools')}>图像工具</Button></div>
        </>}
      </div>
      <div className="home-spotlight-gallery">
        {[0,1,2].map(index=>{
          const item=thumbs[index];
          const [fallbackId,fallbackLabel]=quickCards[index];
          const unavailable=!record&&!item&&fallbackId!=='ppt';
          return <button key={index} type="button" data-unavailable={unavailable||undefined} disabled={busy||unavailable} className="home-art-slot" onClick={()=>navigate(item?'assets':fallbackId)} title={item?`在素材库查看 ${item.name||'素材'}`:`打开${fallbackLabel}`}>
            {item?<><img src={item.src} alt={item.name||''} draggable={false}/><span>{item.name||'工程素材'}</span></>:<div className="home-art-empty"><Icon name={fallbackId}/><span>{fallbackLabel}</span></div>}
          </button>;
        })}
      </div>
    </section>

    <section className="home-modules" aria-label="工作区快捷入口">
      {moduleCards.map(([id,title,desc,needsProject])=>{
        const unavailable=needsProject&&!record;
        const disabled=busy||unavailable;
        return <button key={id} type="button" data-module={id} data-unavailable={unavailable||undefined} className={`home-module-card${lastWorkspace===id?' is-last':''}`} disabled={disabled} onClick={()=>navigate(id)} title={unavailable?'先打开或新建工程后使用':`${title}：${desc}`}>
          <span className="home-module-icon"><Icon name={id}/></span>
          <strong>{title}</strong>
          <small>{desc}</small>
        </button>;
      })}
    </section>

    <section className="home-section home-recent-section" aria-label="工程列表">
      <header><div><h2>我的工程</h2><p>按最近保存时间排序</p></div><Input className="home-project-search" aria-label="搜索工程名称" placeholder="搜索工程名称" prefix={<Icon name="search"/>} allowClear value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></header>
      {!projectsReady?<p role="status" className="home-empty">正在读取工程…</p>:!recent.length?<p className="home-empty">{query.trim()?'没有匹配的工程，试试其他名称。':'还没有工程。开始创作后，你的工程会显示在这里。'}</p>:<div className={`home-recent${matching.length>pageSize?' paginated':''}`}>{recent.map(project=>{
        const isCurrent=project.id===record?.id;
        const cover=isCurrent?thumbs[0]?.src:(project.coverResource?`tugou-media://resource/${project.coverResource}`:undefined);
        const count=isCurrent?record.document.assets.length:project.assetCount;
        return <button key={project.id} data-unavailable={!!project.error||undefined} className={isCurrent?'is-current':undefined} disabled={busy||!!project.error} onContextMenu={e=>{if(!busy&&!project.error)projectMenu.open(e,{id:project.id});}} onClick={()=>isCurrent?navigate(lastWorkspace||'canvas'):open(project.id)} title={project.error||nameOf(project)}>
          <span className="home-project-cover">
            {cover?<img src={cover} alt="" draggable={false}/>:<span className="home-project-placeholder" aria-hidden="true"><Icon name="canvas"/></span>}
            {isCurrent&&<em>当前</em>}
            {!project.error&&<span role="button" tabIndex={0} className="home-project-more" aria-label={`工程操作 ${nameOf(project)}`} title="工程操作" onClick={e=>{e.preventDefault();e.stopPropagation();if(!busy)projectMenu.open(e,{id:project.id});}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!busy)projectMenu.open(e,{id:project.id});}}}><Icon name="more"/></span>}
          </span>
          <span className="home-project-body">
            <span className="home-project-copy">
              <strong>{nameOf(project)}</strong>
              <small>{project.error||`${count?`${count} 项素材 · `:''}${time(project.updatedAt)}`}</small>
            </span>
            <Icon name="expand"/>
          </span>
        </button>;
      })}</div>}
      <footer className="home-project-footer"><div><span>{projectsReady?`共 ${matching.length} 个工程${query.trim()?'匹配搜索':''}`:'正在读取…'}</span><Button icon="tasks" onClick={showTasks}>任务记录</Button></div><nav aria-label="工程分页" hidden={pageCount===1}><Button icon="expand" className="home-page-prev" aria-label="上一页工程" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}/><span aria-live="polite">{currentPage+1} / {pageCount}</span><Button icon="expand" aria-label="下一页工程" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}/></nav></footer>
    </section>

    <div className="home-bottom-grid">
      <section className="home-section home-tasks-card" aria-label="最近任务">
        <header><h2><Icon name="tasks"/>最近任务</h2><Button onClick={showTasks}>查看全部</Button></header>
        {!tasksReady?<p className="home-tasks-empty">正在读取任务…</p>:!recentTasks.length?<p className="home-tasks-empty">暂无任务记录。生图、视觉分析与图像处理任务会显示在这里。</p>:<div className="home-task-list">
          {recentTasks.map(task=><button key={task.id} type="button" className="home-task-item" data-status={task.status} onClick={showTasks} title={task.label}>
            <span className="home-task-dot" aria-hidden="true"/>
            <strong>{task.label||'未命名任务'}</strong>
            <small>{taskLabels[task.status]||task.status} · {time(task.createdAt)}</small>
          </button>)}
        </div>}
      </section>

      <section className="home-section home-mcp-card" aria-label="MCP 连接">
        <header><h2><Icon name="connect"/>MCP 连接</h2>{mcpStatus}</header>
        <h3>让 AI 助手参与创作</h3>
        <p>连接支持本机 stdio MCP 的客户端，读取工程、编辑画布、调用图像工具与制作 PPT。</p>
        <div className="home-actions"><Button type="default" icon="connect" onClick={()=>setGuideOpen(true)}>查看连接引导</Button><span className="home-mcp-hint">本机连接 · 三步设置</span></div>
      </section>
    </div>

    {error&&!guideOpen&&<p role="alert" className="home-error">{error}</p>}
    <ContextMenu context={projectMenu.context} close={projectMenu.close} className="project-context-menu" items={menuProject&&!busy&&!menuProject.error?[
      item('open',menuProject.id===record?.id?'进入当前工程':'打开工程',()=>menuProject.id===record?.id?navigate(lastWorkspace||'canvas'):open(menuProject.id)),
      ...(menuProject.id===record?.id&&renameProject?[item('edit','重命名工程',()=>{setRenameValue(record.document.name);setRenaming(true);})]:[]),
      ...(deleteProject?[divider,item('delete','删除项目',()=>setDeleting(menuProject),{danger:true})]:[]),
    ]:[]}/>
    {renaming&&record&&<FormDialog title="重命名工程" close={()=>setRenaming(false)} width={440}>
      <form onSubmit={e=>{e.preventDefault();if(renameValue.trim()){renameProject(renameValue.trim());setRenaming(false);}}}>
        <Input autoFocus aria-label="新工程名称" value={renameValue} onChange={e=>setRenameValue(e.target.value)}/>
        <div className="dialog-footer"><Button onClick={()=>setRenaming(false)}>取消</Button><Button primary type="submit" disabled={!renameValue.trim()}>保存名称</Button></div>
      </form>
    </FormDialog>}
    {deleting&&deleteProject&&<RemovalDialog title={`删除项目「${nameOf(deleting)}」？`} description={(deleting.id===record?.id&&dirty?'此项目有未保存的修改，删除后将一并丢弃。':'')+'项目将从列表移除，不能通过撤销恢复。共享素材保留。'} close={()=>setDeleting(null)} remove={()=>deleteProject(deleting)}/>}
    {guideOpen&&<FormDialog className="home-guide" title="MCP 连接引导" width={680} close={()=>{setGuideOpen(false);setConfigOpen(false);setPromptCopied(false);}}>
      <section id="home-mcp" className="home-mcp" aria-label="MCP 连接引导">
        <div className={`home-mcp-banner${mcp?.enabled?' is-enabled':''}`}>
          <div className="home-mcp-banner-copy">
            {mcpStatus}
            <p>使用本机 stdio 协议接入 AI 客户端，读取工程、编辑画布、调用图像工具与制作 PPT。</p>
          </div>
          <span className="home-mcp-proto">stdio</span>
        </div>
        <ol className="home-steps">
          <li data-done={mcp?.enabled?'true':undefined}>
            <div className="home-step-card">
              <div className="home-step-head">
                <div>
                  <h3>启用本地服务</h3>
                  <p>连接时保持土狗运行，客户端是否连通需在第 3 步验证。</p>
                </div>
                <div className="home-actions">
                  <Button primary={!mcp?.enabled} className={mcp?.enabled?'home-step-enabled':undefined} icon={mcp?.enabled?'check':undefined} disabled={pending||!mcp||mcp.enabled} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpEnable',true)))}>{mcp?.enabled?'已启用 MCP':'启用 MCP'}</Button>
                  <Button icon="sync" disabled={pending} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpStatus')))}>刷新状态</Button>
                </div>
              </div>
            </div>
          </li>
          <li>
            <div className="home-step-card">
              <h3>添加到客户端</h3>
              <p>选择对应格式，合并到客户端的 MCP 设置，保留原有配置。</p>
              <details className="home-config" onToggle={event=>setConfigOpen(event.currentTarget.open)}><summary>查看并复制连接配置</summary>{configOpen&&<McpConnectionInfo busy={pending} perform={perform} t={t}/>}</details>
            </div>
          </li>
          <li>
            <div className="home-step-card">
              <h3>验证连接</h3>
              <p>保存配置并重新连接（必要时重启客户端），发送下方指令。返回状态和命令列表即连接成功。</p>
              <div className="home-prompt-card">
                <div className="home-prompt-head">
                  <span>验证指令</span>
                  <Button icon={promptCopied?'check':'copy'} disabled={pending} onClick={()=>perform(async()=>{await window.tugou.copyText(verifyPrompt);setPromptCopied(true);setNotice('验证指令已复制');setTimeout(()=>setPromptCopied(false),1800);})}>{promptCopied?'已复制':'复制验证指令'}</Button>
                </div>
                <blockquote>{verifyPrompt}</blockquote>
              </div>
            </div>
          </li>
        </ol>
        {error&&<p role="alert" className="home-error">{error}</p>}{notice&&<p role="status" className="home-notice">{notice}</p>}
        <p className="home-mcp-footnote"><Icon name="info"/><span>使用本机 stdio 连接，仅支持 URL 的客户端暂不可用。生成任务使用土狗配置的供应商，按其服务规则计费。</span></p>
      </section>
    </FormDialog>}
  </div></div>;
}
