// Integração OPCIONAL: requer autorização explícita para duas contas/mesa temporárias.
// Configuração fora do repositório: {gm,player,room,gmEmail,playerEmail,password}.
// Não cria contas. O chamador cria/remove SOMENTE as contas temporárias da configuração.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {createClient}=require('@supabase/supabase-js');
const cfg=JSON.parse(fs.readFileSync(process.argv[2]||path.join(os.tmpdir(),'darkwest-map-test-session.json'),'utf8').replace(/^\uFEFF/,''));
const source=fs.readFileSync(path.join(__dirname,'../dist/js/supabaseConfig.js'),'utf8');
const url=source.match(/OS.SUPABASE_URL = "([^"]+)"/)[1],key=source.match(/OS.SUPABASE_ANON_KEY = "([^"]+)"/)[1];
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const gm=createClient(url,key,options),player=createClient(url,key,options),anon=createClient(url,key,options);
const results=[],files=[];let channel,cleanupOK=true;
const check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);console.log('PASS: '+label);};
const data=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data;};
function png(rgb){
 function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 function chunk(type,b){const t=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([t,b])));return Buffer.concat([length,t,b,sum]);}
 const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.from([0,...rgb]))),chunk('IEND',Buffer.alloc(0))]);
}
(async()=>{
 try{
  await data(gm.auth.signInWithPassword({email:cfg.gmEmail,password:cfg.password}));
  await data(player.auth.signInWithPassword({email:cfg.playerEmail,password:cfg.password}));
  const room=await data(gm.from('mesas').select('mapas').eq('id',cfg.room).single());const maps=[room.mapas[0]];
  for(let i=0;i<2;i++){const r=await data(gm.rpc('gerenciar_mapas',{p_mesa_id:cfg.room,p_acao:'adicionar'}));maps.push(r.mapas.find(m=>m.id===r.mapa_id));}
  for(let i=0;i<3;i++){
   const name=cfg.room+'/slot_'+(i+1)+'.png';files.push(name);
   await data(gm.storage.from('mesa-maps').upload(name,png([[255,0,0],[0,255,0],[0,0,255]][i]),{upsert:true,contentType:'image/png',cacheControl:'0'}));
   await data(gm.rpc('gerenciar_mapas',{p_mesa_id:cfg.room,p_acao:'editar',p_mapa_id:maps[i].id,p_dados:{url:name+'?t='+Date.now(),storage_path:name,grid_cols:i===1?32:20}}));
  }
  check((await data(gm.storage.from('mesa-maps').list(cfg.room))).length===3,'três imagens distintas coexistem no Storage real');
  const before=await data(gm.storage.from('mesa-maps').download(files[0]));
  await data(gm.storage.from('mesa-maps').upload(files[1],png([50,100,150]),{upsert:true,contentType:'image/png',cacheControl:'0'}));
  const after=await data(gm.storage.from('mesa-maps').download(files[0]));
  check(Buffer.from(await before.arrayBuffer()).equals(Buffer.from(await after.arrayBuffer()))&&(await data(gm.storage.from('mesa-maps').list(cfg.room))).length===3,'upsert slot 2 preserva bytes do slot 1 e três arquivos');
  const visible=crypto.randomUUID(),hidden=crypto.randomUUID();
  await data(gm.from('mesa_tokens').insert([{id:visible,mesa_id:cfg.room,mapa_id:maps[1].id,owner_type:'creature',owner_ref:crypto.randomUUID(),display_name:'Visible in map 2',visible_to_players:true},
   {id:hidden,mesa_id:cfg.room,mapa_id:maps[1].id,owner_type:'creature',owner_ref:crypto.randomUUID(),display_name:'Hidden in map 2',visible_to_players:false}]));
  let view=await data(player.rpc('obter_mapa_publico',{p_mesa_id:cfg.room}));
  check(view.mapa.id===maps[0].id&&view.tokens.length===0&&!JSON.stringify(view).includes(maps[1].id),'RPC HTTP do jogador oculta mapa e tokens de preparação');
  check((await player.storage.from('mesa-maps').download(files[1])).error,'download autenticado de slot privado é negado');
  check(!(await player.storage.from('mesa-maps').download(files[0])).error,'download autenticado do mapa ativo funciona');
  const pub=gm.storage.from('mesa-maps').getPublicUrl(files[1]).data.publicUrl;
  check(!(await fetch(pub)).ok,'URL pública de imagem privada é bloqueada');
  check((await anon.rpc('obter_mapa_publico',{p_mesa_id:cfg.room})).error,'RPC HTTP anônima é negada');
  let signalCount=0,resolveFlag;const flagEvent=new Promise(resolve=>{resolveFlag=resolve;});
  await player.realtime.setAuth((await player.auth.getSession()).data.session.access_token);
  check((await data(player.from('mesa_mapa_sinais').select('*').eq('mesa_id',cfg.room))).length===1,'jogador lê sinal via HTTP antes da assinatura');
  channel=player.channel('maps-live-'+cfg.room).on('postgres_changes',{event:'*',schema:'public',table:'mesa_mapa_sinais',filter:'mesa_id=eq.'+cfg.room},p=>{console.log('Realtime evento:',p.eventType,p.new?.revisao,p.new?.mapa_ativo_id===maps[1].id);signalCount++;if(p.new.mapa_ativo_id===maps[1].id)resolveFlag(p.new);});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscribe timeout')),15000);channel.subscribe(status=>{console.log('Realtime status:',status);if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error(status));}});});
  console.log('Realtime bindings:',JSON.stringify(channel.bindings.postgres_changes?.map(b=>({id:b.id,filter:b.filter}))));
  await new Promise(r=>setTimeout(r,2000));
  await data(gm.rpc('gerenciar_mapas',{p_mesa_id:cfg.room,p_acao:'editar',p_mapa_id:maps[1].id,p_dados:{nome:'Mapa preparado'}}));
  await new Promise(r=>setTimeout(r,500));check(signalCount===0,'preparação do Mestre não sinaliza mudança da visão do jogador');
  const start=Date.now();await data(gm.rpc('gerenciar_mapas',{p_mesa_id:cfg.room,p_acao:'flamula',p_mapa_id:maps[1].id}));
  let timer;try{await Promise.race([flagEvent,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Realtime flag timeout')),30000);})]);}finally{clearTimeout(timer);}
  check(true,'troca da flâmula recebida por WebSocket autenticado em '+(Date.now()-start)+' ms');
  view=await data(player.rpc('obter_mapa_publico',{p_mesa_id:cfg.room}));
  check(view.mapa.id===maps[1].id&&view.mapa.grid_cols===32&&view.tokens.length===1&&view.tokens[0].token_id===visible,'após sinal, RPC HTTP entrega imagem/grade/token corretos e oculta monstro secreto');
  const newFile=await player.storage.from('mesa-maps').download(files[1],{cacheNonce:String(Date.now())},{cache:'no-store'});
  const oldFile=await player.storage.from('mesa-maps').download(files[0],{cacheNonce:String(Date.now())},{cache:'no-store'});
  console.log('Storage após flâmula:',JSON.stringify({novo:newFile.error?.message||'ok',antigo:oldFile.error?.message||'ok'}));
  check(!newFile.error&&oldFile.error,'download autenticado sem cache acompanha a flâmula');
  const direct=await data(player.from('mesa_tokens').select('*').eq('mesa_id',cfg.room));
  check(direct.length===1&&direct[0].id===visible,'SELECT HTTP direto preserva isolamento de mapas/visibilidade');
 }catch(error){console.error('FAIL: '+error.message);process.exitCode=1;}
 finally{
  if(channel)await player.removeChannel(channel);
  if(files.length){const r=await gm.storage.from('mesa-maps').remove(files);if(r.error){cleanupOK=false;console.error('CLEANUP FAIL: '+r.error.message);}}
  const r=await gm.from('mesas').delete().eq('id',cfg.room);if(r.error){cleanupOK=false;console.error('CLEANUP FAIL: '+r.error.message);}
  await gm.auth.signOut();await player.auth.signOut();
  gm.realtime.disconnect();player.realtime.disconnect();anon.realtime.disconnect();
  console.log('Cleanup de arquivos/mesa e logout: '+(cleanupOK?'concluído':'verificar'));
  console.log('Contas Auth temporárias: remover pelo SQL autorizado usando exatamente cfg.gm e cfg.player.');
  fs.writeFileSync(path.join(__dirname,'artifacts/live-maps-results.json'),JSON.stringify({results,cleanupOK,passed:!process.exitCode},null,2));
 }
})().then(()=>process.exit(process.exitCode||0));
