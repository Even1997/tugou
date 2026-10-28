const defaults={language:'zh-CN',followSystemLanguage:false,theme:'dark',restoreProject:true,confirmClose:true,notifyTasks:true,sounds:false,zoom:100,grid:'dots',autoCheck:true,autoDownload:false,shortcuts:{}};
function languageFor(value,locale){if(!value.followSystemLanguage)return value.language;const s=String(locale).toLowerCase();return s.startsWith('zh')?(/tw|hk|hant/.test(s)?'zh-TW':'zh-CN'):s.startsWith('ja')?'ja':s.startsWith('ko')?'ko':'en';}
module.exports={defaults,languageFor};
