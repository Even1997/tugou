import React,{useEffect,useState} from 'react';
import {Button,Icon,Input,FormDialog} from './components.jsx';
import {McpConnectionInfo} from './settings-connections.jsx';
import {usePreferences} from './preferences.jsx';
import './home.css';

const verifyPrompt='请连接土狗，先调用 get_state 查看当前工程，再调用 list_commands 查看画布可用命令。只读取信息，暂不修改工程或生成图片。';
const pageSize=6;
export const workspaceNames={prompts:'提示词工作台',canvas:'无限画布',layers:'图层编辑器',ppt:'PPT',tools:'图像工具',assets:'素材库',fonts:'字体'};
export function HomeWorkspace({projects,projectsReady,record,tasks,tasksReady,busy,create,open,navigate,showTasks,lastWorkspace}){
  const {t,locale}=usePreferences();
  const [mcp,setMcp]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[configOpen,setConfigOpen]=useState(false);
  const [guideOpen,setGuideOpen]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0);
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
  return <div className="home-workspace"><div className="home-content">
    <header className="home-heading"><div><h1>首页</h1><p>管理工程、查看任务，连接你的 AI 助手。</p></div><div className="home-actions"><Button type="default" icon="connect" onClick={()=>setGuideOpen(true)}>MCP 连接</Button><Button primary className="home-create" icon="add" disabled={busy} onClick={create}>新建工程</Button></div></header>
    <section className="home-stats" aria-label="创作统计">{stats.map(([label,value,hint,icon])=><article key={label}><span className="home-stat-icon"><Icon name={icon}/></span><div><span>{label}</span><strong aria-label={`${label}数量`}>{value===null?'—':value.toLocaleString(locale)}</strong></div><p>{hint}</p></article>)}</section>
    <div className="home-columns">
      <section className="home-section home-current"><header><h2><Icon name={lastWorkspace||'open'}/>继续创作</h2>{record&&<span>{record.document.assets.length} 项素材</span>}</header>{record?<><h3 title={record.document.name}>{record.document.name}</h3><p>{lastWorkspace?`返回${workspaceNames[lastWorkspace]}继续编辑，保留当前未保存的内容。`:'从左侧选择工作区，自由开始创作。'}</p><div className="home-actions">{lastWorkspace&&<Button primary icon={lastWorkspace} disabled={busy} onClick={()=>navigate(lastWorkspace)}>继续{workspaceNames[lastWorkspace]}</Button>}{lastWorkspace!=='tools'&&<Button icon="tools" disabled={busy} onClick={()=>navigate('tools')}>图像工具</Button>}</div></>:<><h3>从一个工程开始</h3><p>新建工程，或打开下方最近保存的工程。</p><div className="home-actions"><Button primary icon="add" disabled={busy} onClick={create}>创建新工程</Button><Button icon="tools" disabled={busy} onClick={()=>navigate('tools')}>图像工具</Button></div></>}</section>
      <section className="home-section home-mcp-card" aria-label="MCP 连接"><header><h2><Icon name="connect"/>MCP 连接</h2>{mcpStatus}</header><h3>让 AI 助手参与创作</h3><p>连接支持 MCP 的客户端，读取工程、编辑画布、调用图像工具。</p><div className="home-actions"><Button type="default" icon="connect" onClick={()=>setGuideOpen(true)}>查看连接引导</Button><span className="home-mcp-hint">本机连接 · 三步设置</span></div></section>
    </div>
    <section className="home-section home-recent-section" aria-label="工程列表"><header><div><h2>我的工程</h2><p>按最近保存时间排序</p></div><Input className="home-project-search" aria-label="搜索工程名称" placeholder="搜索工程名称" prefix={<Icon name="search"/>} allowClear value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></header>
      {!projectsReady?<p role="status" className="home-empty">正在读取工程…</p>:!recent.length?<p className="home-empty">{query.trim()?'没有匹配的工程，试试其他名称。':'还没有工程。开始创作后，你的工程会显示在这里。'}</p>:<div className={`home-recent${matching.length>pageSize?' paginated':''}`}>{recent.map(project=><button key={project.id} disabled={busy||!!project.error} onClick={()=>project.id===record?.id?navigate(lastWorkspace||'home'):open(project.id)} title={project.error||nameOf(project)}><span className="home-project-icon"><Icon name="open"/></span><span className="home-project-copy"><strong>{nameOf(project)}</strong><small>{project.error||time(project.updatedAt)}</small></span>{project.id===record?.id?<em>当前</em>:<Icon name="expand"/>}</button>)}</div>}
      <footer className="home-project-footer"><div><span>{projectsReady?`共 ${matching.length} 个工程${query.trim()?'匹配搜索':''}`:'正在读取…'}</span><Button icon="tasks" onClick={showTasks}>任务记录</Button></div><nav aria-label="工程分页" hidden={pageCount===1}><Button icon="expand" className="home-page-prev" aria-label="上一页工程" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}/><span aria-live="polite">{currentPage+1} / {pageCount}</span><Button icon="expand" aria-label="下一页工程" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}/></nav></footer>
    </section>
    {error&&!guideOpen&&<p role="alert" className="home-error">{error}</p>}
    {guideOpen&&<FormDialog className="home-guide" title="MCP 连接引导" width={720} close={()=>{setGuideOpen(false);setConfigOpen(false);}}>
      <section id="home-mcp" className="home-mcp" aria-label="MCP 连接引导">{mcpStatus}
        <ol className="home-steps">
          <li><h3>启用本地服务</h3><p>连接时保持土狗运行，客户端是否连通需在第 3 步验证。</p><div className="home-actions"><Button primary={!mcp?.enabled} disabled={pending||!mcp||mcp.enabled} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpEnable',true)))}>{mcp?.enabled?'已启用 MCP':'启用 MCP'}</Button><Button icon="sync" disabled={pending} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpStatus')))}>刷新状态</Button></div></li>
          <li><h3>添加到客户端</h3><p>选择对应格式，合并到客户端的 MCP 设置，保留原有配置。</p><details className="home-config" onToggle={event=>setConfigOpen(event.currentTarget.open)}><summary>查看并复制连接配置</summary>{configOpen&&<McpConnectionInfo busy={pending} perform={perform} t={t}/>}</details></li>
          <li><h3>验证连接</h3><p>保存配置并重新连接（必要时重启客户端），发送下方指令。返回状态和命令列表即连接成功。</p><blockquote>{verifyPrompt}</blockquote><Button type="default" icon="copy" disabled={pending} onClick={()=>perform(async()=>{await window.tugou.copyText(verifyPrompt);setNotice('验证指令已复制');})}>复制验证指令</Button></li>
        </ol>
        {error&&<p role="alert" className="home-error">{error}</p>}{notice&&<p role="status" className="home-notice">{notice}</p>}
        <p className="home-mcp-footnote">使用本机 stdio 连接，仅支持 URL 的客户端暂不可用。生成任务使用土狗配置的供应商，按其服务规则计费。</p>
      </section>
    </FormDialog>}
  </div></div>;
}
