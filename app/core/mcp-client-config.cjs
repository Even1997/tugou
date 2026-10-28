const path=require('node:path');
function clientConfig(executable,appPath,profile){
  return {command:executable,args:[path.join(appPath,'core','mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{ELECTRON_RUN_AS_NODE:'1'}};
}
function clientFormats(config){
  const {command,args,env}=config;
  return {
    json:JSON.stringify({mcpServers:{tugou:{command,args,env}}},null,2),
    vscode:JSON.stringify({servers:{tugou:{type:'stdio',command,args,env}}},null,2),
    codex:`[mcp_servers.tugou]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n\n[mcp_servers.tugou.env]\nELECTRON_RUN_AS_NODE = "1"\n`,
  };
}
module.exports={clientConfig,clientFormats};
