import React,{useEffect,useRef,useSyncExternalStore} from 'react';
import {Editor,Node,Mark,Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {history,undo,redo} from '@tiptap/pm/history';
import {keymap} from '@tiptap/pm/keymap';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import {baseStyle,styledRuns,compactRuns,styleKeys,validateTextRuns} from '../core/rich-text.cjs';
import {textFontFamily,loadTextFont} from './font-face.js';
import './canvas-text-input.css';

const listeners=new Set();let active=null;
const publish=value=>{active=value;listeners.forEach(fn=>fn());};
export const textFormatTarget=target=>!!target?.closest?.('[data-text-format],.studio-select-popup');
export function useTextFormat(id){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>active?.id===id?active:null);}
export const runStyle=r=>({fontFamily:textFontFamily(r),fontSize:r.fontSize,fontWeight:r.fontWeight,fontStyle:r.italic?'italic':'normal',color:r.color});
export function RichText({element}){return styledRuns(element).map((r,i)=><span key={i} style={runStyle(r)}>{r.text}</span>);}

const Doc=Node.create({name:'doc',topNode:true,content:'paragraph+'});
const Paragraph=Node.create({name:'paragraph',group:'block',content:'text*',parseHTML:()=>[{tag:'p'}],renderHTML:()=>['p',0]});
const Text=Node.create({name:'text',group:'inline'});
const Style=Mark.create({name:'textStyle',addAttributes:()=>Object.fromEntries(styleKeys.map(k=>[k,{default:null}])),
  parseHTML:()=>[{tag:'span[data-text-style]',getAttrs:node=>{try{const attrs=JSON.parse(node.getAttribute('data-text-style'));validateTextRuns({kind:'text',text:'x',textRuns:[{...attrs,text:'x'}]});return attrs;}catch{return false;}}}],
  renderHTML:({mark})=>{const a=Object.fromEntries(Object.entries(mark.attrs).filter(([,v])=>v!==null)),s=runStyle(a);
    const span=document.createElement('span');Object.assign(span.style,{...s,fontSize:s.fontSize?`${s.fontSize}px`:''});
    return ['span',{'data-text-style':JSON.stringify(a),style:span.style.cssText},0];}});
function contentOf(element){
  const paragraphs=[{type:'paragraph',content:[]}];
  for(const {text,...attrs} of styledRuns(element))text.split('\n').forEach((part,i)=>{if(i)paragraphs.push({type:'paragraph',content:[]});if(part)paragraphs.at(-1).content.push({type:'text',text:part,marks:[{type:'textStyle',attrs}]});});
  return {type:'doc',content:paragraphs};
}
function valueOf(doc,element){
  const runs=[];doc.forEach((p,_,i)=>{if(i)runs.push({...p.firstChild?.marks[0]?.attrs,text:'\n'});p.forEach(n=>runs.push({...n.marks.find(m=>m.type.name==='textStyle')?.attrs,text:n.text}));});
  const base=baseStyle(element),textRuns=compactRuns(runs.map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>k==='text'||v!==null&&JSON.stringify(v)!==JSON.stringify(base[k])||k==='fontResource'&&JSON.stringify(v)!==JSON.stringify(base[k])))));
  return {text:textRuns.map(r=>r.text).join(''),textRuns:textRuns.some(r=>Object.keys(r).length>1)?textRuns:undefined};
}
export function CanvasTextInput({element,style,className,maxLength=100000,onCommit,onCancel}){
  const host=useRef(null),callbacks=useRef({onCommit,onCancel});callbacks.current={onCommit,onCancel};
  useEffect(()=>{
    let finished=false,composing=false,blurred=false,editor;
    const finish=save=>{
      if(finished)return;if(save&&composing){blurred=true;return;}
      finished=true;
      if(save&&callbacks.current.onCommit(valueOf(editor.state.doc,element))===false){finished=false;editor.commands.focus();}
      else if(!save)callbacks.current.onCancel();
    };
    const update=()=>{
      if(finished)return;const {from,to}=editor.state.selection,doc=editor.state.doc;
      const attrs=editor.getAttributes('textStyle'),shown={...baseStyle(element),...Object.fromEntries(Object.entries(attrs).filter(([,v])=>v!==null))};
      publish({id:element.id,style:shown,selected:from!==to,apply:patch=>{
        if(finished||editor.isDestroyed||editor.state.doc!==doc)return;
        const values=Object.fromEntries(Object.entries(patch).filter(([k])=>styleKeys.includes(k)));
        if(!Object.keys(values).length)return;
        editor.chain().setTextSelection({from,to}).setMark('textStyle',values).run();
      }});
    };
    const controls=Extension.create({name:'canvasControls',addProseMirrorPlugins:()=>[
      history(),keymap({'Mod-z':undo,'Mod-Shift-z':redo,'Mod-y':redo}),
      new Plugin({filterTransaction:tr=>!tr.docChanged||tr.doc.textBetween(0,tr.doc.content.size,'\n').length<=maxLength,
        props:{decorations:state=>{const {from,to}=state.selection;return from===to?null:DecorationSet.create(state.doc,[Decoration.inline(from,to,{class:'canvas-text-selection'})]);}}})]});
    editor=new Editor({element:host.current,extensions:[Doc,Paragraph,Text,Style,controls],content:contentOf(element),injectCSS:false,
      editorProps:{attributes:{role:'textbox','aria-label':'画布文字编辑','aria-multiline':'true',spellcheck:'false'},
        handleKeyDown:(_,e)=>{
          e.stopPropagation();if(composing||e.isComposing||e.keyCode===229)return false;
          if(e.key==='Escape'){e.preventDefault();finish(false);return true;}
          if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finish(true);return true;}
          if(e.key==='Enter'&&e.shiftKey){editor.commands.splitBlock();return true;}
          return false;
        },
        handlePaste:(view,e)=>{const text=e.clipboardData?.getData('text/plain');if(text===undefined)return false;e.preventDefault();editor.commands.insertContent(text.split(/\r?\n/).map(line=>({type:'paragraph',content:line?[{type:'text',text:line,marks:(editor.state.storedMarks||editor.state.selection.$from.marks()).map(m=>m.toJSON())}]:[]})));return true;},
        handleDOMEvents:{compositionstart:()=>{composing=true;return false;},compositionend:()=>{composing=false;setTimeout(()=>{if(blurred){blurred=false;finish(true);}},0);return false;},
          blur:(_,e)=>{if(textFormatTarget(e.relatedTarget))return false;setTimeout(()=>{if(!finished&&!textFormatTarget(document.activeElement)&&!host.current?.contains(document.activeElement))finish(true);},0);return false;}}},
      onSelectionUpdate:update,onTransaction:({transaction})=>{if(transaction.docChanged||transaction.storedMarksSet)update();}});
    const outside=e=>{if(e.type==='focusin'&&e.target===document.body)return;if(!host.current?.contains(e.target)&&!textFormatTarget(e.target)){if(textFormatTarget(document.activeElement))document.activeElement.blur();finish(true);}};
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside);
    editor.commands.focus('all');update();
    Promise.all(styledRuns(element).map(loadTextFont)).catch(()=>{});
    return()=>{finished=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);editor.destroy();if(active?.id===element.id)publish(null);};
  },[]);
  return <div ref={host} className={className} style={style} onPointerDown={e=>e.stopPropagation()} onPointerMove={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()}/>;
}
