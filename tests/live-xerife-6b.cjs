// Teste de integracao real (Auth HTTP + RLS + WebSocket Realtime) EXCLUSIVO para Homologacao (igyupxczhczidfgtjiws).
// Uso: node tests/live-xerife-6b.cjs <config.json>
// Onde <config.json> contem { url, anonKey, gm, player, gmEmail, playerEmail, password }
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const url = cfg.url || 'https://igyupxczhczidfgtjiws.supabase.co';
const key = cfg.anonKey;
if (url !== 'https://igyupxczhczidfgtjiws.supabase.co') throw Error('Este teste exige exclusivamente o ambiente de Homologacao (igyupxczhczidfgtjiws).');
if (!key) throw Error('anonKey/publishable key da Homologacao obrigatoria.');

const clients = [], rooms = [], results = [], channels = [];
let passed = false;
const data = async p => { const r = await p; if (r.error) throw Error((r.error.code || '') + ': ' + r.error.message); return r.data; };
const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); console.log('PASS: ' + label); };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(pred) { const end = Date.now() + 15000; while (!pred()) { if (Date.now() > end) throw Error('Timeout WebSocket Realtime'); await delay(100); } }
async function login(email) {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  clients.push(c);
  await data(c.auth.signInWithPassword({ email, password: cfg.password }));
  return c;
}
async function subscribe(client, room, onEvent) {
  await client.realtime.setAuth((await client.auth.getSession()).data.session.access_token);
  const channel = client.channel('live-xerife-6b-' + crypto.randomUUID());
  channels.push([client, channel]);
  for (const event of ['INSERT', 'UPDATE']) {
    channel.on('postgres_changes', { event, schema: 'public', table: 'mesa_6b_aberto', filter: 'mesa_id=eq.' + room }, onEvent);
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error('Realtime subscribe timeout')), 15000);
    channel.subscribe(s => {
      if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); reject(Error(s)); }
    });
  });
}

