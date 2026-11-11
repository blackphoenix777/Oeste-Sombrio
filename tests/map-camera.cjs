// DOM/CSS/handlers reais em Chrome headless; nenhum acesso ao Supabase.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkwest-camera-'));
const index = read('dist/index.html');
const stage = index.slice(index.indexOf('          <section id="mesa-map-stage"'), index.indexOf('        </main>', index.indexOf('          <section id="mesa-map-stage"')));
const scripts = read('dist/js/mesaScreen.js').replace(/^import .*;\r?\n/gm, '');
const test = async function () {
  const results = [], check = (ok, name) => {if (!ok) throw Error(name); results.push(name);};
  const near = (a,b) => Math.abs(a-b) < 0.03;
  const pointer = (el, type, x, y, button=0, pointerId=1, buttons=button===2?2:1) => {
    el.dispatchEvent(new PointerEvent(type, {bubbles:true,cancelable:true,clientX:x,clientY:y,button,pointerId,buttons:type==='pointerup'?0:buttons}));
  };
  try {
    OS.$ = id => document.getElementById(id);
    let writes = 0, tokenWrites = [];
    OS.getSupabaseClient = () => {writes++; throw Error('Câmera tentou acessar o banco');};
    OS.scheduleMesaSceneSave = () => {writes++;};
    const st = OS.activeMesaState;
    Object.assign(st, {mesaId:'camera-test', isMestre:true, currentUserId:'gm', gridCols:10});
    const viewport = OS.$('mesa-map-viewport'), canvas = OS.$('mesa-map-canvas'), img = OS.$('mesa-map-image');
    img.hidden=false;
    img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#40352a"/><path d="M0 400H1000M500 0V800" stroke="#b29062" stroke-width="5"/></svg>');
    await img.decode(); canvas.classList.add('has-map'); OS.$('mesa-map-empty-state').hidden=true;
    OS.bindMapCameraEvents(); OS.bindMapCameraEvents(); OS.syncMesaGridOverlay();
    const c=OS.mapCamera, bounds=viewport.getBoundingClientRect();
    const toolbar=OS.$('mesa-map-toolbar'), toolbarBefore=toolbar.getBoundingClientRect();
    check(getComputedStyle(viewport).overflow==='hidden','viewport sem scroll automático');
    const controls=document.querySelector('.mesa-map-zoom-controls');
    check(controls.parentElement===OS.$('mesa-map-stage')&&!viewport.contains(controls),'controles fora do viewport');
    OS.$('btn-mesa-map-zoom-in').click(); check(c.zoom===1.25,'+ incrementa 0,25 e binding não duplica');
    OS.$('btn-mesa-map-zoom-out').click(); check(c.zoom===1,'− decrementa 0,25');
    OS.zoomMapCamera(50); check(c.zoom===3,'zoom máximo 3');
    OS.zoomMapCamera(0.01); check(c.zoom===0.25,'zoom mínimo 0,25');
    OS.$('btn-mesa-map-zoom-reset').click(); check(c.zoom===1&&c.panX===0&&c.panY===0,'100% restaura zoom e pan');
    c.panX=-100; c.panY=70; OS.applyMapCamera();
    const x=227,y=189, logicalX=(x-c.panX)/c.zoom, logicalY=(y-c.panY)/c.zoom;
    const wheel = new WheelEvent('wheel',{deltaY:-100,clientX:bounds.left+x,clientY:bounds.top+y,bubbles:true,cancelable:true});
    viewport.dispatchEvent(wheel);
    check(wheel.defaultPrevented&&c.zoom>1&&near((x-c.panX)/c.zoom,logicalX)&&near((y-c.panY)/c.zoom,logicalY),'wheel amplia mantendo ponto sob cursor');
    viewport.dispatchEvent(new WheelEvent('wheel',{deltaY:100,clientX:bounds.left+x,clientY:bounds.top+y,bubbles:true,cancelable:true}));
    check(near(c.zoom,1)&&near((x-c.panX)/c.zoom,logicalX),'wheel reduz mantendo ponto sob cursor');
    const menu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true}); viewport.dispatchEvent(menu);
    const outsideMenu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true}); toolbar.dispatchEvent(outsideMenu);
    check(menu.defaultPrevented&&!outsideMenu.defaultPrevented,'contextmenu bloqueado só no viewport');
    OS.resetMapCamera(); pointer(viewport,'pointerdown',100,100,2);
    pointer(window,'pointermove',170,45,2);
    check(c.isPanning&&c.panX===70&&c.panY===-55,'botão direito desloca livremente');
    pointer(window,'pointerup',170,45,2); check(!c.isPanning,'pointerup encerra pan');
    pointer(viewport,'pointerdown',100,100,2); pointer(window,'pointercancel',100,100,2); check(!c.isPanning,'pointercancel encerra pan');
    pointer(viewport,'pointerdown',100,100,2); viewport.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:1})); check(!c.isPanning,'perda de captura encerra pan');
    OS.$('btn-mesa-map-zoom-fit').click();
    check(canvas.offsetWidth*c.zoom<=viewport.clientWidth+0.1&&canvas.offsetHeight*c.zoom<=viewport.clientHeight+0.1&&
      near(c.panX,(viewport.clientWidth-canvas.offsetWidth*c.zoom)/2)&&near(c.panY,(viewport.clientHeight-canvas.offsetHeight*c.zoom)/2),'Ajustar enquadra e centraliza imagem inteira');
    OS.updateMesaTokenPosition=async(id,gx,gy)=>{tokenWrites.push({id,gx,gy}); return true;};
    for (const zoom of [2,0.5]) {
      OS.resetMapCamera(); c.zoom=zoom; c.panX=-137;c.panY=63;OS.applyMapCamera();
      const token={id:'t',mesa_id:st.mesaId,owner_type:'creature',owner_ref:'i',display_name:'Teste',grid_x:2,grid_y:2,visible_to_players:true};
      st.mesaTokens=[token]; OS.renderMesaMapTokens();
      const el=document.querySelector('.mesa-map-token'), metrics=OS.getMesaGridMetrics(), cell=metrics.cellPx;
      check(near(cell,canvas.clientWidth/10),'célula lógica independente do zoom '+zoom);
      const r=el.getBoundingClientRect(), sx=r.left+r.width/2,sy=r.top+r.height/2;
      pointer(el,'pointerdown',sx,sy);
      const frozen=JSON.stringify(c); OS.zoomMapCamera(1.75); OS.resetMapCamera(); OS.fitMapCamera();
      pointer(viewport,'pointerdown',sx,sy,2,2);
      check(JSON.stringify(c)===frozen,'câmera congelada durante arraste '+zoom);
      pointer(window,'pointermove',sx+cell*zoom*2,sy+cell*zoom,0,2);
      check(near(parseFloat(el.style.left),2*cell),'outro ponteiro não move token '+zoom);
      pointer(window,'pointerup',sx,sy,0,2);
      check(st.isDraggingLocal,'outro ponteiro não encerra token '+zoom);
      pointer(window,'pointermove',sx+cell*zoom*2,sy+cell*zoom);
      const moved=el.getBoundingClientRect();
      check(near(moved.left-r.left,cell*zoom*2)&&near(moved.top-r.top,cell*zoom),'token acompanha deslocamento do cursor '+zoom);
      pointer(window,'pointerup',sx+cell*zoom*2,sy+cell*zoom);
      await Promise.resolve();
      check(token.grid_x===4&&token.grid_y===3&&tokenWrites.at(-1).gx===4&&tokenWrites.at(-1).gy===3,'snap e persistência correta em '+zoom);
      pointer(el,'pointerdown',sx,sy);pointer(window,'pointermove',sx+cell*zoom,sy);
      const count=tokenWrites.length;pointer(window,'pointercancel',sx,sy);
      check(!st.isDraggingLocal&&tokenWrites.length===count&&near(parseFloat(el.style.left),4*cell),'cancelamento restaura token sem gravar '+zoom);
      pointer(el,'pointerdown',sx,sy,2); pointer(el,'pointerdown',sx,sy,0,2);
      check(c.isPanning&&!st.isDraggingLocal,'pan sobre token não inicia arraste '+zoom);OS.stopMapPan();
    }
    check(near(toolbar.getBoundingClientRect().top,toolbarBefore.top)&&near(toolbar.getBoundingClientRect().width,toolbarBefore.width),'toolbar imune à câmera');
    OS.resetMapCamera();
    const hub=OS.$('mesa-popups-hub');hub.hidden=false;
    OS.$('mesa-map-stage').style.width='400px';OS.positionMapCameraControls();
    check(controls.getBoundingClientRect().bottom<hub.getBoundingClientRect().top,'controles evitam hub em área estreita');
    hub.hidden=true;OS.$('mesa-map-stage').style.width='800px';OS.positionMapCameraControls();
    const frame=document.createElement('iframe');document.body.append(frame);
    frame.contentWindow.eval(document.getElementById('production-code').textContent);
    const player=frame.contentWindow.OS;player.$=()=>null;
    OS.zoomMapCamera(2);check(player.mapCamera.zoom===1&&player.mapCamera.panX===0,'segunda sessão mantém câmera independente');
    player.mapCamera.panX=99; check(c.panX!==99,'pan do jogador não altera câmera do Mestre');frame.remove();
    check(writes===0,'ações de câmera não acessam banco nem persistência de cena');
    OS.resetMapCamera();check(c.zoom===1&&c.panX===0&&c.panY===0,'reset de ciclo da mesa restaura câmera');
    OS.fitMapCamera();
    document.getElementById('result').textContent='PASS: '+results.length+' verificações | '+results.join(' | ');
  } catch(e) {document.getElementById('result').textContent='FAIL: '+e.stack;}
};
const html='<!doctype html><meta charset="utf-8"><style>'+read('dist/style.css')+'</style><style>body{margin:0;padding:0;background:#17120f}#mesa-map-stage{position:absolute;left:20px;top:20px;width:800px;height:650px}#mesa-map-toolbar{display:flex}#result{position:absolute;top:680px;color:white;font:12px monospace;white-space:pre-wrap}#mesa-popups-hub{position:fixed;left:16px;top:550px;bottom:auto;width:310px;height:120px;background:#35261f}iframe{display:none}</style>'+stage+
  '<div id="mesa-popups-hub" hidden>Hub</div><pre id="result">Executando...</pre><script id="production-code">var OS={};'+scripts+'</script><script>('+test.toString()+')();</script>';
const file=path.join(temp,'camera.html');fs.writeFileSync(file,html);
const screenshot=path.join(temp,'camera.png');
const output=execFileSync(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
 ['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(temp,'profile'),'--window-size=1100,1000','--virtual-time-budget=5000','--screenshot='+screenshot,'--dump-dom','file:///'+file.replaceAll('\\','/')],
 {timeout:45000,maxBuffer:8*1024*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const result=output.match(/<pre\b[^>]*\bid="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
console.log(result||'FAIL: resultado ausente');console.log('Screenshot: '+screenshot);
if(!result?.startsWith('PASS:'))process.exitCode=1;
