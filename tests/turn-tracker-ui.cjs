// Componentes reais em Chrome headless. Transporte/RPC/eventos de rede simulados.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'darkwest-tracker-'));
const index=read('dist/index.html');
const markup=index.slice(index.indexOf('      <section id="mesa-turn-tracker"'),index.indexOf('    <div id="ficha-home-slot"')).replace(/\s*<\/div>\s*$/,'');
const scripts=['dist/js/magiasUI.js','dist/js/mesaScreen.js','dist/js/turnTracker.js'].map(f=>read(f).replace(/^import .*;\r?\n/gm,'')).join('\n');
const test=async function(){
 const view='__VIEW__';
 const results=[],check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const clone=x=>JSON.parse(JSON.stringify(x));
 try{
  OS.$=id=>document.getElementById(id);
  const st=OS.activeMesaState;
  Object.assign(st,{mesaId:'room',isMestre:true,currentUserId:'gm'});
  st.mesaTokens=[{id:'p',owner_type:'player',owner_ref:'sheet',display_name:'Amélia',iniciativa:18,visible_to_players:true},
    {id:'c1',owner_type:'creature',owner_ref:'i1',display_name:'Inebriados #1',iniciativa:7,visible_to_players:true},
    {id:'c2',owner_type:'creature',owner_ref:'i2',display_name:'Inebriados #2',iniciativa:7,visible_to_players:false},
    {id:'jeb',owner_type:'creature',owner_ref:'ij',display_name:'Jeb Cale',iniciativa:14,visible_to_players:true}];
  st.sceneCreatures=[{instanceId:'i1',sourceType:'oficial',sourceId:'reserve',name:'Inebriados #1',data:{}},
   {instanceId:'i2',sourceType:'oficial',sourceId:'reserve',name:'Inebriados #2',data:{}},
   {instanceId:'ij',sourceType:'oficial',sourceId:'reserve-jeb',name:'Jeb Cale',data:{}}];
  st.npcsMesa=[{mesaNpcId:'reserve',sourceId:'inebriados'},{mesaNpcId:'reserve-jeb',sourceId:'jeb'}];
  OS.bestiaryCatalog.byId={inebriados:{category:'Criatura'},jeb:{category:'NPC'}};
  OS.loadOfficialBestiary=async()=>[];OS.loadMesaTokens=async()=>st.mesaTokens;
  OS.renderMesaSceneCards=()=>{};OS.setMesaRealtimeStatusUi=()=>{};
  let state=null,revision=0,mutations=0,lastArgs,failNext=false;
  const handlers=[];
  function snapshot(){
   let value=clone(state);
   if(value&&!st.isMestre){const current=value.ordem[value.turno_atual_idx]?.token_id;
    value.ordem=value.ordem.filter(x=>x.visible_to_players);value.turno_atual_idx=value.ordem.findIndex(x=>x.token_id===current);
    value.turno_oculto=value.turno_atual_idx<0;delete value.cascata_d20;delete value.cascata_total;
   }
   return {combate:value,revisao:revision};
  }
  const client={channel:()=>({on:function(type,config,fn){handlers.push({type,config,fn});return this;},subscribe:function(){return this;}}),
   rpc:async(name,args)=>{
    if(name==='obter_combate_publico')return {data:snapshot()};
    if(name!=='gerenciar_combate')throw Error(name);
    mutations++;lastArgs=args;
    if(failNext){failNext=false;return {error:{code:'40001',message:'Combate atualizado em outra sessão.'}};}
    if(args.p_acao==='iniciar'){
     state={id:'combat-a',ativo:true,versao:1,round:1,turno_atual_idx:0,cascata_d20:10,cascata_total:2,
      ordem:[{token_id:'p',owner_type:'player',name:'Amélia',iniciativa:18,visible_to_players:true,iniciativa_fonte:'ficha'},
       {token_id:'c1',owner_type:'creature',name:'Inebriados #1',iniciativa:12,visible_to_players:true,iniciativa_fonte:'cascata'},
       {token_id:'c2',owner_type:'creature',name:'Inebriados #2',iniciativa:11,visible_to_players:false,iniciativa_fonte:'cascata'}]};
    }else if(args.p_acao==='proximo'){state.turno_atual_idx++;state.versao++;}
    else if(args.p_acao==='adicionar'){state.ordem.push({token_id:args.p_token_id,owner_type:'creature',name:'Jeb Cale',iniciativa:0,visible_to_players:true,iniciativa_fonte:'fixa',entrou_no_meio:true});state.versao++;}
    else if(args.p_acao==='encerrar')state=null;
    revision++;return {data:snapshot()};
   }};
  OS.getSupabaseClient=()=>client;OS.bindTurnTrackerEvents();await OS.loadMesaCombat();
  await OS.openCombatSetup();
  check(OS.$('modal-setup-combate').open,'setup abre');
  check(document.querySelectorAll('.combat-include:checked').length===4,'todos em cena pré-selecionados');
  check(document.querySelector('[data-token-id="c1"] .combat-mode').value==='cascata','monstro oficial usa cascata');
  check(document.querySelector('[data-token-id="jeb"] .combat-mode').value==='ficha','Jeb classificado como NPC com ficha');
  if(view==='setup'){OS.$('result').textContent='PASS: preview visual do setup';return;}
  document.querySelector('[data-token-id="jeb"] .combat-include').checked=false;
  OS.$('form-setup-combate').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await tick();
  check(lastArgs.p_participantes.length===3&&!lastArgs.p_participantes.some(x=>x.token_id==='jeb'),'seleção enviada só com participantes marcados');
  check(!OS.$('mesa-turn-tracker').hidden&&!OS.$('modal-setup-combate').open,'tracker abre e setup fecha após confirmação');
  check(OS.$('mesa-tracker-round').textContent.includes('1'),'round 1 renderizado');
  check(document.querySelector('#mesa-tracker-order .is-current').dataset.tokenId==='p','turno atual destacado');
  check(OS.$('mesa-tracker-order').textContent.includes('🙈 Oculto'),'Mestre vê indicador de oculto');
  const rect=OS.$('mesa-turn-tracker').getBoundingClientRect(),map=OS.$('mesa-map-stage').getBoundingClientRect();
  check(rect.left>=map.left&&rect.top>=map.top,'posição inicial no topo esquerdo do mapa');
  OS.$('btn-tracker-minimize').click();check(OS.$('mesa-turn-tracker').hidden&&!OS.$('btn-mesa-combat-open').hidden,'minimiza com botão compacto disponível');
  await OS.loadMesaCombat();check(OS.$('mesa-turn-tracker').hidden,'refresh não desfaz minimização local');
  OS.$('btn-mesa-combat-open').click();check(!OS.$('mesa-turn-tracker').hidden,'botão compacto reabre');
  OS.$('btn-tracker-next').click();await tick();
  check(lastArgs.p_versao===1&&lastArgs.p_combate_id==='combat-a','avanço envia versão e identidade do combate');
  check(document.querySelector('#mesa-tracker-order .is-current').dataset.tokenId==='c1','avanço reflete resposta do servidor');
  failNext=true;OS.$('btn-tracker-next').click();await tick();await tick();
  check(OS.$('mesa-tracker-feedback').textContent.includes('outra sessão')&&st.combateAtivo.turno_atual_idx===1,'conflito mostra erro sem avançar localmente');
  OS.appendCombatJoinButton(OS.$('late-card'),st.mesaTokens[3]);
  document.querySelector('#late-card .combat-join').click();await tick();
  check(lastArgs.p_token_id==='jeb'&&OS.$('mesa-tracker-order').textContent.includes('Entrou nesta rodada'),'botão de entrada tardia envia token individual');
  const saved=clone(state);
  OS.$('btn-tracker-end').click();check(OS.$('modal-end-combate').open,'encerramento exige modal');
  OS.$('btn-combat-end-cancel').click();check(!OS.$('modal-end-combate').open&&st.combateAtivo,'cancelar preserva combate');
  OS.$('btn-tracker-end').click();OS.$('btn-combat-end-confirm').click();await tick();
  check(!st.combateAtivo&&OS.$('mesa-turn-tracker').hidden&&OS.$('btn-mesa-combat-open').hidden,'encerrar fecha tracker e botão');

  st.isMestre=false;st.currentUserId='member';OS.resetMesaCombat();state=saved;state.turno_atual_idx=2;revision++;
  OS.subscribeMesaRealtimeChannel('room');
  const signal=handlers.find(x=>x.config.table==='mesa_combate_sinais');
  check(signal&&signal.config.filter==='mesa_id=eq.room','canal da mesa escuta sinal seguro');
  signal.fn({new:{mesa_id:'room',revisao:revision}});await tick();await tick();
  check(!OS.$('mesa-turn-tracker').hidden&&OS.$('mesa-tracker-order').children.length===3,'evento abre tracker do jogador só com visíveis');
  check(!OS.$('mesa-tracker-order').textContent.includes('Inebriados #2')&&!document.querySelector('#mesa-tracker-order .is-current'),'turno oculto não revela entidade nem destaca outra');
  check(OS.$('mesa-tracker-current').textContent==='Aguardando o Mestre','mensagem neutra para turno oculto');
  check(OS.$('btn-tracker-end').hidden&&OS.$('mesa-tracker-footer').hidden,'controles exclusivos do Mestre ausentes');
  if(view==='player'){OS.$('result').textContent='PASS: preview visual do jogador durante turno oculto';return;}
  const calls=mutations;await OS.runMesaCombatAction('proximo');check(mutations===calls,'ação do jogador bloqueada também no frontend');
  const newer=clone(st.combateAtivo);OS.acceptMesaCombatSnapshot('room',{revisao:revision-1,combate:null});
  check(st.combateAtivo.id===newer.id,'resposta antiga não fecha combate atual');
  state=null;revision++;signal.fn({new:{mesa_id:'room',revisao:revision}});await tick();await tick();
  check(OS.$('mesa-turn-tracker').hidden&&!st.combateAtivo,'evento de fim fecha tracker do jogador');
  // Estado final para captura visual do Mestre; não acessa o banco.
  st.isMestre=true;state=saved;state.round=2;state.turno_atual_idx=0;revision++;await OS.loadMesaCombat();
  document.getElementById('result').textContent='PASS: '+results.length+' verificações | '+results.join(' | ');
 }catch(e){document.getElementById('result').textContent='FAIL: '+e.stack;}
};
const html='<!doctype html><meta charset="utf-8"><style>'+read('dist/style.css')+'</style><style>body{padding:20px;background:#17120f}#result{white-space:pre-wrap;margin-left:440px;color:#e6c69f;max-width:680px;font:13px/1.6 monospace}#mesa-map-stage{position:absolute;left:16px;top:70px;width:400px;height:760px;background:repeating-linear-gradient(0deg,#261d16 0 39px,#392c21 40px)}#late-card{position:fixed;left:30px;bottom:20px}</style>'+
 '<button id="btn-mesa-start-combat">⚔️ Iniciar Combate</button><button id="btn-mesa-combat-open" hidden>⚔️</button><div id="mesa-map-stage"></div><div id="late-card"></div><pre id="result">Executando…</pre>'+markup+
 '<script>var OS={};'+scripts+'\n('+test.toString().replace('__VIEW__',['setup','player'].includes(process.argv[2])?process.argv[2]:'test')+')();</script>';
const file=path.join(temp,'tracker.html');fs.writeFileSync(file,html);
const screenshot=path.join(temp,'tracker.png');
const output=execFileSync(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
 ['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(temp,'profile'),
 '--window-size=1200,900','--virtual-time-budget=5000','--screenshot='+screenshot,'--dump-dom','file:///'+file.replaceAll('\\','/')],
 {timeout:45000,maxBuffer:8*1024*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']});
fs.writeFileSync(path.join(temp,'rendered.html'),output);
const result=output.match(/<pre\b[^>]*\bid="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
console.log(result||'FAIL: resultado ausente');console.log('Screenshot: '+screenshot);
if(!result?.startsWith('PASS:'))process.exitCode=1;
