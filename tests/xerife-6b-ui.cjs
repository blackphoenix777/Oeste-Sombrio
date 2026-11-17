// Chrome e WebView2 usam o mesmo fixture sintético e os módulos reais. Nenhum Supabase remoto.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=path.resolve(__dirname,'..');
const test=async function(){
 const results=[],check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
 const tick=()=>new Promise(r=>setTimeout(r,0)),clone=x=>JSON.parse(JSON.stringify(x));
 try{
  for(const name of ['config','state','ui','dice','modal','cylinder','skills','combat','storage','equipment','equipCatalog','gameData','catalogModal','inventoryUI','magiasUI','characterManager','homeScreen','mesaScreen','mesaMaps','turnTracker','mesaTokenStatus','mesaXerife6B','authSession'])await import('/js/'+name+'.js');
  const OS=window.OS,st=OS.activeMesaState;
  OS.$=id=>document.getElementById(id);OS.scheduleSave=()=>{};
  OS.bindModalEvents();
  Object.assign(st,{mesaId:'room',currentUserId:'gm',isMestre:true,activeMapId:'map',sceneCreatures:[{instanceId:'one',name:'Bandido',data:{nome:'Bandido','config-6b':'2d6',equipamentos:'Revólver — Dano d6'}},{instanceId:'two',name:'Bandido #2',data:{nome:'Bandido #2','config-6b':'2d6'}}]});
  document.body.classList.add('mesa-fullscreen-active');OS.$('mesa-screen').style.display='';
  const rows={aberto:{versao:0,dados:[6,6,6,6,6,6],resultados:[],usados:[],composicao_pendente:false,fichas_invalidas:0},secreto:{versao:0,dados:[12,12],resultados:[],usados:[],composicao_pendente:false,fichas_invalidas:0}};
  const calls=[],channels=[],auth=[];let missing=false,hold=null;
  const client={rpc:async(name,args)=>{
   calls.push({name,args:clone(args)});
   if(missing)return {error:{code:'PGRST202'}};
   if(name==='presenca_6b_xerife')return {data:null};
   const type=args.p_tipo;
   if(type==='secreto'&&!st.isMestre)return {error:{code:'42501'}};
   if(name==='rolar_6b_xerife'){
    if(!st.isMestre)return {error:{code:'42501'}};
    if(args.p_versao!==rows[type].versao)return {error:{code:'40001'}};
    if(rows[type].versao)return {error:{code:'0A000'}};
    rows[type].resultados=rows[type].dados.map(()=>type==='secreto'?11:2);rows[type].usados=[];rows[type].versao++;
   }else if(name==='consumir_6b_xerife'){
    if(!st.isMestre)return {error:{code:'42501'}};
    if(!rows[type].versao)return {error:{code:'55000'}};
    if(args.p_versao!==rows[type].versao)return {error:{code:'40001'}};
    const idxs=args.p_indices||[];
    if(!idxs.length||idxs.some(i=>i<0||i>=rows[type].dados.length||rows[type].usados.includes(i)))return {error:{code:'22023'}};
    rows[type].usados=Array.from(new Set(rows[type].usados.concat(idxs))).sort((a,b)=>a-b);
    rows[type].versao++;
   }else if(name==='renovar_6b_xerife'){
    if(!st.isMestre)return {error:{code:'42501'}};
    if(!rows[type].versao||rows[type].usados.length<rows[type].dados.length)return {error:{code:'55000'}};
    if(args.p_versao!==rows[type].versao)return {error:{code:'40001'}};
    rows[type].resultados=rows[type].dados.map(()=>type==='secreto'?9:4);rows[type].usados=[];rows[type].composicao_pendente=false;rows[type].versao++;
   }
   const response={data:clone(rows[type])};
   if(type==='secreto'&&hold)await hold;
   return response;
  },auth:{getSession:async()=>({data:{session:{access_token:'synthetic-test-token'}}})},realtime:{setAuth:async()=>{auth.push('jwt');}},channel(name){const c={name,filters:[],on(event,filter,cb){c.filters.push({filter,cb});return c;},subscribe(cb){auth.push('subscribe');c.status=cb;return c;}};channels.push(c);return c;},removeChannel:async()=>{}};
  OS.getSupabaseClient=()=>client;
  const storageBefore=JSON.stringify(localStorage),serializedBefore=JSON.stringify(st);
  await OS.initXerife6B();
  check(document.querySelectorAll('.mesa-xerife-panel').length===2,'Xerife recebe dois painéis distintos');
  const secret=document.querySelector('[data-pool="secreto"]'),open=document.querySelector('[data-pool="aberto"]');
  check(!secret.open&&!open.open,'painéis começam recolhidos');open.querySelector('summary').click();secret.querySelector('summary').click();
  check(open.open&&secret.open,'recolhimento nativo details/summary funciona');
  check(open.textContent.includes('6 × d6')&&secret.textContent.includes('2 × d12'),'composição autorizada aparece em cada conjunto');
  check(auth[0]==='jwt'&&auth[1]==='subscribe','JWT definido antes da inscrição Realtime');
  check(channels.every(c=>c.filters.every(f=>f.filter.table==='mesa_6b_aberto'&&['INSERT','UPDATE'].includes(f.filter.event))),'cliente inscreve somente INSERT/UPDATE do conjunto aberto');
  check(await OS.rollXerife6B('aberto'),'rolagem aberta usa RPC');
  check(open.querySelectorAll('.scene-chamber-pill').length===6&&open.textContent.includes('d6: 2'),'resultados confirmados pelo servidor são renderizados');
  check(await OS.rollXerife6B('secreto'),'rolagem secreta usa RPC exclusiva');
  check(!open.textContent.includes('11')&&secret.textContent.includes('d12: 11'),'resultados secretos não se misturam ao aberto');
  check(JSON.stringify(localStorage)===storageBefore&&JSON.stringify(st)===serializedBefore,'resultados não entram em localStorage nem na serialização da mesa');
  const one=OS.getXerife6BForNpc('one'),two=OS.getXerife6BForNpc('two');
  check(one.versao===two.versao&&JSON.stringify(one.resultados)===JSON.stringify(two.resultados),'dois NPCs consultam o mesmo conjunto compartilhado');
  one.resultados[0]=99;check(OS.getXerife6BForNpc('two').resultados[0]===2,'consumidor não consegue mutar a projeção em memória');

  // Seleção, consumo parcial/total e renovação nos painéis
  const openBtn=(txt)=>[...open.querySelectorAll('.mesa-xerife-actions button')].find(b=>b.textContent.startsWith(txt));
  const secBtn=(txt)=>[...secret.querySelectorAll('.mesa-xerife-actions button')].find(b=>b.textContent.startsWith(txt));
  check(openBtn('Consumir').disabled&&openBtn('Renovar').disabled,'Consumir exige seleção e Renovar fica bloqueado antes de zerar');
  open.querySelectorAll('.scene-chamber-pill')[0].click();
  check(!openBtn('Consumir').disabled&&openBtn('Consumir').textContent==='Consumir (1)','clicar no dado habilita consumo selecionado');
  openBtn('Consumir').click();await tick();await tick();
  check(open.querySelectorAll('.scene-chamber-pill.is-used').length===1&&openBtn('Renovar').disabled,'consumo parcial marca dado e mantém Renovar bloqueado');

  // Ataque em popup de NPC abre #chamber-modal com 6B Aberto do Xerife
  OS.openOrFocusCreaturePopup({from:'scene',instanceId:'one'});
  await tick();
  document.querySelector('[data-target-id="one"] [data-action="roll-attack"]').click();
  const chamberModal=OS.$('chamber-modal');
  check(chamberModal.classList.contains('open')&&chamberModal.textContent.includes('6B do Xerife'),'rolar ataque de NPC abre seleção do 6B Aberto igual aos players');
  const modalPills=chamberModal.querySelectorAll('#chamber-grid .chamber-pill');
  check(modalPills.length===6&&modalPills[0].disabled&&!modalPills[1].disabled,'modal reflete dados já consumidos e disponíveis do 6B Aberto');
  modalPills[1].click();modalPills[2].click();
  OS.$('chamber-confirm').click();await tick();await tick();
  check(!chamberModal.classList.contains('open')&&open.querySelectorAll('.scene-chamber-pill.is-used').length===3,'confirmar ataque do NPC consome os dados escolhidos no 6B Aberto');
  check(st.sceneCreatures[0].data.sceneAttackRolls&&Object.values(st.sceneCreatures[0].data.sceneAttackRolls)[0].text.includes('6B Xerife(+4)'),'ataque do NPC soma bônus dos dados escolhidos no 6B Aberto');
  OS.closeRollModal();OS.closeGmPopup('scene:one');

  // Gastar todos de uma vez no aberto (em combate ativo exibe aviso da regra oficial) e no secreto -> libera Renovar sem fadiga
  st.combateAtivo={ativo:true};
  openBtn('Gastar todos').click();await tick();await tick();
  check(open.querySelectorAll('.scene-chamber-pill.is-used').length===6&&!openBtn('Renovar').disabled,'Gastar todos zera o 6B Aberto e libera Renovar');
  check(open.textContent.includes('inimigos que ainda não agiram perdem o turno'),'aviso de regra oficial exibido ao zerar 6B Aberto em combate');
  st.combateAtivo=null;
  openBtn('Renovar').click();await tick();await tick();
  check(open.querySelectorAll('.scene-chamber-pill.is-used').length===0&&open.textContent.includes('d6: 4'),'Renovar gera nova rolagem aberta e limpa usados');

  // Ficha completa em edição pelo Mestre (freeEdit + gmEditingSheet) também seleciona do 6B Aberto
  OS.setFreeEditMode(true);
  st.gmEditingSheet={mode:'scene',instanceId:'one'};
  const dummyOut=document.createElement('span');
  OS.openChamberSelectionModal(8,['d6'],[5],null,dummyOut,'Percepção','Teste de Percepção');
  check(OS.$('chamber-modal').classList.contains('open')&&OS.$('chamber-modal').textContent.includes('6B Aberto do Xerife'),'ficha completa do NPC usa seleção do 6B Aberto do Xerife');
  OS.$('chamber-grid').querySelectorAll('.chamber-pill')[0].click();
  await OS.applyCylinderBonuses();await tick();
  check(OS.lastSkillRollContext&&OS.lastSkillRollContext.bonus===4&&OS.lastSkillRollContext.total===12&&dummyOut.textContent.includes('12'),'ficha completa soma dado consumido do 6B Aberto ao resultado final');
  OS.closeChamberModal();
  st.gmEditingSheet=null;OS.setFreeEditMode(false);

  secBtn('Gastar todos').click();await tick();await tick();
  check(!secBtn('Renovar').disabled,'Gastar todos no 6B Secreto libera Renovar');
  secBtn('Renovar').click();await tick();await tick();
  check(secret.querySelectorAll('.scene-chamber-pill.is-used').length===0&&secret.textContent.includes('d12: 9'),'Renovar secreto gera nova rolagem privada');

  rows.aberto.composicao_pendente=true;channels[0].filters[0].cb();await tick();await tick();
  check(open.textContent.includes('conjunto atual foi preservado')&&open.textContent.includes('d6: 4'),'evento Realtime recarrega sem substituir resultados por composição nova');
  OS.clearXerife6B();await OS.initXerife6B();
  check(document.querySelector('[data-pool="aberto"]').textContent.includes('d6: 4'),'reconexão recarrega o estado autoritativo');
  let release;hold=new Promise(r=>release=r);const pending=OS.refreshXerife6B();await tick();
  const readingCalls=calls.length;check(!(await OS.rollXerife6B('aberto'))&&calls.length===readingCalls,'sincronização em andamento bloqueia mutação concorrente no cliente');
  st.isMestre=false;st.currentUserId='player';st.playerFichaId='sheet';
  await OS.initXerife6B();hold=null;release();await pending;
  check(!document.querySelector('[data-pool="secreto"]')&&!document.getElementById('mesa-xerife-pools').textContent.includes('9'),'resposta secreta atrasada não aparece após troca de identidade');
  const count=calls.length;check(!(await OS.rollXerife6B('secreto'))&&!(await OS.consumeXerife6B('secreto',[0]))&&!(await OS.renewXerife6B('secreto'))&&calls.length===count,'jogador não envia operação secreta');
  check(calls.slice(count-2).every(c=>c.args.p_tipo!=='secreto'),'sessão de jogador consulta somente aberto');
  check(!OS.getXerife6BForNpc('one'),'jogador não acessa a projeção de NPC');
  const presence=calls.find(c=>c.name==='presenca_6b_xerife'&&!c.args.p_sair);
  check(presence.args.p_ficha==='sheet'&&!('p_usuario' in presence.args),'presença informa ficha; identidade é derivada do JWT no servidor');
  missing=true;await OS.refreshXerife6B();
  check(document.getElementById('mesa-xerife-pools').textContent.includes('indisponível')&&!document.querySelector('.mesa-xerife-pools .scene-chamber-pill'),'migração ausente falha fechada e limpa resultados antigos');
  OS.clearXerife6B();check(!document.getElementById('mesa-xerife-pools'),'saída limpa DOM e estado secreto');
  missing=false;st.isMestre=true;st.currentUserId='gm';await OS.initXerife6B();
  OS.showLoginScreen=()=>{};OS.clearAuthSession();check(!document.getElementById('mesa-xerife-pools'),'logout elimina dados e timers dos conjuntos');
  Object.assign(st,{mesaId:'room',currentUserId:'gm',isMestre:true});await OS.initXerife6B();
  for(const p of document.querySelectorAll('.mesa-xerife-panel'))p.open=true;
  OS.bindMesaSidebarResize();OS.switchMesaSidebarTab('fichas');
  const handle=OS.$('mesa-sidebar-resizer');handle.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,250));
  check(OS.$('mesa-sidebar-feed').getBoundingClientRect().width===330&&document.querySelector('.mesa-xerife-pools').getBoundingClientRect().width<=330,'painéis cabem na lateral redimensionável MESA-01');
  document.getElementById('result').textContent='PASS: '+results.length+' verificações\n'+results.join('\n');
 }catch(e){document.getElementById('result').textContent='FAIL: '+e.stack+'\nPASS anteriores: '+results.join(' | ');}
};
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<pre id="result" style="position:fixed;left:0;top:0;z-index:99999;max-width:65vw;max-height:60vh;overflow:auto;background:#17120f;color:white;font:12px monospace;white-space:pre-wrap">Executando…</pre><script type="module">('+test.toString()+')();</script></body>');
module.exports={html};
if(require.main===module){
 if(process.argv[2]==='--emit'){fs.writeFileSync(path.join(process.argv[3],'index.html'),html);process.exit(0);}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'darkwest-xerife-p02-'));
 const server=http.createServer((req,res)=>{if(req.url==='/test'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}const file=path.resolve(root,'dist','.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1',async()=>{try{const result=await require('./browser-harness.cjs')('http://127.0.0.1:'+server.address().port+'/test',temp,path.join(temp,'xerife.png'));console.log(result);fs.writeFileSync(path.join(root,'tests/artifacts/xerife-6b-ui.txt'),result);console.log('Screenshot: '+path.join(temp,'xerife.png'));if(!result.startsWith('PASS:'))process.exitCode=1;}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});
}
