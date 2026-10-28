import React,{useEffect,useRef,useState} from 'react';
import {Button,FormDialog,Input} from './components.jsx';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function MediaTools({asset,receive,close}){
  const ref=useRef(null),cancel=useRef(false),mounted=useRef(true);
  const [start,setStart]=useState(0),[end,setEnd]=useState(1),[duration,setDuration]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(0);
  useEffect(()=>()=>{mounted.current=false;cancel.current=true;},[]);
  const process=async mode=>{
    const media=ref.current;setError('');
    if(!Number.isFinite(start)||start<0||start>=duration||mode!=='frame'&&(!Number.isFinite(end)||end<=start||end>duration)){setError('请填写有效的起止时间');return;}
    cancel.current=false;setBusy(true);let stream,recorder;
    try{
      media.pause();media.currentTime=start;
      for(let i=0;i<500&&(media.seeking||media.readyState<2);i++)await wait(10);
      if(media.seeking||media.readyState<2)throw Error('媒体定位超时');
      let result;
      if(mode==='frame'){
        const canvas=document.createElement('canvas');canvas.width=media.videoWidth;canvas.height=media.videoHeight;
        if(!canvas.width||canvas.width*canvas.height>100000000)throw Error('视频帧尺寸不支持');
        canvas.getContext('2d').drawImage(media,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error('无法提取视频帧');
        result=await window.tugou.storeRaster([...new Uint8Array(await blob.arrayBuffer())],asset.name+' · 视频帧');
      }else{
        const audioOnly=asset.kind==='audio'||mode==='audio';
        const type=(audioOnly?['audio/webm;codecs=opus']:['video/mp4;codecs=avc1.42001E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm']).find(s=>MediaRecorder.isTypeSupported(s));
        if(!type)throw Error('当前设备不支持此媒体编码');
        media.muted=true;await media.play();stream=media.captureStream();
        if(audioOnly){stream.getVideoTracks().forEach(t=>{stream.removeTrack(t);t.stop();});if(!stream.getAudioTracks().length)throw Error('该视频没有可提取的音轨');}
        const chunks=[];recorder=new MediaRecorder(stream,{mimeType:type});
        const stopped=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||Error('截取失败'));});
        recorder.start();const deadline=performance.now()+(end-start)*1000+10000;
        while(media.currentTime<end&&!media.ended&&!cancel.current){if(performance.now()>deadline)throw Error('截取超时');if(mounted.current)setProgress(Math.min(100,Math.round((media.currentTime-start)/(end-start)*100)));await wait(30);}
        recorder.stop();await stopped;
        if(cancel.current)return;
        const blob=new Blob(chunks,{type});if(!blob.size)throw Error('截取结果为空');
        result=await window.tugou.storeMedia([...new Uint8Array(await blob.arrayBuffer())],asset.name+(mode==='audio'?' · 音轨':' · 片段')+(audioOnly?'.weba':type.startsWith('video/mp4')?'.mp4':'.webm'));
      }
      if(mounted.current&&!cancel.current){await receive(result);setProgress(100);}
    }catch(e){if(mounted.current&&!cancel.current)setError(e.message);}
    finally{if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(t=>t.stop());media.pause();media.muted=false;if(mounted.current)setBusy(false);}
  };
  const props={ref,crossOrigin:'anonymous',src:`tugou-media://original/${asset.resource}`,controls:true,preload:'metadata',style:{width:'100%',maxHeight:'45vh'},onLoadedMetadata:e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)){setDuration(d);setEnd(d);}},onError:()=>setError('媒体无法解码')};
  return <FormDialog title="媒体工具" width={760} close={()=>{if(busy){cancel.current=true;return;}close();}}>
    <div className="editor-toolbar" style={{marginBottom:12}}>{asset.kind==='video'&&<Button disabled={busy||!duration} onClick={()=>process('frame')}>提取视频帧</Button>}<Button disabled={busy||!duration} onClick={()=>process('trim')}>截取片段</Button>{asset.kind==='video'&&<Button disabled={busy||!duration} onClick={()=>process('audio')}>提取音轨</Button>}{busy&&<Button onClick={()=>cancel.current=true}>取消处理</Button>}</div>
    {asset.kind==='video'?<video {...props}/>:<audio {...props}/>}
    <div className="fields"><label>开始（秒）<Input aria-label="片段开始" type="number" step="0.1" disabled={busy} value={start} onChange={e=>setStart(Number(e.target.value))}/></label><label>结束（秒）<Input aria-label="片段结束" type="number" step="0.1" disabled={busy} value={end} onChange={e=>setEnd(Number(e.target.value))}/></label></div>
    <Button disabled={busy} onClick={()=>setStart(ref.current.currentTime)}>使用当前播放位置</Button>
    {busy&&<p role="status">处理进度 {progress}%</p>}{!busy&&progress===100&&<p role="status">结果已加入素材库和画布</p>}{error&&<p role="alert">{error}</p>}
  </FormDialog>;
}
