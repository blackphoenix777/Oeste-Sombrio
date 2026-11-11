const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const OS = {};
vm.runInNewContext(fs.readFileSync('dist/js/mesaScreen.js', 'utf8').replace(/^import .*;\r?\n/gm, ''), {OS, console});
(async () => {
  const st = OS.activeMesaState;
  Object.assign(st, {mesaId:'room', currentUserId:'player', isMestre:false});
  OS.renderMesaMapTokens = () => {};
  OS.renderMesaSceneCards = () => {};
  const calls = [];
  OS.getSupabaseClient = () => ({
    from: () => { throw Error('Jogador tentou SELECT direto'); },
    rpc: async (name,args) => { calls.push(name); assert.equal(args.p_mesa_id,'room'); return {data:[{token_id:'own', owner_type:'player', is_own:true}]}; }
  });
  await OS.loadMesaTokens();
  assert.equal(calls[0], 'obter_cena_publica');
  assert.equal(st.mesaTokens[0].id, 'own');
  assert.equal(OS.canCurrentUserMoveToken(st.mesaTokens[0]), true);
  assert.equal(OS.canCurrentUserMoveToken({owner_type:'player',is_own:false}), false);
  OS.getCurrentUserId = async () => 'player';
  OS.getSupabaseClient = () => ({rpc: async name => {
    assert.equal(name, 'listar_mesas_acessiveis'); return {data:[{id:'room',mestre_id:'gm',nome:'Room'}]};
  }});
  assert.equal((await OS.readAccessibleMesa('room')).data.nome, 'Room');
  OS.getSupabaseClient = () => ({rpc: async()=>({data:[]})});
  await OS.loadMesaTokens();
  assert.equal(st.mesaTokens.length,0);
  st.isMestre=true;
  OS.getSupabaseClient = () => ({from: table => {
    assert.equal(table,'mesa_tokens'); return {select: columns=>{assert.equal(columns,'*');return {eq:()=>({order:async()=>({data:[{id:'hidden',visible_to_players:false}]})})}}};
  }});
  await OS.loadMesaTokens();
  assert.equal(st.mesaTokens[0].id,'hidden');
  console.log('PASS: jogador usa RPC; normaliza token_id; próprio token movível; outro bloqueado; metadados via RPC; refresh remove token ocultado; Mestre mantém SELECT completo. Backend simulado.');
})().catch(e=>{console.error(e);process.exitCode=1;});
