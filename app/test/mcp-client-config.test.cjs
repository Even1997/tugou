const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {clientConfig,clientFormats}=require('../core/mcp-client-config.cjs');
for(const root of ['C:\\中文 路径\\土狗','/Applications/土狗 Studio.app']){
  test(`MCP formats preserve paths, ordered arguments and environment: ${root}`,()=>{
    const config=clientConfig(path.join(root,'Tugou.exe'),path.join(root,'resources/app.asar'),path.join(root,'user data'));
    const formats=clientFormats({...config,apiKey:'must-not-leak',token:'must-not-leak'});
    assert.deepEqual(JSON.parse(formats.json).mcpServers.tugou,config);
    assert.deepEqual(JSON.parse(formats.vscode).servers.tugou,{type:'stdio',...config});
    assert.equal(JSON.parse(formats.codex.match(/^command = (.+)$/m)[1]),config.command);
    assert.deepEqual(JSON.parse(formats.codex.match(/^args = (.+)$/m)[1]),config.args);
    assert.equal(config.args[1],'--session');assert.equal(config.env.ELECTRON_RUN_AS_NODE,'1');
    assert.ok(!JSON.stringify(formats).includes('must-not-leak'));
  });
}
