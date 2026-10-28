module.exports=async({w,js,delay,check,wait,click,set,shot,save,key,report})=>{
  w.setSize(1440,960);await delay(250);await key('Escape');await click('移动','.composition-primary-tools button');
  check('rulers use visible viewport only',await js(`document.querySelectorAll('.canvas-rulers path').length>20&&document.querySelectorAll('.canvas-rulers path').length<200`));
  await js(`document.querySelector('.layer-row:not([data-artboard=true]) .layer-name')?.click()`);await delay(150);
  check('selected object exposes persistent dimensions',await js(`!!document.querySelector('.selection-size-badge')?.textContent.includes('px')`));
  await shot('selection-dimensions');
  await js(`document.querySelector('[aria-label="混合模式"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));document.querySelector('[aria-label="混合模式"]').focus()`);await delay(100);await w.webContents.insertText('正片');await delay(150);
  check('long dropdown filters labels',await js(`document.querySelectorAll('.studio-select-popup:not(.ant-select-dropdown-hidden) .ant-select-item-option').length===1&&document.querySelector('.studio-select-popup:not(.ant-select-dropdown-hidden)').textContent.includes('正片叠底')`));
  await key('Enter');check('keyboard commits filtered blend mode',(await save()).layers.some(l=>l.blend==='multiply'));await click('撤销');await save();
  await click('锁定所选图层');check('shared dropdown inherits locked fieldset',await js(`document.querySelector('[aria-label="混合模式"]').disabled`));await click('解锁所选图层');await save();
  await click('画板','.layer-sidebar .panel-heading button');await click('尺寸预设','.board-size-trigger');
  check('size editor is anchored and leaves canvas interactive',await js(`!!document.querySelector('.board-size-popover:not(.ant-popover-hidden) .board-size-panel')&&!document.querySelector('.ant-modal-mask')`));
  await shot('size-popover');
  await set('画板宽度',0);check('invalid size disables apply',await js(`[...document.querySelectorAll('.board-size-panel button')].find(b=>b.textContent==='应用尺寸').disabled`));
  await set('画板宽度',1000);await set('画板高度',1000);await js(`document.querySelector('[aria-label="画板高度"]').focus()`);await key('Escape');
  check('Escape dismisses size panel',await js(`!document.querySelector('.board-size-panel')`));
  check('size popup restores trigger focus',await js(`document.activeElement.matches('.board-size-trigger')`));
  await click('自定义尺寸','.board-preset-button');await shot('size-popover-toolbar');await click('取消','.board-dialog-actions button');
  await click('尺寸预设','.board-size-trigger');await click('方形分享','.board-size-presets button');await click('应用尺寸');
  check('preset applies 1080 square',(await save()).layers.some(l=>l.artboard&&l.width===1080&&l.height===1080));await click('撤销');await save();
  const select=await js(`document.querySelector('[aria-label="当前画板"]').closest('.studio-select').dataset.value`);
  await js(`document.querySelector('[aria-label="当前画板"]').focus()`);await key('Down');
  check('keyboard opens unified dropdown',await js(`document.querySelector('[aria-label="当前画板"]').getAttribute('aria-expanded')==='true'`));await shot('dropdown-dark');await key('Escape');
  check('Escape closes dropdown without changing board',await js(`document.querySelector('[aria-label="当前画板"]').getAttribute('aria-expanded')==='false'&&document.querySelector('[aria-label="当前画板"]').closest('.studio-select').dataset.value===${JSON.stringify(select)}`));
  check('native dropdowns fully replaced',await js(`document.querySelectorAll('select').length===0`));
  await click('切换浅色主题');await click('尺寸预设','.board-size-trigger');await shot('size-popover-light');await click('取消','.board-dialog-actions button');await click('切换深色主题');
  w.setSize(940,640);await delay(250);await click('尺寸预设','.board-size-trigger');
  check('size popup stays within minimum window',await js(`(()=>{const r=document.querySelector('.board-size-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`));await shot('size-popover-compact');await click('取消','.board-dialog-actions button');
  w.setSize(1440,960);await delay(200);
  for(const [label,selector] of [['提示词工作台','.prompt-workbench'],['无限画布','.canvas-workspace'],['图像工具','.image-tools'],['素材库','.asset-library']]){
    await click(label);await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await shot('workspace-'+selector.slice(1));
    check(`${label} shares controls without horizontal overflow`,await js(`document.documentElement.scrollWidth<=innerWidth+1&&!document.querySelector('select')`));
  }
};
