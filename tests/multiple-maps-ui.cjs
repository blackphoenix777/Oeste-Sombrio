const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'darkwest-maps-'));
const index=read('dist/index.html'),start=index.indexOf('          <section id="mesa-map-stage"');
const stage=index.slice(start,index.indexOf('        </main>',start));
const scripts=['dist/js/mesaScreen.js','dist/js/mesaMaps.js'].map(f=>read(f).replace(/^import .*;\r?\n/gm,'')).join('\n');
const test=async function(){
 const results=[],check=(ok,label)=>{if(!ok)throw Error(label);results.push(label); document.getElementById('result').textContent='RUNNING: '+results.length+' | '+label;};
 const tick=()=>new Promise(r=>setTimeout(r,0)),clone=x=>JSON.parse(JSON.stringify(x));
 try{
  OS.$=id=>document.getElementById(id);
  const st=OS.activeMesaState,room='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const maps=[1,2,3].map(n=>({id:'map'+n,slot:n,nome:['Taverna','Subterrâneo','Deserto'][n-1],url:room+'/slot_'+n+'.png?t=1',storage_path:room+'/slot_'+n+'.png',grid_cols:n===2?32:20}));
  let flag='map1',revision=1,mutations=0,removals=0,lists=0,queries=[],uploads=[],defer=null;
  const blobs=new Map();
  for(let n=1;n<=3;n++){
   const c=document.createElement('canvas');c.width=1000;c.height=700;const ctx=c.getContext('2d');ctx.fillStyle=['#835b35','#383853','#987844'][n-1];ctx.fillRect(0,0,1000,700);ctx.font='80px serif';ctx.fillStyle='#ffe5b0';ctx.fillText(maps[n-1].nome,90,180);
   blobs.set(maps[n-1].storage_path,await new Promise(resolve=>c.toBlob(resolve,'image/png')));
  }
  const tokens=maps.map((m,n)=>({id:'t'+n,mesa_id:room,mapa_id:m.id,owner_type:'creature',owner_ref:'i'+n,display_name:'Monstro '+n,grid_x:2,grid_y:2,iniciativa:n+8,visible_to_players:true}));
  const scene=tokens.map(t=>({instanceId:t.owner_ref,name:t.display_name,data:{iniciativa:t.iniciativa}}));
  const snapshot=()=>({mapa:clone(maps.find(m=>m.id===flag)),tokens:tokens.filter(t=>t.mapa_id===flag).map(t=>({...clone(t),token_id:t.id})),revisao:revision});
  const handlers=[];
  const client={from(table){const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},single(){return q;},then(resolve){queries.push({table,...filters});resolve({data:table==='mesas'?{mapas:clone(maps),mapa_ativo_jogadores_id:flag}:clone(tokens.filter(t=>Object.entries(filters).every(([k,v])=>t[k]===v)))});}};return q;},
   rpc:async(name,args)=>{
    if(name==='obter_mapa_publico'){if(defer){const d=defer;defer=null;return await d;}return {data:snapshot()};}
    if(name!=='gerenciar_mapas')throw Error('RPC inesperada '+name);
    mutations++;let map=maps.find(m=>m.id===args.p_mapa_id),id=args.p_mapa_id;
    if(args.p_acao==='adicionar'){if(maps.length>=4)return {error:{message:'Limite de 4'}};id='map4';maps.push({id,slot:4,nome:'Mapa 4',url:null,grid_cols:24});}
    else if(args.p_acao==='editar')Object.assign(map,args.p_dados);
    else if(args.p_acao==='flamula'){flag=id;revision++;}
    else if(args.p_acao==='excluir'){maps.splice(maps.indexOf(map),1);if(flag===id)flag=maps[0].id;}
    return {data:{mapas:clone(maps),mapa_ativo_jogadores_id:flag,mapa_id:id}};
   },
   storage:{from(){return {download:async key=>blobs.has(key)?{data:blobs.get(key)}:{error:{message:'Arquivo ausente'}},
    upload:async(key,file,opts)=>{uploads.push({key,opts});blobs.set(key,file);return {data:{path:key}};},
    list:async()=>{lists++;return {data:[]};},remove:async()=>{removals++;return {data:[]};}};}},
   channel(){return {on(type,filter,fn){handlers.push({filter,fn});return this;},subscribe(){return this;}}},removeChannel(){}};
  OS.getSupabaseClient=()=>client;OS.renderMesaPlayersCards=()=>{};OS.loadMesaCombat=async()=>{};OS.renderMesaSceneCards=()=>{};
  Object.assign(st,{mesaId:room,isMestre:true,currentUserId:'gm',sceneCreatures:clone(scene),mapas:clone(maps),playerMapId:flag});
  OS.bindMapCameraEvents();OS.bindMesaMapEvents();
  await OS.loadMesaMapView();
  check(st.activeMapId==='map1'&&st.gridCols===20&&st.mesaTokens.length===1&&st.mesaTokens[0].id==='t0','Mestre abre Mapa 1 com sua grade/token');
  check(!OS.$('mesa-map-tabs').hidden&&document.querySelectorAll('.mesa-map-tab').length===3,'três abas do Mestre renderizadas');
  check(st.mapaUrl.startsWith('blob:')&&OS.$('mesa-map-image').naturalWidth===1000,'imagem privada carregada por download autenticado/blob');
  const image1=st.mapaUrl;
  OS.mapCamera.zoom=2;OS.mapCamera.panX=-100;OS.mapCamera.panY=50;OS.applyMapCamera();
  await OS.changeMesaMap('map2');
  check(st.gridCols===32&&st.mesaTokens.length===1&&st.mesaTokens[0].id==='t1'&&st.mapaUrl!==image1,'troca local restaura imagem, grade e token exclusivos do Mapa 2');
  check(flag==='map1'&&mutations===0,'navegar abas não altera flâmula nem banco');
  await OS.reconcileSceneCreaturesWithTokens();check(st.sceneCreatures.length===3,'reconciliação preserva criaturas de outros mapas');
  await OS.changeMesaMap('map1');check(OS.mapCamera.zoom===2&&OS.mapCamera.panX===-100&&OS.mapCamera.panY===50,'câmera do Mestre restaurada por mapa');
  await OS.setMesaGridCols(22);await OS.changeMesaMap('map2');
  check(st.gridCols===32&&maps[0].grid_cols===22,'editar grade de Mapa 1 preserva Mapa 2');
  check(queries.filter(q=>q.table==='mesa_tokens').every(q=>q.mapa_id&&q.mesa_id===room),'todas as consultas de tokens do Mestre filtram mesa e mapa');
  const distinct=blobs.size;
  for(let n=1;n<=3;n++)await OS.uploadMesaMapFile(new File([blobs.get(maps[n-1].storage_path)],'map.png',{type:'image/png'}),n,maps[n-1].id);
  check(uploads.length===3&&uploads.every((u,n)=>u.key===room+'/slot_'+(n+1)+'.png'&&u.opts.upsert),'upload usa slot específico com upsert');
  check(blobs.size===distinct&&lists===0&&removals===0,'substituir imagens não lista nem remove arquivos de outros slots');
  const stored=maps.map(m=>m.url);check(stored.every(url=>url.includes('?t=')),'cada slot recebe seu cache-buster');
  OS.openMesaMapSettings('map2','flamula');
  check(OS.$('mesa-map-settings').open&&flag==='map1','mover jogadores abre confirmação sem alteração antecipada');
  OS.$('mesa-map-confirm').click();while(OS.$('mesa-map-confirm').disabled)await tick();
  check(flag==='map2','confirmação explícita muda flâmula');
  OS.openMesaMapSettings('map2');OS.$('mesa-map-name').value='Adega';OS.$('mesa-map-confirm').click();while(OS.$('mesa-map-confirm').disabled)await tick();
  check(maps[1].nome==='Adega'&&maps[0].nome==='Taverna','configurações renomeiam somente mapa escolhido');
  let add=Array.from(OS.$('mesa-map-tabs').querySelectorAll('button')).find(b=>b.textContent.includes('Adicionar mapa'));add.click();
  while(st.activeMapId!=='map4')await tick();
  check(document.querySelectorAll('.mesa-map-tab').length===4&&!OS.$('mesa-map-tabs').textContent.includes('Adicionar mapa'),'quarta aba remove botão de adição');
  OS.clearMesaMaps();Object.assign(st,{mesaId:room,isMestre:false,currentUserId:'player',pendingLocalTokenUpdates:{}});flag='map1';
  await OS.loadMesaMapView();OS.subscribeMesaRealtimeChannel(room);
  check(OS.$('mesa-map-tabs').hidden&&OS.$('mesa-map-tabs').children.length===0&&st.mapas.length===1,'Jogador não recebe/renderiza seletor ou mapas de preparação');
  check(!handlers.some(h=>h.filter.table==='mesa_tokens'),'Jogador não assina DELETE bruto de tokens que ignora RLS');
  const signal=handlers.find(h=>h.filter.table==='mesa_mapa_sinais');check(signal&&signal.filter.filter==='mesa_id=eq.'+room,'Jogador assina sinal seguro da própria mesa');
  const before=st.activeMapId;maps[1].grid_cols=30;await OS.loadMesaMapView();check(st.activeMapId===before,'preparação do Mestre não troca visão do Jogador');
  let cancelled=0;OS.cancelMapTokenDrag=()=>{cancelled++;st.isDraggingLocal=false;OS.cancelMapTokenDrag=null;};st.isDraggingLocal=true;
  flag='map2';revision++;signal.fn({new:{mesa_id:room,mapa_ativo_id:flag,revisao:revision}});
  while(st.activeMapId!=='map2')await tick();
  check(cancelled===1&&st.gridCols===30&&st.mesaTokens.length===1&&st.mesaTokens[0].id==='t1','sinal cancela arraste e troca imagem/grade/tokens do Jogador');
  while(OS.$('mesa-map-image').naturalWidth!==1000)await tick();await tick();
  check(OS.mapCamera.zoom<=1&&OS.mapCamera.panX>=0,'câmera do Jogador enquadrada no novo mapa');
  let resolveOld;const old=snapshot();defer=new Promise(r=>resolveOld=r);const oldRequest=OS.loadMesaMapView();
  flag='map3';revision++;await OS.loadMesaMapView();resolveOld({data:old});await oldRequest;
  check(st.activeMapId==='map3'&&st.mesaTokens[0].mapa_id==='map3','resposta atrasada não restaura mapa anterior');
  let resolveSession,joins=0,authenticated=false,resyncs=0;
  client.auth={getSession:()=>new Promise(resolve=>{resolveSession=resolve;})};
  client.realtime={setAuth:async token=>{authenticated=token==='test-jwt';}};
  client.channel=()=>({on(){return this;},subscribe(callback){joins++;callback('SUBSCRIBED');return this;}});
  OS.refreshMesaStageAndTokens=async()=>{resyncs++;};OS.loadMesaFeedEvents=async()=>{};
  OS.subscribeMesaRealtimeChannel(room);
  check(joins===0,'assinatura aguarda sessão antes de conectar');
  resolveSession({data:{session:{access_token:'test-jwt'}}});await tick();await tick();
  check(authenticated&&joins===1,'JWT configurado antes de assinar Realtime');
  check(resyncs===1,'primeira assinatura também reconcilia mudanças ocorridas durante conexão');
  OS.clearMesaMaps();check(!st.activeMapId&&st.mapas.length===0&&!st._mapBlobUrl,'sair limpa mapas, tokens e URLs temporárias');
  Object.assign(st,{mesaId:room,isMestre:true,mapas:clone(maps),playerMapId:flag});await OS.loadMesaMapView('map2');
  document.getElementById('result').textContent='PASS: '+results.length+' verificações | '+results.join(' | ');
 }catch(e){document.getElementById('result').textContent='FAIL: '+e.stack;}
};
const html='<!doctype html><meta charset="utf-8"><style>'+read('dist/style.css')+'</style><style>body{padding:0;background:#17120f}#mesa-map-stage{position:absolute;left:16px;top:16px;width:1000px;height:700px}#result{position:absolute;top:730px;white-space:pre-wrap;color:white;font:12px monospace}</style>'+stage+'<pre id="result">Executando…</pre><script>var OS={};'+scripts+'\n('+test.toString()+')();</script>';
const file=path.join(temp,'maps.html');fs.writeFileSync(file,html);const screenshot=path.join(temp,'maps.png');
require('./browser-harness.cjs')(file,temp,screenshot).then(result=>{
 console.log(result||'FAIL: resultado ausente');console.log('Screenshot: '+screenshot);
 if(!result?.startsWith('PASS:'))process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
