// DOM, CSS e handlers reais; fixtures sintéticos e transporte Supabase simulado, sem rede externa.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkwest-mesa-p0-'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const test = async function () {
  const results = [], check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms)), clone = x => JSON.parse(JSON.stringify(x));
  const pointer = (el, type, x, y, id = 8) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: id, clientX: x, clientY: y }));
  const key = (el, name = 'Delete', options = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name, ...options }));
  try {
    for (const name of ['config','state','ui','dice','modal','cylinder','skills','combat','storage','equipment','equipCatalog','gameData','catalogModal','inventoryUI','magiasUI','characterManager','homeScreen','mesaScreen','mesaMaps','turnTracker','mesaTokenStatus']) await import('/js/' + name + '.js');
    const OS = window.OS, st = OS.activeMesaState;
    OS.$ = id => document.getElementById(id);
    OS.scheduleSave = () => {}; OS.scheduleMesaSceneSave = () => {};
    const player = { id: 'sheet-a', mesa_id: 'room', usuario_id: 'player', dados: { nome: 'Alice sintética' } };
    const other = { id: 'sheet-b', mesa_id: 'room', usuario_id: 'other', dados: { nome: 'Bruno sintético' } };
    const template = { mesaNpcId: 'npc', data: { nome: 'NPC original' } };
    const instances = ['one','two'].map((id, i) => ({ instanceId: id, sourceId: 'npc', name: 'Instância ' + id, data: { nome: 'Instância ' + id, defesa: String(10+i) } }));
    const makeToken = (id, type, ref) => ({ id, mesa_id: 'room', mapa_id: 'map', owner_type: type, owner_ref: ref, owner_user_id: type === 'player' ? 'player' : null, grid_x: 2, grid_y: 2, display_name: id });
    let rows = [makeToken('p','player','sheet-a'), makeToken('c1','creature','one'), makeToken('c2','creature','two')];
    Object.assign(st, { mesaId: 'room', activeMapId: 'map', isMestre: true, currentUserId: 'gm', mesa: {}, playerSheets: [player, other], playerFichaId: null, npcsMesa: [template], sceneCreatures: instances, mesaTokens: clone(rows), gridCols: 10, gmPopups: [], pendingLocalTokenUpdates: {} });
    let fail = false, denied = false, hold = null, sceneWrites = 0;
    const calls = [];
    OS.getSupabaseClient = () => ({ from(table) {
      const filters = {}; let operation = 'select';
      const q = { delete() { operation = 'delete'; return q; }, select() { return q; }, eq(k,v) { filters[k] = v; return q; },
        then: async function (resolve) {
          calls.push({ table, operation, filters: clone(filters) });
          if (hold) await hold;
          if (fail) return resolve({ error: { code: '42501' }, data: null });
          if (denied) return resolve({ data: [] });
          const matched = rows.filter(r => Object.entries(filters).every(([k,v]) => r[k] === v));
          if (operation === 'delete') rows = rows.filter(r => !matched.includes(r));
          resolve({ data: clone(matched) });
        } }; return q;
    } });
    OS.flushMesaSceneRemoteSave = async () => { sceneWrites++; return true; };
    OS.loadMesaTokens = async () => { st.mesaTokens = clone(rows.filter(r => r.mapa_id === st.activeMapId)); OS.renderMesaMapTokens(); };
    document.body.classList.add('mesa-fullscreen-active'); OS.$('mesa-screen').style.display = '';
    OS.bindMapCameraEvents(); OS.bindMapCameraEvents(); OS.bindMesaSidebarResize(); OS.bindMesaSidebarResize();
    OS.switchMesaSidebarTab('fichas'); await tick(220);
    const syntheticMap = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#392f24"/><path d="M0 400H1000M500 0V800" stroke="#b58a50" stroke-width="4"/></svg>');
    st.mapaUrl=syntheticMap; OS.renderMesaMapStage(); await OS.$('mesa-map-image').decode();
    OS.syncMesaGridOverlay(); OS.renderMesaMapTokens();
    const panel = OS.$('mesa-sidebar-feed'), handle = OS.$('mesa-sidebar-resizer'), viewport = OS.$('mesa-map-viewport'), canvas = OS.$('mesa-map-canvas');
    const tokenNode = id => document.querySelector('.mesa-map-token[data-token-id="'+id+'"]');
    OS.mapCamera.zoom = 1.7; OS.mapCamera.panX = -47; OS.mapCamera.panY = 22; OS.applyMapCamera();
    const geometry = () => JSON.stringify({ metrics: OS.getMesaGridMetrics(), transform: canvas.style.transform, tokens: st.mesaTokens.map(t => [t.id,t.grid_x,t.grid_y]), left: tokenNode('p').style.left });
    const before = geometry(), width = panel.getBoundingClientRect().width;
    pointer(handle,'pointerdown',width,50); pointer(window,'pointermove',width+180,50);
    check(Math.abs(panel.getBoundingClientRect().width-(width-180))<1, 'MESA-01: arraste altera a largura pela borda esquerda');
    pointer(window,'pointerup',width+180,50);
    check(geometry()===before && calls.length===0, 'MESA-01: grade, tokens, câmera 1.7x e persistência de cena inalterados');
    check(Number(localStorage.getItem('oesteSombrio.mesa.sheetPanelWidth'))===width-180, 'MESA-01: preferência local persistida');
    const saved = panel.style.getPropertyValue('--mesa-sheet-panel-width');
    pointer(handle,'pointerdown',400,50); pointer(window,'pointermove',600,50); pointer(window,'pointercancel',600,50); await tick(220);
    check(panel.style.getPropertyValue('--mesa-sheet-panel-width')===saved && !panel.classList.contains('is-resizing'), 'MESA-01: cancelamento restaura largura e encerra arraste');
    key(handle,'Home'); await tick(220); check(Math.round(panel.getBoundingClientRect().width)===330, 'MESA-01: limite mínimo e teclado acessível');
    key(handle,'End'); await tick(220); check(Math.round(panel.getBoundingClientRect().width)===innerWidth-32, 'MESA-01: limite máximo conserva margem');
    const mobile = document.createElement('iframe'); mobile.style.cssText='width:320px;height:400px';
    mobile.srcdoc='<link rel="stylesheet" href="/style.css"><body class="mesa-fullscreen-active"><aside id="mesa-sidebar-feed" class="mesa-sidebar-feed is-fichas-expanded" style="--mesa-sheet-panel-width:1090px"></aside></body>';
    document.body.appendChild(mobile); await new Promise(r => mobile.onload=r);
    check(mobile.contentDocument.getElementById('mesa-sidebar-feed').getBoundingClientRect().width<=288, 'MESA-01: largura adaptada a viewport móvel de 320px'); mobile.remove();
    OS.switchMesaSidebarTab('chat'); await tick(220);
    check(Math.round(panel.getBoundingClientRect().width)===330 && getComputedStyle(handle).display==='none', 'MESA-01: Chat preserva largura original e oculta arraste');
    function select(id) { const el=tokenNode(id); pointer(el,'pointerdown',100,100); pointer(window,'pointerup',100,100); return el; }
    select('p'); check(OS.getSelectedMesaMapToken().id==='p' && tokenNode('p').classList.contains('is-selected'), 'MESA-02: clique seleciona sem mover nem gravar');
    OS.renderSingleMesaMapToken(st.mesaTokens[0]); check(tokenNode('p').classList.contains('is-selected'), 'MESA-02: atualização do token conserva seleção');
    OS.renderMesaMapTokens(); check(document.activeElement===tokenNode('p') && OS.getSelectedMesaMapToken().id==='p', 'MESA-02: recarga dos tokens conserva seleção e foco');
    const updatePosition=OS.updateMesaTokenPosition, moved=[];
    OS.updateMesaTokenPosition=async(id,x,y)=>{moved.push([id,x,y]);return {id};};
    const cell=OS.getMesaGridMetrics().cellPx;
    pointer(tokenNode('c1'),'pointerdown',100,100); pointer(window,'pointermove',100+cell*1.7,100); pointer(window,'pointerup',100+cell*1.7,100); await tick();
    tokenNode('c1').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0}));
    check(moved.length===1 && moved[0][1]===3 && st.gmPopups.length===0, 'MESA-01/03: arraste após resize respeita zoom e não abre ficha acidentalmente');
    OS.updateMesaTokenPosition=updatePosition; select('p');
    for (const tag of ['input','textarea','select','div']) {
      const input=document.createElement(tag); if(tag==='div') input.contentEditable='true'; viewport.appendChild(input); input.focus(); key(input); input.remove();
    }
    key(OS.$('chat-message-input') || document.body); key(viewport,'Delete',{repeat:true}); key(viewport,'Delete',{isComposing:true});
    await tick(); check(calls.length===0, 'MESA-02: digitação, composição, repetição e foco fora do mapa não removem');
    st.isMestre=false; st.currentUserId='player'; st.playerFichaId='sheet-a'; select('p'); key(tokenNode('p')); await tick();
    check(calls.length===0, 'MESA-02: jogador não exclui nem o próprio token');
    st.isMestre=true; st.currentUserId='gm'; denied=true; key(select('p')); await tick();
    check(st.mesaTokens.length===3 && OS.getSelectedMesaMapToken().id==='p', 'MESA-02: zero linhas afetadas mantém token e seleção');
    denied=false; fail=true; key(tokenNode('p')); await tick(); check(st.mesaTokens.length===3, 'MESA-02: erro do servidor mantém token'); fail=false;
    key(tokenNode('p')); await tick();
    check(st.mesaTokens.length===2 && rows.length===2 && !OS.getSelectedMesaMapToken(), 'MESA-02: exclusão confirmada remove só token selecionado');
    check(st.playerSheets.includes(player) && player.id==='sheet-a' && player.dados.nome==='Alice sintética', 'MESA-02: ficha original do jogador permanece após Delete');
    check(calls.filter(c=>c.operation==='delete').every(c=>c.table==='mesa_tokens' && c.filters.mesa_id==='room' && c.filters.mapa_id==='map' && c.filters.id==='p'), 'MESA-02: exclusão filtrada por mesa, mapa e ID');
    const count=calls.length; key(viewport); pointer(viewport,'pointerdown',0,0); key(viewport); await tick(); check(calls.length===count, 'MESA-02: sem seleção não há exclusão');
    const dbl = id => tokenNode(id).dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
    await tick(510);
    dbl('c1'); dbl('c2');
    check(st.gmPopups.length===2 && OS.resolveGmPopupTarget(st.gmPopups.find(p=>p.targetId==='two')).entity.data.defesa==='11', 'MESA-03: duas instâncias do mesmo NPC abrem fichas próprias');
    dbl('c2'); check(st.gmPopups.length===2, 'MESA-03: reabertura foca popup existente sem duplicar');
    const oldNode=tokenNode('c1'); st.activeMapId='other-map'; oldNode.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    check(st.gmPopups.length===2 && !OS.getSelectedMesaMapToken(), 'MESA-02/03: token DOM de mapa antigo não atua'); st.activeMapId='map';
    st.gmPopups=[]; st.isMestre=false; st.currentUserId='player'; st.playerFichaId='sheet-a';
    dbl('c1'); check(st.gmPopups.length===0 && !OS.resolveGmPopupTarget({targetType:'scene',targetId:'one'}), 'MESA-03: jogador não abre NPC mesmo com cache');
    check(!OS.openOrFocusPlayerPopup('sheet-b') && !OS.resolveGmPopupTarget({targetType:'player',targetId:'sheet-b'}), 'MESA-03: ficha alheia em cache não concede acesso');
    rows.push(makeToken('p','player','sheet-a')); await OS.loadMesaTokens(); dbl('p');
    check(st.gmPopups.length===1 && OS.resolveGmPopupTarget(st.gmPopups[0]).entity.id==='sheet-a', 'MESA-03: jogador abre a própria ficha vinculada');
    st.isMestre=true; st.currentUserId='gm'; st.gmPopups=[]; dbl('p'); check(st.gmPopups[0].targetId==='sheet-a', 'MESA-03: Xerife abre ficha de jogador pelo fluxo existente');
    // O renderer existente normaliza campos de 6B ao abrir; snapshot após essa normalização.
    const originals = JSON.stringify([player, other, template]);
    // Remover um token não apaga instância ainda usada em outro mapa, nem o NPC original.
    rows.push({...makeToken('c-other','creature','one'),mapa_id:'other-map'});
    key(select('c1')); await tick(); check(st.sceneCreatures.some(c=>c.instanceId==='one') && rows.some(r=>r.id==='c-other'), 'MESA-02: instância compartilhada permanece no outro mapa');
    key(select('c2')); await tick(); check(!st.sceneCreatures.some(c=>c.instanceId==='two') && sceneWrites===1, 'MESA-02: última ocorrência limpa somente a instância descartável');
    check(JSON.stringify([player,other,template])===originals && calls.every(c=>c.table==='mesa_tokens'), 'MESA-02: fichas e NPCs originais intactos');
    let release; hold=new Promise(r=>release=r); const pending=OS.removePlayerFromScene('sheet-a','p'); await tick(); st.activeMapId='other-map'; st.mesaTokens=[makeToken('new','player','sheet-a')]; hold=null; release();
    check(!(await pending) && st.mesaTokens[0].id==='new', 'MESA-02: resposta atrasada não remove token de outro mapa');
    OS.clearMesaMaps(); check(!st.selectedMapToken, 'MESA-02: sair da mesa limpa seleção');
    // Estado final legível para inspeção visual: mapa sintético, seleção e painel redimensionado.
    st.activeMapId='map'; st.mapaUrl=syntheticMap; st.gmPopups=[]; OS.renderMesaFloatingPopups();
    st.mesaTokens=[{...makeToken('preview','player','sheet-a'),grid_x:1,grid_y:2}];
    OS.renderMesaMapStage(); OS.selectMesaMapToken('preview');
    panel.style.setProperty('--mesa-sheet-panel-width','540px'); OS.switchMesaSidebarTab('fichas'); await tick(220);
    OS.openPlayerSheetReadOnlyForGm(player);
    const fullSheet=OS.$('ficha'), fullBefore=canvas.getBoundingClientRect().width;
    key(handle,'Home'); await tick(220);
    check(fullSheet.getBoundingClientRect().width<=OS.$('mesa-sheet-container').clientWidth+1 && canvas.getBoundingClientRect().width===fullBefore && OS.$('nome').value==='Alice sintética', 'MESA-01: ficha completa em painel de 330px conserva conteúdo e geometria do mapa');
    panel.style.setProperty('--mesa-sheet-panel-width','540px'); await tick(220);
    document.getElementById('result').style.cssText='position:fixed;bottom:0;left:0;max-height:44px;overflow:auto;z-index:99999;background:#17120f;color:white;font:11px monospace;white-space:pre-wrap';
    document.getElementById('result').textContent='PASS: '+results.length+' verificações\n'+results.join('\n');
  } catch(e) { document.getElementById('result').textContent='FAIL: '+e.stack+'\nPASS anteriores: '+results.join(' | '); }
};
const html = read('dist/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<pre id="result" style="position:fixed;left:0;top:0;pointer-events:none;z-index:99999;background:#17120f;color:white;font:11px monospace;white-space:pre-wrap">Executando…</pre><script type="module">('+test.toString()+')();</script></body>');
const server=http.createServer((req,res)=>{
  if(req.url==='/test'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const file=path.resolve(root,'dist','.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403);return res.end();}
  try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));} catch {res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1',async()=>{try {
  const result=await require('./browser-harness.cjs')('http://127.0.0.1:'+server.address().port+'/test',temp,path.join(temp,'mesa-p0.png'));
  console.log(result); fs.writeFileSync(path.join(temp,'results.txt'),result); console.log('Evidências: '+temp);
  if(!result.startsWith('PASS:'))process.exitCode=1;
} catch(e){console.error(e);process.exitCode=1;} finally {server.close();}});
