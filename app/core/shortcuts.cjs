function isDeleteKey(event, platform) {
  return event.key === 'Delete' || (platform === 'darwin' && event.key === 'Backspace');
}
const definitions={save:'Mod+KeyS',undo:'Mod+KeyZ',redo:'Mod+Shift+KeyZ',duplicate:'Mod+KeyJ',deselect:'Mod+KeyD',group:'Mod+KeyG',ungroup:'Mod+Shift+KeyG',delete:'Delete',pan:'Space',inverse:'Mod+Shift+KeyI',swapMaskInk:'KeyX',toolMove:'KeyV',toolHand:'KeyH',toolBrush:'KeyB',toolEraser:'KeyE',toolSelection:'KeyM',toolLasso:'KeyL',toolShape:'KeyU'};
const modifiers=['Ctrl','Meta','Alt','Shift'];
function bindings(platform,settings={}){return {...Object.fromEntries(Object.entries(definitions).map(([id,key])=>[id,id==='delete'&&platform==='darwin'?'Backspace':key.replace('Mod',platform==='darwin'?'Meta':'Ctrl')])),...settings[platform==='darwin'?'darwin':'win32']};}
function eventBinding(e){
  if(e.isComposing||e.keyCode===229||e.getModifierState?.('AltGraph'))return null;
  const key=e.key||'',code=/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Delete|Backspace)$/.test(e.code)?e.code:key===' '?'Space':/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():/^[0-9]$/.test(key)?'Digit'+key:key;
  if(!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Delete|Backspace)$/.test(code))return null;
  return [...modifiers.filter((_,i)=>!!e[['ctrlKey','metaKey','altKey','shiftKey'][i]]),code].join('+');
}
function commandFor(e,platform,settings){const key=eventBinding(e),all=bindings(platform,settings);return key?Object.entries(all).find(([,value])=>value===key)?.[0]||(platform==='darwin'&&key==='Delete'&&all.delete==='Backspace'?'delete':null):null;}
function bindingError(id,key,platform,settings={}){
  if(!Object.hasOwn(definitions,id)||typeof key!=='string')return 'shortcutInvalid';
  const parts=key.split('+'),code=parts.pop(),mods=parts;
  if(!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Delete|Backspace)$/.test(code)||mods.join('+')!==modifiers.filter(m=>mods.includes(m)).join('+')||(platform!=='darwin'&&mods.includes('Meta')))return 'shortcutInvalid';
  if(id==='pan'&&(mods.length||!(/^(Space|Key[A-Z])$/).test(code)))return 'shortcutPanKey';
  const primary=platform==='darwin'?'Meta':'Ctrl';
  if(['Alt+Space','Ctrl+Space','Ctrl+Alt+Delete'].includes(key))return 'shortcutReserved';
  if((mods.includes(primary)&&['KeyA','KeyC','KeyV','KeyX','KeyQ','KeyW','KeyR','Space'].includes(code))||['F5','F11','F12'].includes(code)||(mods.includes('Alt')&&code==='F4')||(platform==='darwin'&&mods.includes('Meta')&&['KeyH','KeyM'].includes(code)))return 'shortcutReserved';
  if(!mods.some(m=>m!=='Shift')&&!/^F\d+$/.test(code)&&!['delete','pan','swapMaskInk'].includes(id)&&!id.startsWith('tool'))return 'shortcutModifier';
  const all=bindings(platform,settings);
  if(platform==='darwin'&&id!=='delete'&&key==='Delete'&&all.delete==='Backspace')return 'shortcutConflict:delete';
  const conflict=Object.entries(all).find(([other,value])=>other!==id&&value===key);
  return conflict?'shortcutConflict:'+conflict[0]:null;
}
function validateShortcuts(settings){
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('INVALID_SHORTCUTS');
  for(const [platform,values]of Object.entries(settings)){
    if(!['win32','darwin'].includes(platform)||!values||typeof values!=='object'||Array.isArray(values))throw Error('INVALID_SHORTCUTS');
    for(const [id,key]of Object.entries(values))if(bindingError(id,key,platform,settings))throw Error('INVALID_SHORTCUTS');
  }
}
function formatBinding(key,platform){const mac=platform==='darwin';return key.split('+').map(k=>({Ctrl:mac?'⌃':'Ctrl',Meta:'⌘',Alt:mac?'⌥':'Alt',Shift:mac?'⇧':'Shift',Space:mac?'␣':'Space',Backspace:mac?'⌫':'Backspace',Delete:mac?'⌦':'Delete'}[k]||k.replace(/^(Key|Digit)/,''))).join(mac?'':' + ');}
function accelerator(key){return key.split('+').map(k=>({Meta:'Command',Ctrl:'Control'}[k]||k.replace(/^(Key|Digit)/,''))).join('+');}
function shortcutBlocked(e){return e.defaultPrevented||e.isComposing||e.keyCode===229||!!e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]');}
module.exports = { isDeleteKey,definitions,bindings,eventBinding,commandFor,bindingError,validateShortcuts,formatBinding,accelerator,shortcutBlocked };
