import React,{useMemo} from 'react';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {usePreferences} from './preferences.jsx';
import './release-notes.css';

export function ReleaseNotes({text,onLink}){
  const {t}=usePreferences();
  const html=useMemo(()=>DOMPurify.sanitize(marked.parse(text,{async:false,breaks:true}),{
    ALLOWED_TAGS:['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','b','em','i','del','s','blockquote','pre','code','table','thead','tbody','tr','th','td','a'],
    ALLOWED_ATTR:['href','title'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,
    ALLOWED_URI_REGEXP:/^https:\/\/github\.com\/Even1997\/tugou(?:[/?#]|$)/i,
  }),[text]);
  return <div className="release-notes" role="region" aria-label={t('releaseNotes')} tabIndex={0} onClick={event=>{
    const link=event.target.closest('a[href]');if(!link)return;
    event.preventDefault();onLink(link.getAttribute('href'));
  }} dangerouslySetInnerHTML={{__html:html}}/>;
}
