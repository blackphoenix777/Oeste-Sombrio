// Complemento real de homologacao; credenciais sinteticas em arquivo fora do Git.
// Uso: node tests/live-release-144-persistence.cjs <config.json>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const source=fs.readFileSync(path.join(__dirname,'../dist/js/supabaseConfig.js'),'utf8');
const url=source.match(/OS.SUPABASE_URL = "([^"]+)"/)[1];
const key=source.match(/OS.SUPABASE_ANON_KEY = "([^"]+)"/)[1];
if(url!=='https://igyupxczhczidfgtjiws.supabase.co')throw Error('Este teste exige homologacao');
const clients=[],rooms=[],results=[];
let passed=false,cleanupOK=true;
const data=async p=>{const r=await p;if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};
const check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);console.log('PASS: '+label);};
async function login(email){const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients.push(c);await data(c.auth.signInWithPassword({email,password:cfg.password}));return c;}
async function room(client,owner){const id=crypto.randomUUID();await data(client.from('mesas').insert({id,nome:'QA144 persistencia',mestre_id:owner,codigo_convite:crypto.randomBytes(6).toString('hex').toUpperCase()}));rooms.push([client,id]);return id;}
(async()=>{try{
 const gm=await login(cfg.gmEmail),player=await login(cfg.playerEmail);
 const id=await room(gm,cfg.gm),other=await room(player,cfg.player);
 await data(gm.from('membros_mesa').insert({mesa_id:id,usuario_id:cfg.gm,cargo:'mestre'}));
 const invitation=await data(gm.from('mesas').select('codigo_convite').eq('id',id).single());
 await data(player.rpc('entrar_na_mesa_por_codigo',{p_codigo:invitation.codigo_convite}));
 const added=await data(gm.rpc('gerenciar_mapas',{p_mesa_id:id,p_acao:'adicionar'})),map=added.mapa_id;
 await data(gm.rpc('gerenciar_mapas',{p_mesa_id:id,p_acao:'editar',p_mapa_id:map,p_dados:{nome:'Persistido',grid_cols:31}}));
 await data(gm.rpc('gerenciar_mapas',{p_mesa_id:id,p_acao:'flamula',p_mapa_id:map}));
 for(const action of ['adicionar','editar','flamula','excluir']){
  const r=await player.rpc('gerenciar_mapas',{p_mesa_id:id,p_acao:action,p_mapa_id:map,p_dados:{nome:'Proibido'}});
  check(r.error?.code==='42501','Jogador bloqueado por HTTP em mapas: '+action);
 }
 check((await gm.rpc('gerenciar_mapas',{p_mesa_id:other,p_acao:'adicionar'})).error?.code==='42501','Xerife de outra mesa nao ganha autorizacao');
 const note=[{id:crypto.randomUUID(),tipo:'arquivo',nome:'Persistida',conteudo:'Texto sintetico'}];
 await data(gm.from('mesas').update({notas_mestre:note}).eq('id',id));
 for(const content of [{},42,null,[]]){
  const r=await gm.from('mesas').update({notas_mestre:[{...note[0],conteudo:content}]}).eq('id',id);
  check(r.error?.code==='22023','Conteudo JSONB invalido rejeitado: '+JSON.stringify(content));
 }
 const unchanged=await data(gm.from('mesas').select('notas_mestre,notas_mestre_versao').eq('id',id).single());
 check(unchanged.notas_mestre_versao===2&&unchanged.notas_mestre[0].conteudo==='Texto sintetico','Erros JSONB preservam texto e versao anterior');
 check((await data(player.from('mesas').update({notas_mestre:[]}).eq('id',id).select('id'))).length===0,'Jogador nao altera notas por HTTP');
 check((await data(gm.from('mesas').select('notas_mestre').eq('id',other))).length===0,'Notas isoladas entre mesas');
 const refreshed=await data(gm.auth.refreshSession());
 check(!!refreshed.session,'Renovacao real da sessao Auth');
 const freshGM=await login(cfg.gmEmail),freshPlayer=await login(cfg.playerEmail);
 const saved=await data(freshGM.from('mesas').select('mapas,notas_mestre,notas_mestre_versao').eq('id',id).single());
 check(saved.mapas.some(m=>m.id===map&&m.nome==='Persistido'&&m.grid_cols===31),'Nome e grade recuperados sem cache em novo cliente autenticado');
 check(saved.notas_mestre[0].conteudo==='Texto sintetico'&&saved.notas_mestre_versao===2,'Notas e versao recuperadas sem cache em novo cliente autenticado');
 const view=await data(freshPlayer.rpc('obter_mapa_publico',{p_mesa_id:id}));
 check(view.mapa.id===map&&view.mapa.grid_cols===31,'Flamula recuperada pelo jogador em nova sessao');
 await data(freshGM.rpc('gerenciar_mapas',{p_mesa_id:id,p_acao:'excluir',p_mapa_id:map}));
 const after=await data(freshPlayer.rpc('obter_mapa_publico',{p_mesa_id:id}));
 check(after.mapa.id!==map,'Exclusao sintetica por RPC persiste e ajusta flamula');
 passed=true;
}catch(e){console.error('FAIL: '+e.message);process.exitCode=1;}
finally{
 for(const [client,id] of rooms){const r=await client.from('mesas').delete().eq('id',id);if(r.error){cleanupOK=false;console.error('CLEANUP FAIL: '+r.error.message);}}
 for(const client of clients){const r=await client.auth.signOut();if(r.error)cleanupOK=false;client.realtime.disconnect();}
 if(!cleanupOK)process.exitCode=1;
 fs.writeFileSync(path.join(__dirname,'artifacts/live-release-144-persistence-results.json'),JSON.stringify({passed:passed&&cleanupOK,cleanupOK,results,roomIds:rooms.map(x=>x[1])},null,2));
}})().then(()=>process.exit(process.exitCode||0));
