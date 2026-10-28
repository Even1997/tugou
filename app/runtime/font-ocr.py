"""Local OCR proposes identities; only reviewed mappings reach the font compiler."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def bands(active):
    edges = np.diff(np.r_[False, active, False].astype('int8'))
    return list(zip(np.where(edges == 1)[0], np.where(edges == -1)[0]))


def gutter_boxes(mask):
    """Use measured whitespace for regular atlases, never assign identities by position."""
    columns = bands(mask.any(axis=0))
    if len(columns) < 3 or len(columns) > 40:
        return []
    centers = np.array([(a+b)/2 for a, b in columns])
    pitch = float(np.median(np.diff(centers)))
    if np.std(np.diff(centers))/pitch > .15 or min(b-a for a, b in columns) < pitch*.25:
        return []
    occupancy = np.stack([mask[:, a:b].any(axis=1) for a, b in columns]).sum(axis=0)
    rows = bands(occupancy >= max(1, len(columns)*.25))
    rows = [(a,b) for a,b in rows if b-a >= pitch*.25]
    if len(rows) < 3:
        return []
    # Voronoi boundaries between observed rows are refined to local blank lines per column.
    cuts = [0]+[int((b+c)/2) for (_,b),(c,_) in zip(rows,rows[1:])]+[mask.shape[0]]
    boxes = []
    for ri, (a,b) in enumerate(rows):
        for x0,x1 in columns:
            strip = mask[:, x0:x1]
            local = strip[cuts[ri]:cuts[ri+1]]
            if not local.any():
                continue
            y0,y1 = cuts[ri],cuts[ri+1]
            radius = max(2, int(pitch*.2))
            for edge,up in [(y0,True),(y1,False)]:
                low,high=max(0,edge-radius),min(mask.shape[0],edge+radius+1)
                blanks = np.flatnonzero(~strip[low:high].any(axis=1))+low
                if len(blanks):
                    nearest=int(blanks[np.argmin(abs(blanks-edge))])
                    if up:y0=nearest
                    else:y1=nearest+1
            if y1<=y0 or not strip[y0:y1].any():
                continue
            yy,xx=np.nonzero(strip[y0:y1])
            boxes.append([max(0,int(x0+xx.min())-2),max(0,int(y0+yy.min())-2),min(mask.shape[1],int(x0+xx.max())+3),min(mask.shape[0],int(y0+yy.max())+3)])
    return boxes


def snap_box(mask, points):
    points=np.array(points)
    height,width=mask.shape
    x0,y0=np.floor(points.min(axis=0)).astype(int);x1,y1=np.ceil(points.max(axis=0)).astype(int)
    x0,y0=max(0,x0),max(0,y0);x1,y1=min(width,x1+1),min(height,y1+1)
    radius=max(3,round(min(x1-x0,y1-y0)*.25))
    # Expand OCR rectangles only to nearby blank lines; never remove border protection.
    for _ in range(radius):
        changes=(x0>0 and mask[y0:y1,x0].any(), y0>0 and mask[y0,x0:x1].any(), x1<width and mask[y0:y1,x1-1].any(), y1<height and mask[y1-1,x0:x1].any())
        if not any(changes):break
        x0-=int(changes[0]);y0-=int(changes[1]);x1+=int(changes[2]);y1+=int(changes[3])
    return [int(x0),int(y0),int(x1),int(y1)]


def recognize(job, out, progress, artifact):
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:
        raise ValueError('OCR_NOT_INSTALLED: 请运行字体环境配置脚本安装本地 OCR') from exc
    atlas=job['atlas']
    if hashlib.sha256(Path(atlas['source']).read_bytes()).hexdigest()!=atlas['sha256']:
        raise ValueError('SOURCE_CHANGED: 原图摘要不一致')
    source=Image.open(atlas['source']).convert('RGBA')
    white=Image.new('RGBA',source.size,'white');white.alpha_composite(source)
    rgb=np.array(white.convert('RGB'));mask=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)<128
    engine=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1)
    progress('检测文字',0,1)
    result,_=engine(cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR),use_cls=False,return_word_box=True,text_score=0)
    words=[]
    for line in result or []:
        for box,text,score in zip(line[3],line[4],line[5]):
            words.append(dict(box=snap_box(mask,box),text=text,score=float(score)))
    boxes=gutter_boxes(mask)
    method='whitespace-gutters+ocr' if boxes else 'ocr-boxes'
    if not boxes:boxes=[w['box'] for w in words]
    if len(boxes)>65533:
        raise ValueError('FONT_FORMAT_LIMIT: 检测字形数超出 TrueType 字体容量')
    candidates=[]
    for start in range(0,len(boxes),24):
        batch=boxes[start:start+24]
        crops=[cv2.copyMakeBorder(cv2.cvtColor(rgb[y0:y1,x0:x1],cv2.COLOR_RGB2BGR),8,8,8,8,cv2.BORDER_CONSTANT,value=(255,255,255)) for x0,y0,x1,y1 in batch]
        recognized,_=engine.text_rec(crops)
        for box,rec in zip(batch,recognized):
            x0,y0,x1,y1=box;text,score=rec[:2];warnings=[]
            context=[w for w in words if x0<=(w['box'][0]+w['box'][2])/2<x1 and y0<=(w['box'][1]+w['box'][3])/2<y1]
            if len(context)==1 and len(context[0]['text'])==1:
                word=context[0]
                if len(text)==1 and text!=word['text']:
                    warnings.append('IDENTITY_DISAGREEMENT')
                if word['score']>score or len(text)!=1:text,score=word['text'],word['score']
            cut=mask[y0:y1,x0:x1]
            if cut[0].any() or cut[-1].any() or cut[:,0].any() or cut[:,-1].any():warnings.append('CROP_EDGE')
            if len(text)==1 and text.isascii():warnings.append('CASE_OR_SYMBOL_CHECK')
            candidates.append(dict(character=text if len(text)==1 else '',recognizedText=text,score=float(score),box=box,warnings=warnings))
        progress('识别字形',len(candidates),len(boxes))
    report=dict(atlasId=atlas['id'],sourceHash=atlas['sha256'],width=source.width,height=source.height,method=method,scorePrecision='raw',engine='RapidOCR 1.4.4 / PP-OCRv4',candidates=candidates,identity='unverified',requiresConfirmation=True)
    (out/'recognition.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    return dict(report=report,artifacts=[artifact(out,'recognition.json','application/json')])
