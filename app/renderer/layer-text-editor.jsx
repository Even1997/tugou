import React from 'react';
import {CanvasTextInput} from './canvas-text-input.jsx';
import {worldMatrix,homography} from '../core/layers.cjs';
import {textFontWeight} from '../core/font-weights.cjs';
import {textFontFamily} from './font-face.js';
import {TextFormatTools} from './text-format-tools.jsx';

export function LayerTextEditor({layer,layers,view,onCommit,onCancel}) {
  const m=worldMatrix(layers,layer),z=view.zoom,h=layer.warp&&homography(layer.warp),w=layer.width,b=layer.height;
  // Convert the compositor's normalized perspective into editor pixel coordinates.
  const perspective=h?` matrix3d(${[h[0],h[3]*b/w,0,h[6]/w,h[1]*w/b,h[4],0,h[7]/b,0,0,1,0,h[2]*w,h[5]*b,0,1].join(',')})`:'';
  return <><TextFormatTools element={layer}/><CanvasTextInput className="layer-text-editor" element={layer} onCommit={onCommit} onCancel={onCancel}
    style={{width:layer.width,height:layer.height,transform:`matrix(${m[0]*z},${m[1]*z},${m[2]*z},${m[3]*z},${view.x+m[4]*z},${view.y+m[5]*z})${perspective}`,fontFamily:textFontFamily(layer),fontSize:layer.fontSize||32,fontWeight:textFontWeight(layer),fontStyle:layer.fontStyle?.includes('italic')?'italic':'normal',lineHeight:layer.lineHeight||1.4,letterSpacing:layer.letterSpacing||0,textAlign:layer.align||'left',color:layer.color||'#222222'}}
  /></>;
}
