// Real Auth/HTTP/WebSocket integration. Only disposable fixture IDs from the supplied config.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const source=fs.readFileSync(path.join(__dirname,'../dist/js/supabaseConfig.js'),'utf8');
const url=source.match(/OS.SUPABASE_URL = "([^"]+)"/)[1],key=source.match(/OS.SUPABASE_ANON_KEY = "([^"]+)"/)[1];
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},gm=createClient(url,key,options),player=createClient(url,key,options);
const results=[],channels=[];let passed=false;
const data=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data;};
const check=(ok,name)=>{if(!ok)throw Error(name);results.push(name);console.log('PASS: '+name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw Error('Timeout WebSocket');await delay(100);}}
async function subscribe(client,handlers){await client.realtime.setAuth((await client.auth.getSession()).data.session.access_token);const channel=client.channel('gm-tools-'+crypto.randomUUID());channels.push([client,channel]);handlers(channel);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('subscribe timeout')),15000);channel.subscribe(s=>{if(s==='SUBSCRIBED'){clearTimeout(t);resolve();}else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT'){clearTimeout(t);reject(Error(s));}});});}
(async()=>{
 try{
  await data(gm.auth.signInWithPassword({email:cfg.gmEmail,password:cfg.password}));await data(player.auth.signInWithPassword({email:cfg.playerEmail,password:cfg.password}));
  const room=await data(gm.from('mesas').select('mapas').eq('id',cfg.room).single()),map=room.mapas[0].id;
  const ficha=await data(player.from('fichas').insert({usuario_id:cfg.player,mesa_id:cfg.room,nome_personagem:'Teste de entrega',dados:{config6B:{d6:6},damagedChambers:[],'rem-total':8,'rem-atual':6}}).select().single());
  const own=crypto.randomUUID(),creature=crypto.randomUUID(),ref=crypto.randomUUID();
  await data(gm.from('mesas').update({cena_ativa:[{instanceId:ref,name:'Criatura de teste',data:{'config-6b':'4d6',damagedChambers:[0],'rem-total':4,'rem-atual':3}}]}).eq('id',cfg.room));
  await data(gm.from('mesa_tokens').insert([{id:own,mesa_id:cfg.room,mapa_id:map,owner_type:'player',owner_ref:ficha.id,owner_user_id:cfg.player,display_name:'Jogador de teste',visible_to_players:false},
   {id:creature,mesa_id:cfg.room,mapa_id:map,owner_type:'creature',owner_ref:ref,display_name:'Criatura visível',visible_to_players:true}]));
  let inbox=[],playerEvents=[],gmEvents=[];
  await subscribe(player,c=>{
   c.on('postgres_changes',{event:'INSERT',schema:'public',table:'itens_entregues_pendentes',filter:'destinatario_user_id=eq.'+cfg.player},p=>{inbox.push(p.new);console.log('Realtime: entrega recebida');});
   for(const event of ['INSERT','UPDATE'])c.on('postgres_changes',{event,schema:'public',table:'mesa_token_status',filter:'mesa_id=eq.'+cfg.room},p=>playerEvents.push(p.new));
  });
  await subscribe(gm,c=>c.on('postgres_changes',{event:'UPDATE',schema:'public',table:'mesa_token_status',filter:'mesa_id=eq.'+cfg.room},p=>gmEvents.push(p.new)));
  console.log('Realtime: canais autenticados inscritos');await delay(2000);
  const delivery=crypto.randomUUID(),start=Date.now();
  await data(gm.rpc('enviar_item_para_jogador',{p_mesa_id:cfg.room,p_ficha_id:ficha.id,p_item_data:{nome:'Colt de teste',group:'armas',dano:'d6'},p_quantidade:2,p_entrega_id:delivery}));
  check((await data(player.from('itens_entregues_pendentes').select('id').eq('id',delivery))).length===1,'Fila acessível por HTTP ao destinatário autenticado');
  await until(()=>inbox.some(e=>e.id===delivery));check(true,'Entrega recebida por INSERT Realtime em '+(Date.now()-start)+' ms');
  check((await data(player.from('fichas').select('dados').eq('id',ficha.id).single())).dados.inventoryItems===undefined,'Envio do Mestre mantém ficha intacta até consumo pelo jogador');
  await data(player.from('fichas').update({dados:{...ficha.dados,receivedDeliveryIds:[delivery],inventoryItems:[{id:delivery,name:'Colt de teste',qty:2,attrs:{dano:'d6'}}]}}).eq('id',ficha.id));
  await data(player.rpc('confirmar_entrega_item',{p_entrega_id:delivery}));check((await data(player.from('itens_entregues_pendentes').select('*').eq('id',delivery).single())).entregue,'Jogador confirma entrega após persistir item/recibo via HTTP');
  const next=await data(player.from('fichas').select('dados').eq('id',ficha.id).single());
  await data(player.from('fichas').update({dados:{...next.dados,damagedChambers:[0,1],'rem-atual':3}}).eq('id',ficha.id));
  await until(()=>playerEvents.some(s=>s.token_id===own&&s.danos_bloqueados===2&&s.rem_current===3));check(true,'Integridade e REM do aliado chegam pelo Realtime');
  await data(gm.rpc('sincronizar_token_status',{p_token_id:creature,p_six_b_total:4,p_danos_bloqueados:3,p_rem_current:1,p_rem_max:4}));
  await until(()=>gmEvents.some(s=>s.token_id===creature&&s.danos_bloqueados===3));await delay(1800);
  check(!playerEvents.some(s=>s.owner_type==='creature'),'Criatura visível atualiza Mestre, sem enviar status ao WebSocket do jogador');
  const ps=await data(player.from('mesa_token_status').select('*').eq('mesa_id',cfg.room));check(ps.length===1&&ps[0].token_id===own,'SELECT HTTP também oculta status de criaturas');
  const note=[{id:crypto.randomUUID(),tipo:'arquivo',nome:'Privada',conteudo:'Somente Mestre'}];
  const nr=await data(gm.from('mesas').update({notas_mestre:note}).eq('id',cfg.room).eq('notas_mestre_versao',1).select('notas_mestre_versao'));
  check(nr[0].notas_mestre_versao===2,'Notas persistidas por UPDATE HTTP com versão');
  check((await data(player.from('mesas').select('notas_mestre').eq('id',cfg.room))).length===0,'Jogador não lê notas por SELECT HTTP');
  check((await data(gm.from('mesas').update({notas_mestre:[]}).eq('id',cfg.room).eq('notas_mestre_versao',1).select('id'))).length===0,'Versão antiga não sobrescreve notas via HTTP');
  passed=true;
 }catch(e){console.error('FAIL: '+e.message);process.exitCode=1;}
 finally{
  for(const [client,channel] of channels)await client.removeChannel(channel);
  const removed=await gm.from('mesas').delete().eq('id',cfg.room);if(removed.error){console.error('CLEANUP: '+removed.error.message);process.exitCode=1;}
  await gm.auth.signOut();await player.auth.signOut();gm.realtime.disconnect();player.realtime.disconnect();
  fs.writeFileSync(path.join(__dirname,'artifacts/live-gm-tools-results.json'),JSON.stringify({passed,results,roomCleanup:!removed.error},null,2));
 }
})().then(()=>process.exit(process.exitCode||0));