(async () => {
  try {
    const gm = await login(cfg.gmEmail);
    const player = await login(cfg.playerEmail);
    const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    clients.push(anon);

    const roomId = crypto.randomUUID();
    const invite = crypto.randomBytes(6).toString('hex').toUpperCase();
    await data(gm.from('mesas').insert({ id: roomId, nome: 'QA Xerife 6B', mestre_id: cfg.gm, codigo_convite: invite }));
    rooms.push([gm, roomId]);
    await data(gm.from('membros_mesa').insert({ mesa_id: roomId, usuario_id: cfg.gm, cargo: 'mestre' }));
    await data(player.rpc('entrar_na_mesa_por_codigo', { p_codigo: invite }));

    const ficha = await data(player.from('fichas').insert({
      usuario_id: cfg.player,
      mesa_id: roomId,
      nome_personagem: 'Pistoleiro Live 6B',
      nivel: 7,
      dados: { nome: 'Pistoleiro Live 6B', nivel: 7, config6B: { d8: 6 } }
    }).select().single());

    const conn1 = crypto.randomUUID(), conn2 = crypto.randomUUID();
    await data(player.rpc('presenca_6b_xerife', { p_mesa: roomId, p_conexao: conn1, p_ficha: ficha.id, p_sair: false }));
    await data(player.rpc('presenca_6b_xerife', { p_mesa: roomId, p_conexao: conn2, p_ficha: ficha.id, p_sair: false }));

    const openRead = await data(gm.rpc('ler_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto' }));
    const secRead = await data(gm.rpc('ler_6b_xerife', { p_mesa: roomId, p_tipo: 'secreto' }));
    check(JSON.stringify(openRead.dados) === '[8,8,8,8,8,8]', 'Aberto deriva 6d8 pelo nivel 7 da ficha');
    check(JSON.stringify(secRead.dados) === '[8]', 'Duas conexoes do mesmo jogador contam apenas 1 dado secreto');

    const pEvents = [];
    await subscribe(player, roomId, p => pEvents.push(p));
    await delay(1000);

    // Anon e Jogador bloqueados de segredo e operacoes
    check((await anon.rpc('ler_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto' })).error?.code === '42501', 'Anonimo bloqueado via HTTP');
    check((await player.rpc('ler_6b_xerife', { p_mesa: roomId, p_tipo: 'secreto' })).error?.code === '42501', 'Jogador nao le segredo via HTTP');
    check((await player.rpc('rolar_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 0 })).error?.code === '42501', 'Jogador nao rola aberto via HTTP');
    check((await player.from('mesa_6b_aberto').update({ usados: [0] }).eq('mesa_id', roomId)).error?.code === '42501', 'Jogador nao altera mesa_6b_aberto via HTTP');

    // Rolagem secreta nao emite evento Realtime
    const secRoll = await data(gm.rpc('rolar_6b_xerife', { p_mesa: roomId, p_tipo: 'secreto', p_versao: 0 }));
    check(secRoll.resultados.length === 1 && secRoll.versao === 1, 'Rolagem secreta confirmada no servidor');
    await delay(1200);
    check(pEvents.length === 0, 'Rolagem secreta nao emite evento Realtime para jogador');

    // Rolagem aberta emite INSERT Realtime
    const openRoll = await data(gm.rpc('rolar_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 0 }));
    check(openRoll.resultados.length === 6 && openRoll.versao === 1, 'Rolagem aberta confirmada no servidor');
    await until(() => pEvents.some(e => e.eventType === 'INSERT' && e.new && e.new.versao === 1));
    check(true, 'Jogador recebe INSERT do 6B Aberto via WebSocket Realtime');

    // Consumo parcial + bloqueio de renovacao + consumo total + renovacao
    const openCons1 = await data(gm.rpc('consumir_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 1, p_indices: [0, 1] }));
    check(JSON.stringify(openCons1.usados) === '[0,1]' && openCons1.versao === 2, 'Consumo parcial aberto via HTTP');
    await until(() => pEvents.some(e => e.eventType === 'UPDATE' && e.new && e.new.versao === 2));
    check(true, 'Jogador recebe UPDATE de consumo via Realtime');

    const earlyRenew = await gm.rpc('renovar_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 2 });
    check(earlyRenew.error?.code === '55000', 'Renovacao bloqueada via HTTP antes de gastar todos os dados');

    const openCons2 = await data(gm.rpc('consumir_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 2, p_indices: [2, 3, 4, 5] }));
    check(openCons2.usados.length === 6 && openCons2.versao === 3, 'Consumo dos dados restantes via HTTP');

    // Atualiza nivel da ficha para 13 -> renovacao deve adotar d10
    await data(player.from('fichas').update({ nivel: 13, dados: { nome: 'Pistoleiro Live 6B', nivel: 13 } }).eq('id', ficha.id));
    const renewed = await data(gm.rpc('renovar_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto', p_versao: 3 }));
    check(JSON.stringify(renewed.dados) === '[10,10,10,10,10,10]' && renewed.usados.length === 0 && renewed.versao === 4, 'Renovacao aberta adota novo nivel (d10) e zera usados');
    await until(() => pEvents.some(e => e.eventType === 'UPDATE' && e.new && e.new.versao === 4));
    check(true, 'Jogador recebe UPDATE de renovacao via Realtime');

    // Presenca sai e reconexao via novo cliente le estado autoritativo
    await data(player.rpc('presenca_6b_xerife', { p_mesa: roomId, p_conexao: conn1, p_ficha: null, p_sair: true }));
    const freshPlayer = await login(cfg.playerEmail);
    const reread = await data(freshPlayer.rpc('ler_6b_xerife', { p_mesa: roomId, p_tipo: 'aberto' }));
    check(reread.versao === 4 && JSON.stringify(reread.dados) === '[10,10,10,10,10,10]', 'Novo cliente recupera estado autoritativo sem cache');

    passed = true;
  } catch (err) {
    console.error('FAIL: ' + err.message);
    process.exitCode = 1;
  } finally {
    for (const [c, ch] of channels) await c.removeChannel(ch);
    for (const [owner, id] of rooms) await owner.from('mesas').delete().eq('id', id);
    if (clients[1] && cfg.player) await clients[1].from('fichas').delete().eq('usuario_id', cfg.player).is('mesa_id', null);
    for (const c of clients) {
      await c.auth.signOut().catch(() => {});
      c.realtime.disconnect();
    }
    fs.writeFileSync(path.join(__dirname, 'artifacts/live-xerife-6b-results.json'), JSON.stringify({ passed, results }, null, 2));
  }
})().then(() => process.exit(process.exitCode || 0));
