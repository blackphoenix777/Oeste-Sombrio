// Navegador isolado para testes locais; aguarda conclusão real de decodificações de imagens.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function run(file,temp,screenshot){
 const profile=path.join(temp,'profile'),portfile=path.join(profile,'DevToolsActivePort');
 const proc=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1200,1100','about:blank'],{stdio:'ignore',windowsHide:true});
 let socket;
 try{
  const deadline=Date.now()+30000;while(!fs.existsSync(portfile)){if(Date.now()>deadline)throw Error('Chrome não iniciou');await delay(100);}
  const port=fs.readFileSync(portfile,'utf8').split('\n')[0];
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Page.navigate',{url:/^https?:/.test(file)?file:pathToFileURL(file).href});
  let result='';const until=Date.now()+40000;
  while(Date.now()<until){const r=await send('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent || ""',returnByValue:true});result=r.result?.value||'';if(/^(PASS|FAIL):/.test(result))break;await delay(100);}
  const capture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(screenshot,Buffer.from(capture.data,'base64'));
  await send('Browser.close').catch(()=>{});return result;
 } finally {if(socket)socket.close();proc.kill();}
};
