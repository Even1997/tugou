const {app}=require('electron'),path=require('node:path'),{randomUUID}=require('node:crypto');
process.env.TUGOU_DATA_DIR=require('./qa-paths.cjs').path("local-tools-regression-")+randomUUID();
process.env.TUGOU_BUILD_DIR=path.resolve(__dirname,'../test-results/local-tools-build');
app.on('browser-window-created',(_,window)=>{
  window.show=()=>{};window.focus=()=>{};window.webContents.setBackgroundThrottling(false);
});
require('./ui-actions-desktop.cjs');
