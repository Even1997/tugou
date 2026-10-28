const repertoire=require('./font-repertoire.json');
const templates={common:repertoire.characters,sample:[...repertoire.characters].slice(0,100).join('')+'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',latin:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'};
const group=c=>/[\u3400-\u9fff]/u.test(c)?'chinese':/[A-Za-z]/.test(c)?'latin':'other';
function batches(characters){const chars=[...characters];return Array.from({length:Math.ceil(chars.length/256)},(_,i)=>({page:i,start:i*256+1,end:Math.min(chars.length,(i+1)*256),characters:chars.slice(i*256,(i+1)*256).join('')}));}
function prompt(name,batch){const chars=[...batch.characters],lines=Array.from({length:Math.ceil(chars.length/16)},(_,i)=>chars.slice(i*16,(i+1)*16).join(' '));return `为「${name}」生成第 ${batch.page+1} 批字体图集，延续已确认的参考字风格。\n9:16 竖版，1440×2560，严格等分 16 列×16 行。纯白背景、纯黑字形；不画网格、编号、标题、阴影或装饰。每格一字，字形居中，四周留白，最长边约占格宽的 75%。\n从左到右、从上到下，依次绘制以下 ${chars.length} 个字符，不遗漏、不重复、不换序；最后未用格留白。\n${lines.join('\n')}`;}
module.exports={templates,group,batches,prompt};
