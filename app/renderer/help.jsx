import React, {useEffect, useRef, useState} from 'react';
import {Drawer, Input} from 'antd';
import {Button, EmptyState, Icon} from './components.jsx';
import './help.css';

const topics=[
  {id:'start',title:'从哪里开始创作',tags:'首页 模块 工程 新建 导入',text:['各模块可以独立使用，没有固定创作顺序。用左侧导航进入提示词、画布、图层、PPT、工具、素材或字体。','顶部文件夹菜单可新建、导入和管理工程，切换工程后会回到首页展示封面与快捷入口；刷新页面则停留在当前工作区。']},
  {id:'canvas',title:'无限画布操作与连线',tags:'画布 节点 连线 整理 飞入 触控板 滚轮',text:['双击画布空白处、按 Tab 键或使用底部悬浮工具坞添加节点，拖入本地图片可直接创建参考图。选中节点后，底部工具坞上方会按选区浮出生成、整理、分组、图片处理与删除等上下文操作。','连进控制台的输入线默认以流动晴朗蓝显示，控制台产出的结果线默认显示为灰色虚线；悬停或选中任意连线时，点击中点 × 按钮可一键断开。','双击节点标题栏或空白边框可平滑飞入居中聚焦；双指上下左右滑动或滚轮默认平移画布，双指捏合或 Ctrl/⌘＋滚轮缩放（可在“设置 → 画布”调整滚轮行为）。']},
  {id:'layers',title:'图层、属性与画板空间',tags:'面板 缩放 调整 导航 蒙版 参数 工具坞',text:['右侧图层列表保持可见，调整与导航位于图层上方。点击画布中的对象进行选择。双击未锁定的文字可在画布原位置编辑：Enter 换行，Ctrl/⌘＋Enter 或点击其他位置完成，Esc 取消；整次修改可以一次撤销。','点击图层名称或缩略图打开对应属性，再点同一图层关闭；点击其他图层切换属性，Shift 点击保留多选操作。关闭属性列可释放画板空间；调整与导航仍在图层上方。','修图、添加、调整、特效、图层操作、排版、变换、选区操作、蒙版与 PSD 均收拢在画布底部的悬浮工具坞中，子菜单会向上弹出；工具较多时可左右滚动或点击两侧箭头翻动。画板不提供角点拖拽缩放，宽、高在画板属性中修改。']},
  {id:'line',title:'在图层或 PPT 中绘制直线',tags:'线条 形状 绘画 工具 悬浮栏',text:['图层编辑器：展开底部悬浮工具坞中的形状工具，选择直线。PPT：点击底部悬浮工具坞中的直线工具。在画板上从起点拖到终点。','选中直线后，在对应属性中调整描边颜色与线宽。直线、文字、形状均可通过顶部撤销按钮撤回操作。']},
  {id:'save',title:'保存失败后如何恢复',tags:'自动保存 未保存 磁盘 权限 冲突 备份 重试',text:['顶部会显示未保存、保存中、已保存或保存失败。保存失败时，当前编辑仍在窗口中，请先保留窗口。','根据错误信息检查保存位置、可用空间或写入权限，处理后点击错误提示中的“重试保存”。只有顶部显示“已保存”才表示本轮写入完成。','若提示工程版本冲突，不要强制覆盖或直接重新打开工程。先保留当前窗口和错误信息，确认是否有其他窗口或外部工具修改了同一工程。']},
  {id:'tasks',title:'任务失败、取消与重试',tags:'生成 分析 网络 模型 排队 中断 费用',text:['打开顶部“任务”查看进行中、需关注与已完成记录（顶栏会同步显示进行中数量或待关注红点）。较长的消息可以展开阅读全文。','失败或中断后先看具体错误：模型连接问题可在“模型连接”中检查；本地处理问题请核对输入和运行环境。支持恢复的任务会显示重试或继续安装按钮，其余任务可打开工程重新操作。','“取消任务”针对单项，“取消整个批次”针对该批次。点击后等待状态更新；取消不代表供应商已经退还费用。','重新请求模型或重试含云端生成的工作流可能再次计费。若提示请求已提交但记录刷新失败，请先刷新任务记录，不要重复提交。'],action:'tasks'},
  {id:'ppt',title:'PPT 的编辑与导出',tags:'幻灯片 页面 讲稿 文字 图片 演示 属性 空间',text:['在 PPT 模块选择页面，使用底部悬浮工具坞插入空白页、文字、图片、素材库或形状；选中文字后，文字格式栏会自动浮现在工具坞正上方，可直接调整字体、字重、字号、颜色、斜体和对齐。','属性、图层、内容和讲稿共用右侧面板，点击顶栏对应分段按钮展开，再次点击可收起。双击未锁定文字可直接在画布编辑，Enter 换行，Ctrl/⌘＋Enter 或点击其他位置完成，Esc 取消。','左侧切换页面，底部可查看页码、打开讲稿和适应窗口；预览或全屏演示时鼠标静止会自动隐藏控制条，移动鼠标即可恢复。']},
  {id:'shortcuts',title:'查找与修改快捷键',tags:'键盘 撤销 重做 删除 平移 选择',text:['左下角“设置 → 快捷键”列出当前按键与操作，可按习惯修改。系统平台或自定义设置会影响实际按键，以设置中显示的内容为准。','工具按钮的提示可帮助辨认功能。文字输入时，先结束输入再执行画布快捷操作。']},
  {id:'mcp',title:'连接外部 MCP 工具',tags:'AI 助手 自动化 服务 设置',text:['打开左下角“设置 → MCP”，查看当前服务状态与连接配置，再按页面提示配置外部客户端。','外部工具与手动操作可以配合使用。操作前核对工程与目标页面，避免多个客户端同时修改同一工程。']},
];

