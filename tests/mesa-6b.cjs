// Regressão dos componentes reais, em Chrome headless e sem acesso ao Supabase.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkwest-6b-'));
const scripts = ['dist/js/magiasUI.js', 'dist/js/mesaScreen.js']
  .map(file => read(file).replace(/^import .*;\r?\n/gm, '')).join('\n');
const test = async function () {
  const results = [];
  const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
  try {
    OS.$ = id => document.getElementById(id);
    let saves = 0;
    OS.scheduleMesaSceneSave = () => saves++;
    OS.saveMesaNpcsRemote = async () => { saves++; };
    const st = OS.activeMesaState;
    Object.assign(st, { mesaId: 'test', currentUserId: 'test', isMestre: true });
    const creature = { instanceId: 'scene-test', name: 'NPC 7 dados', collapsed: false,
      data: { nome: 'NPC 7 dados', 'config-6b': '7d6', config6B: { d6: 6 } } };
    const npc = { mesaNpcId: 'npc-test', name: 'NPC contaminado',
      data: { 'config-6b': '6d6', config6B: { d6: 6 } } };
    st.sceneCreatures = [creature]; st.npcsMesa = [npc];
    OS.openOrFocusCreaturePopup({ from: 'scene', instanceId: creature.instanceId });
    OS.openOrFocusCreaturePopup({ from: 'mesa-npc', mesaNpcId: npc.mesaNpcId });
    for (const n of [7, 8]) {
      creature.data['config-6b'] = n + 'd6';
      OS.rollSceneCreature6B(creature.instanceId);
      const disp = OS.getCreature6BDisplayInfo(creature.data);
      check(disp.count === n && disp.vidaText === n + '/' + n, 'displayInfo ' + n + ' dados');
      check(Array.from({length:n}, (_,i) => Number(creature.data['chamber-'+i])).every(v=>v>=1&&v<=6), n+' dados rolados');
      check(document.querySelector('.scene-creature-card .badge-health').textContent.includes(n + '/' + n), n+' vida no card compacto');
      check(document.querySelectorAll('[data-target-id="scene-test"] .scene-chamber-pill').length === n, n+' pílulas no popup');
    }
    creature.data.originalChambers = Array(8).fill(6);
    creature.data.usedChambers = [0, 6, 7];
    creature.data.markedChambers = [7]; creature.data['chamber-7-mark'] = true;
    function edit(selector, value) {
      const box = document.querySelector(selector);
      box.querySelector('.scene-config-6b-input').value = value;
      box.querySelector('[data-action="save-6b-config"]').click();
    }
    edit('[data-target-id="scene-test"]', '2d6');
    OS.rollSceneCreature6B(creature.instanceId);
    check(creature.data.config6B.d6 === 2 && creature.data['chamber-7'] === '0' && !creature.data['chamber-7-mark'] && creature.data.originalChambers[7] === '0' && creature.data.markedChambers.length === 0, 'redução 8 → 2 sanitiza excedentes');
    check(document.querySelector('.scene-creature-card .badge-health').textContent.includes('2/2'), 'vida 2/2 no card compacto');
    check(document.querySelector('[data-target-id="scene-test"]').textContent.includes('6B (2d6)'), 'texto 2d6 no popup');
    edit('[data-target-id="npc-test"]', '2d6'); OS.rollMesaNpc6B(npc.mesaNpcId);
    check(npc.data.config6B.d6 === 2 && npc.data['chamber-2'] === '0', 'NPC contaminado corrigido pelo botão Salvar 6B');
    const playerSheet = {
      id: 'player-sheet-test',
      nome_personagem: 'Pistoleiro',
      dados: {
        nome: 'Pistoleiro',
        nivel: 1,
        defesa: '12',
        iniciativa: '8',
        fateTokens: { vermelha: 1, azul: 0, verde: 0, preta: 0 },
        inventoryItems: [{ id: 'w1', group: 'armas', equipped: true, name: 'Revólver', attrs: { dano: 'd6' } }],
        damagedChambers: []
      }
    };
    st.playerSheets = [playerSheet];
    const pDisp = OS.getCreature6BDisplayInfo(playerSheet.dados, { isPlayer: true });
    check(pDisp.count === 6 && pDisp.cfgText === '6d6' && pDisp.vidaText === '6/6', 'displayInfo jogador 6d6');
    OS.rollPlayerPopup6B(playerSheet.id);
    check(Array.from({length:6}, (_,i) => Number(playerSheet.dados['chamber-'+i])).every(v=>v>=1&&v<=6), 'jogador rola 6 câmaras pelo popup');
    const atkRes = OS.rollPlayerPopupAttack(playerSheet.id, 0);
    check(atkRes && playerSheet.dados.usedChambers.length === 1, 'ataque popup jogador consome câmara corretamente');
    st.mesaTokens = [{ id: 'ptoken-test', mesa_id: 'test', owner_type: 'player', owner_ref: playerSheet.id, display_name: 'Pistoleiro', visible_to_players: true }];
    OS.renderMesaSceneCards();
    OS.openOrFocusPlayerPopup(playerSheet.id);
    check(document.querySelectorAll('[data-target-id="player-sheet-test"] .scene-chamber-pill').length === 6, 'popup jogador exibe 6 pílulas');
    check(document.querySelector('.is-player-entity .badge-health').textContent.includes('6/6'), 'card jogador em cena exibe vida 6/6');
    check(saves > 0, 'edições acionam persistência (simulada)');
    const input = document.querySelector('.scene-config-6b-input'); input.value = 'inválido';
    check(!input.checkValidity(), 'entrada inválida rejeitada'); input.value = '2d6';
    st.gmPopupsHubExpanded = true; OS.renderMesaPopupsHub();
    check(document.querySelectorAll('.mesa-popups-hub-item').length === 3, 'hub com três popups');
    for (const selector of ['.mesa-popups-hub-panel-header', '.mesa-popups-hub-bulk-actions', '.mesa-popups-hub-item-main'])
      check(getComputedStyle(document.querySelector(selector)).display === 'flex', 'CSS aplicado: '+selector);
    document.querySelector('[data-hub-action="collect-all"]').click();
    check(st.gmPopups.every(p=>p.inHub), 'recolher todos');
    document.querySelector('[data-hub-action="toggle-item"]').click();
    check(st.gmPopups.some(p=>!p.inHub), 'reabrir pelo hub');
    // Disposição somente do cenário de teste, para inspeção da captura.
    st.gmPopups.forEach((p,i)=>{p.x=400+i*365;p.y=60;p.inHub=false;});
    OS.renderMesaFloatingPopups();
    const token = { id: 'token-test', mesa_id: 'test', owner_type: 'creature', owner_ref: creature.instanceId, visible_to_players: false };
    st.mesaTokens = [token];
    const loadTokens = OS.loadMesaTokens;
    OS.loadMesaTokens = async () => { OS.renderMesaSceneCards(); OS.renderMesaFloatingPopups(); };
    let visibilityCalls = 0;
    OS.getSupabaseClient = () => ({ rpc: async (name, args) => {
      check(name === 'definir_visibilidade_token' && args.p_token_id === token.id, 'RPC de visibilidade correta');
      token.visible_to_players = args.p_visible; visibilityCalls++; return {error:null};
    }});
    OS.renderMesaSceneCards(); OS.renderMesaFloatingPopups();
    document.querySelector('.scene-creature-card .mesa-token-visibility').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(token.visible_to_players && document.querySelector('[data-target-id="scene-test"] .mesa-token-visibility').textContent.includes('Ocultar'), 'revelar no card atualiza popup');
    document.querySelector('[data-target-id="scene-test"] .mesa-token-visibility').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(!token.visible_to_players && visibilityCalls === 2, 'ocultar no popup atualiza token');
    OS.loadMesaTokens = loadTokens;
    document.getElementById('result').textContent = 'PASS: '+results.join(' | ');
  } catch(e) { document.getElementById('result').textContent = 'FAIL: '+e.stack; }
};
const html = '<!doctype html><meta charset="utf-8"><style>'+read('dist/style.css')+'</style>'+
  '<pre id="result" style="position:relative;white-space:pre-wrap;max-width:350px"></pre><div id="mesa-em-cena-list" style="width:350px"></div><div id="mesa-npcs-mesa-list"></div><div id="mesa-floating-popups-layer"></div><div id="mesa-popups-hub"></div>'+
  '<script>var OS={};'+scripts+'\n('+test.toString()+')();</script>';
const file = path.join(temp, 'test.html'); fs.writeFileSync(file, html);
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const screenshot = path.join(temp, 'hub.png');
const output = execFileSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir='+path.join(temp,'profile'), '--window-size=1200,900', '--screenshot='+screenshot, '--dump-dom', 'file:///'+file.replaceAll('\\','/')], {timeout:45000, maxBuffer:4*1024*1024, encoding:'utf8', stdio:['ignore','pipe','pipe']});
const result = output.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
console.log(result || 'FAIL: resultado ausente'); console.log('Screenshot: '+screenshot);
if (!result?.startsWith('PASS:')) process.exitCode = 1;
