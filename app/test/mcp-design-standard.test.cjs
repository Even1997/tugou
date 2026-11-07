const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const appRoot=path.resolve(__dirname,'..'),uri='tugou://design/ppt';
async function fixture(t){
  const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'tugou-design-mcp-'));
  t.after(async()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('tugou-design-mcp-'));await fs.rm(root,{recursive:true,force:true});});
  return root;
}
async function connect(t,session,script=path.join(appRoot,'core/mcp.cjs')){
  const transport=new StdioClientTransport({command:process.execPath,args:[script,'--session',session],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:path.join(appRoot,'node_modules')},stderr:'pipe'});
  const client=new Client({name:'design-standard-test',version:'1'});let stderr='';transport.stderr.on('data',data=>{stderr+=data;});
  t.after(async()=>{await client.close();assert.equal(stderr,'');});await client.connect(transport);return client;
}
test('stdio clients discover and read one design standard through resource, tool and PPT prompt without a desktop session',async t=>{
  const root=await fixture(t),client=await connect(t,path.join(root,'missing-session.json'));
  const expected=await fs.readFile(path.join(appRoot,'core/ppt-design-standard.md'),'utf8');
  assert.match(client.getInstructions(),/tugou:\/\/design\/ppt/);assert.match(client.getInstructions(),/get_design_standard/);
  assert.match(client.getInstructions(),/询问用户要生成哪些视觉效果图/);assert.match(client.getInstructions(),/等待用户回答/);assert.match(client.getInstructions(),/等待用户确认视觉方向/);
  assert.match(client.getInstructions(),/不是跳过流程的授权/);assert.match(client.getInstructions(),/局部编辑不重新启动选型/);
  assert.match(client.getInstructions(),/整理整体大纲与逐页内容/);assert.match(client.getInstructions(),/ppt\.content\.update/);assert.match(client.getInstructions(),/请用户确认内容/);assert.match(client.getInstructions(),/CONTENT_CONFLICT/);
  assert.match(client.getInstructions(),/大纲未确认前只改大纲/);assert.match(client.getInstructions(),/大纲确认后询问用户“先做视觉设计，还是先写讲稿？”，等待用户回答/);
  assert.match(client.getInstructions(),/选择讲稿：[\s\S]*?ppt\.slide\.update\.notes[\s\S]*?不改页面元素、不清除 content\.text、不触发生图/);assert.match(client.getInstructions(),/不自动执行未选择的工作/);
  const tools=(await client.listTools()).tools;assert.equal(tools.length,8);
  const tool=tools.find(x=>x.name==='get_design_standard');assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.openWorldHint,false);assert.equal(tool.inputSchema.additionalProperties,false);
  const resources=(await client.listResources()).resources;assert.equal(resources.length,3);assert.equal(resources.find(x=>x.uri===uri).mimeType,'text/markdown');
  const resource=(await client.readResource({uri})).contents[0];assert.equal(resource.uri,uri);assert.equal(resource.text,expected);
  const viaTool=await client.callTool({name:'get_design_standard',arguments:{}});assert.ok(!viaTool.isError);assert.equal(viaTool.content[0].text,expected);
  const prompts=(await client.listPrompts()).prompts;assert.equal(prompts.length,4);assert.ok(prompts.find(x=>x.name==='ppt').description.length<150);
  const prompt=(await client.getPrompt({name:'ppt'})).messages[0].content.text;assert.ok(prompt.startsWith(expected));assert.match(prompt,/ppt\.export/);assert.match(prompt,/requestId/);assert.match(prompt,/ppt\.preview[\s\S]*?image\/png/);assert.match(prompt,/不能用元素数据替代截图验收/);
  assert.match((await client.getPrompt({name:'generate'})).messages[0].content.text,/requestId/);
  assert.doesNotMatch(expected,/unslop|heydamir|尚未注入|本轮仍需/i);
  assert.equal((expected.match(/^## [1-8]\./gm)||[]).length,8);
  assert.match(expected,/确认视觉范围，等待用户回答/);assert.match(expected,/确认视觉方向，等待用户选择/);
  assert.match(expected,/不等于允许跳过视觉确认/);
  assert.match(expected,/获取 PPT 结果与截图验收/);assert.match(expected,/截图失败或未就绪时不能宣称视觉验收通过/);assert.match(expected,/用户只需要大纲或讲稿时/);assert.match(expected,/先写大纲，等待用户确认/);assert.match(expected,/大纲确认后，让用户选择下一步/);assert.match(expected,/选择讲稿：[\s\S]*?不清除 `content\.text`[\s\S]*?不为讲稿触发生图/);assert.match(expected,/保留已有讲稿，不因制作画面重写或清空讲稿/);assert.doesNotMatch(expected,/或授权直接完成时/);
  await assert.rejects(client.readResource({uri:'file:///arbitrary.md'}));await assert.rejects(client.readResource({uri:uri+'/../session'}));await assert.rejects(client.getPrompt({name:'unknown'}));
  const bad=await client.callTool({name:'get_design_standard',arguments:{path:'../secret'}});assert.equal(bad.isError,true);assert.equal(bad.structuredContent.error.code,'INVALID_ARGUMENT');
  const existing=await client.callTool({name:'get_state',arguments:{}});assert.equal(existing.structuredContent.error.code,'SESSION_NOT_ENABLED');
});
test('design reads bypass the bridge while existing resources, command discovery and tools still forward',async t=>{
  const root=await fixture(t),session=path.join(root,'session.json'),requests=[],token='d'.repeat(64);
  const server=net.createServer(socket=>socket.once('data',data=>{
    const request=JSON.parse(data);assert.equal(request.token,token);requests.push(request);
    const value=request.method==='get_state'?{revision:'fixture-r1',projectId:'fixture-project'}:request.method==='list_commands'?{commands:require('../core/automation-commands.cjs').listCommands(request.args.domain)}:{forwarded:request.args.command};
    socket.end(JSON.stringify({ok:true,value})+'\n');
  }));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  await fs.writeFile(session,JSON.stringify({version:1,port:server.address().port,token}));const client=await connect(t,session);
  await client.readResource({uri});await client.callTool({name:'get_design_standard',arguments:{}});await client.getPrompt({name:'ppt'});assert.equal(requests.length,0);
  const stateResource=JSON.parse((await client.readResource({uri:'tugou://session'})).contents[0].text);assert.equal(stateResource.revision,'fixture-r1');
  const workflow=stateResource.pptDesignWorkflow;assert.equal(workflow.standardUri,uri);assert.match(workflow.instructions,/等待用户回答/);assert.match(workflow.instructions,/未确认前不制作正式 PPT/);
  assert.ok(client.getInstructions().startsWith(workflow.instructions));assert.match(workflow.instructions,/大纲确认后询问用户/);assert.match(workflow.instructions,/选择讲稿/);assert.match(workflow.instructions,/选择设计/);assert.match(workflow.instructions,/逐页调用 ppt\.preview 获取并查看真实 PNG 截图/);
  const commandResource=JSON.parse((await client.readResource({uri:'tugou://commands'})).contents[0].text);assert.equal(commandResource.commands.length,require('../core/automation-commands.cjs').listCommands().length);assert.deepEqual(commandResource.pptDesignWorkflow,workflow);
  const catalog=await client.callTool({name:'list_commands',arguments:{domain:'ppt'}});assert.equal(catalog.structuredContent.commands.length,24);
  assert.deepEqual(catalog.structuredContent.pptDesignWorkflow,workflow);assert.deepEqual(JSON.parse(catalog.content[0].text),catalog.structuredContent);
  const state=await client.callTool({name:'get_state',arguments:{}});assert.equal(state.structuredContent.projectId,'fixture-project');assert.deepEqual(state.structuredContent.pptDesignWorkflow,workflow);assert.deepEqual(JSON.parse(state.content[0].text),state.structuredContent);
  assert.equal((await client.callTool({name:'run_command',arguments:{command:'ppt.list',args:{}}})).structuredContent.forwarded,'ppt.list');assert.equal(requests.length,5);
  const other=await client.callTool({name:'list_commands',arguments:{domain:'asset'}});assert.ok(other.structuredContent.commands.length>0);assert.equal(other.structuredContent.pptDesignWorkflow,undefined);
});
test('bundled core serves the full standard without a repository docs directory',async t=>{
  const root=await fixture(t),core=path.join(root,'core');await fs.cp(path.join(appRoot,'core'),core,{recursive:true});
  assert.ok(require('../electron-builder.cjs').files.includes('core/**/*'));await assert.rejects(fs.access(path.join(root,'docs')));
  const client=await connect(t,path.join(root,'missing-session.json'),path.join(core,'mcp.cjs'));
  assert.equal((await client.readResource({uri})).contents[0].text,await fs.readFile(path.join(appRoot,'core/ppt-design-standard.md'),'utf8'));
});