export function HelpPanel({open,close,showTasks}){
  const [query,setQuery]=useState(''),[selected,setSelected]=useState(null);
  const heading=useRef(null),search=useRef(null);
  useEffect(()=>{if(open)(selected?heading.current:search.current)?.focus();},[open,selected]);
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches=topics.filter(t=>words.every(word=>[t.title,t.tags,...t.text].join(' ').toLocaleLowerCase().includes(word)));
  const topic=topics.find(t=>t.id===selected);
  return <Drawer title="帮助" open={open} onClose={close} size={420} mask={false} push={false} zIndex={1100} rootClassName="help-drawer" closable={{'aria-label':'关闭帮助'}} styles={{wrapper:{maxWidth:'100vw'}}}>
    {topic?<>
      <Button icon="back" onClick={()=>setSelected(null)}>返回搜索结果</Button>
      <article className="help-article"><h2 ref={heading} tabIndex={-1}>{topic.title}</h2>{topic.text.map(text=><p key={text}>{text}</p>)}</article>
      {topic.action==='tasks'&&<Button icon="tasks" onClick={()=>{close();showTasks();}}>查看任务记录</Button>}
    </>:<>
      <p className="help-intro">按当前需要查找，自由选择创作方式。</p>
      <Input ref={search} aria-label="搜索帮助" placeholder="搜索工具、保存、任务…" prefix={<Icon name="search"/>} allowClear value={query} onChange={e=>setQuery(e.target.value)}/>
      <p className="help-count" role="status">{query.trim()?`找到 ${matches.length} 个主题`:'常用主题'}</p>
      <nav className="help-topics" aria-label="帮助主题">{matches.map(t=><button key={t.id} onClick={()=>setSelected(t.id)}><span>{t.title}</span><Icon name="expand"/></button>)}</nav>
      {!matches.length&&<EmptyState compact icon="search" title="没有找到相关帮助" description="试试“保存”“图层”或“任务”，也可以清空搜索查看全部主题。"/>}
    </>}
  </Drawer>;
}
