// Funções reais do frontend; transporte Supabase e DOM simulados. Não testa WebSocket real.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const events = [], results = [], OS = {};
const clone = x => JSON.parse(JSON.stringify(x));
vm.runInNewContext(['dist/js/magiasUI.js','dist/js/mesaScreen.js'].map(file =>
  fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'')).join('\n'), {
  OS, console, crypto: {randomUUID},
  window: {dispatchEvent:e=>events.push(clone(e.detail))},
  CustomEvent: class {constructor(type,options) {this.type=type;this.detail=options.detail;}}
});
const pass = text => results.push(text);
const st = OS.activeMesaState;
OS.$ = () => null;
for (const name of ['renderMesaSceneCards','renderMesaFloatingPopups','renderMesaPlayersCards',
  'renderSingleMesaMapToken','persistMesaSceneImmediateLocal','scheduleMesaSceneSave']) OS[name]=()=>{};
OS.flushMesaSceneRemoteSave=async()=>true;

(async()=>{
  Object.assign(st,{mesaId:'room',isMestre:true,currentUserId:'gm'});
  const db=[], writes=[];
  OS.getSupabaseClient=()=>({from:table=>{
    assert.equal(table,'mesa_tokens');
    return {
      insert: row=>({select:()=>({single:async()=>{
        const token={id:randomUUID(),visible_to_players:false,...clone(row)};
        db.push(token);
        // Simula INSERT Realtime chegando antes da resposta REST: não pode duplicar cache.
        OS.handleRealtimeTokenChange({eventType:'INSERT',new:clone(token)});
        return {data:clone(token)};
      }})}),
      update: values=>{
        const filters={},query={eq:(k,v)=>{filters[k]=v;return query;},then:(resolve,reject)=>{
          writes.push({values:clone(values),filters:clone(filters)});
          db.filter(t=>Object.entries(filters).every(([k,v])=>t[k]===v)).forEach(t=>Object.assign(t,clone(values)));
          return Promise.resolve({error:null}).then(resolve,reject);
        }};
        return query;
      }
    };
  }});
  st.npcsMesa=[{mesaNpcId:'source',name:'Inebriados',data:{nome:'Inebriados',iniciativa:'12','config-6b':'6d6'}}];
  const a=await OS.addNpcMesaToScene('source');
  const b=await OS.addNpcMesaToScene('source');
  assert.notEqual(a.instance.instanceId,b.instance.instanceId);
  assert.equal(db.length,2);assert.equal(st.mesaTokens.length,2);
  assert.equal(db[0].owner_ref,a.instance.instanceId);assert.equal(db[1].owner_ref,b.instance.instanceId);
  assert.equal(db[0].display_name,'Inebriados #1');assert.equal(db[1].display_name,'Inebriados #2');
  assert.equal(db[0].iniciativa,12);assert.equal(db[1].iniciativa,12);
  pass('addNpcMesaToScene cria duas cópias/linhas independentes e não duplica eco INSERT');
  OS.updateSceneCreatureStats(a.instance.instanceId,{iniciativa:'25'});
  await OS.syncSceneTokenInitiative(a.instance);
  assert.equal(db[0].iniciativa,25);assert.equal(db[1].iniciativa,12);
  assert.equal(st.npcsMesa[0].data.iniciativa,'12');assert.equal(b.instance.data.iniciativa,'12');
  const initWrites=writes.filter(w=>'iniciativa' in w.values);
  assert(initWrites.every(w=>w.filters.mesa_id==='room'&&w.filters.owner_type==='creature'&&w.filters.owner_ref===a.instance.instanceId));
  pass('editar #1 atualiza só owner_ref da instância; #2 e catálogo preservados');
  a.instance.data.iniciativa='26';const w1=OS.syncSceneTokenInitiative(a.instance);
  a.instance.data.iniciativa='27';const w2=OS.syncSceneTokenInitiative(a.instance);
  await Promise.all([w1,w2]);assert.equal(db[0].iniciativa,27);assert.equal(db[1].iniciativa,12);
  pass('edições rápidas serializadas mantêm último valor por instância');
  OS.rollSceneCreature6B(a.instance.instanceId);await OS.syncSceneTokenInitiative(a.instance);
  assert.equal(db[0].iniciativa,27);assert.equal(db[1].iniciativa,12);
  assert(Array.from({length:6},(_,i)=>Number(a.instance.data['chamber-'+i])).every(v=>v>=1&&v<=6));
  pass('rolagem 6B preserva regra vigente e isolamento da iniciativa');

  const api=OS.getMesaCombatantsIniciative();
  assert.deepEqual(Array.from(api,x=>x.iniciativa),[27,12]);
  assert.equal(api[0].ownerRef,a.instance.instanceId);assert.equal(api[1].ownerRef,b.instance.instanceId);
  assert.strictEqual(st.tokens,st.mesaTokens);
  api[0].iniciativa=-1;assert.equal(st.mesaTokens[0].iniciativa,27);
  pass('API ordena cópias separadas, usa cache único e retorna snapshot independente');
  const first=st.mesaTokens[0],second=st.mesaTokens[1];
  Object.assign(first,{grid_x:8,grid_y:9,updated_at:'2026-01-01T00:00:00Z'});
  Object.assign(st,{isDraggingLocal:true,draggingTokenId:first.id});
  const count=events.length;
  OS.handleRealtimeTokenChange({eventType:'UPDATE',new:{...clone(first),iniciativa:'40',grid_x:0,grid_y:0,updated_at:'2026-01-01T00:00:01Z'}});
  assert.equal(first.iniciativa,40);assert.equal(first.grid_x,8);assert.equal(first.grid_y,9);
  assert.equal(second.iniciativa,12);assert.equal(events.length,count+1);
  OS.handleRealtimeTokenChange({eventType:'UPDATE',new:{...clone(first),iniciativa:1,updated_at:'2025-01-01T00:00:00Z'}});
  assert.equal(first.iniciativa,40);
  pass('Realtime UPDATE durante arraste atualiza iniciativa, preserva posição e rejeita pacote antigo');
  st.isDraggingLocal=false;
  OS.handleRealtimeTokenChange({eventType:'DELETE',old:{id:second.id}});
  assert.equal(st.mesaTokens.length,1);assert.equal(events.at(-1).combatants.length,1);
  pass('Realtime DELETE remove combatente e dispara hook');
  st.mesaTokens=[{id:'z',display_name:'B',iniciativa:10},{id:'y',display_name:'A',iniciativa:10},{id:'x',display_name:'A',iniciativa:10}];
  assert.deepEqual(Array.from(OS.getMesaCombatantsIniciative(),x=>x.tokenId),['x','y','z']);
  pass('desempate estável por nome e tokenId');

  st.isMestre=false;st.currentUserId='player';st.mesaTokens=[];
  let publicRows=[{token_id:'own',owner_ref:'sheet',owner_type:'player',display_name:'Own',iniciativa:'9',is_own:true,visible_to_players:false},
    {token_id:'visible',owner_ref:'instance',owner_type:'creature',display_name:'Visible',iniciativa:21,is_own:false,visible_to_players:true}];
  let rpcCalls=0;
  OS.getSupabaseClient=()=>({from:()=>{throw Error('SELECT privado pelo jogador');},rpc:async(name,args)=>{
    assert.equal(name,'obter_cena_publica');assert.equal(args.p_mesa_id,'room');rpcCalls++;return {data:clone(publicRows)};
  }});
  await OS.loadMesaTokens();
  assert.equal(st.mesaTokens[0].iniciativa,9);assert.equal(OS.getMesaCombatantsIniciative()[1].isOwner,true);
  const before=events.length;
  await OS.loadMesaTokens();assert.equal(events.length,before);
  publicRows[1].iniciativa=30;
  await OS.handleRealtimeTokenChange({eventType:'UPDATE',new:{id:'visible',mesa_id:'room',iniciativa:30}});
  assert.equal(OS.getMesaCombatantsIniciative()[0].iniciativa,30);assert.equal(events.length,before+1);
  publicRows=publicRows.slice(0,1);
  await OS.handleRealtimeTokenChange({eventType:'DELETE',old:{id:'visible'}});
  assert.equal(OS.getMesaCombatantsIniciative().length,1);
  st.mesaTokens.push({id:'hidden',iniciativa:999,visible_to_players:false});
  assert.equal(OS.getMesaCombatantsIniciative().length,1);
  assert(rpcCalls>=4);
  pass('jogador recebe iniciativa via RPC após evento; ocultos excluídos; hook sem repetição no refresh idêntico');
  const beforeOther=rpcCalls;
  await OS.handleRealtimeTokenChange({eventType:'UPDATE',new:{id:'other',mesa_id:'other-room'}});
  assert.equal(rpcCalls,beforeOther);
  pass('evento de outra mesa ignorado');
  let release;
  OS.getSupabaseClient=()=>({rpc:()=>new Promise(r=>{release=r;})});
  const pending=OS.loadMesaTokens();
  st.mesaId='other-room';st.mesaTokens=[];
  release({data:clone(publicRows)});await pending;
  assert.equal(st.mesaTokens.length,0);
  pass('resposta atrasada não contamina a mesa aberta depois');
  console.log('PASS: '+results.length+' grupos (backend/DOM simulados)\n'+results.map(x=>'  '+x).join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1;});
