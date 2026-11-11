import { OS } from "./app.js";

function mapStatus(message, error) {
  var el = OS.$("mesa-map-upload-status");
  if (el) { el.hidden = !message; el.textContent = message || ""; el.className = "mesa-map-upload-status" + (error ? " is-error" : ""); }
}
OS.clearMesaMaps = function () {
  var st = OS.activeMesaState;
  st._mapReadId = (st._mapReadId || 0) + 1;
  st._tokenReadId = (st._tokenReadId || 0) + 1;
  if (OS.cancelMapTokenDrag) OS.cancelMapTokenDrag();
  OS.stopMapPan();
  if (st._mapBlobUrl) URL.revokeObjectURL(st._mapBlobUrl);
  st._mapBlobUrl = null; st._mapAssetKey = null; st.activeMapId = null;
  st.mapas = []; st.mapCameras = {}; st.mapRevision = -1; st.playerMapId = null;
  st.mapaUrl = ""; st.mesaTokens = [];
  var dialog = OS.$("mesa-map-settings"); if (dialog && dialog.open) dialog.close();
};

OS.getViewedMesaMap = function () {
  var st = OS.activeMesaState;
  return (st.mapas || []).find(function (m) { return m.id === st.activeMapId; });
};

OS.mapStoragePath = function (map) {
  if (!map) return "";
  if (map.storage_path) return map.storage_path;
  var url = String(map.url || "");
  var match = url.match(/\/object\/(?:public|authenticated)\/mesa-maps\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : (/^[0-9a-f-]{36}\/slot_[1-4]\./i.test(url) ? url.split("?")[0] : "");
};

// Uma resposta contém mapa + tokens da mesma fotografia do banco. Respostas antigas não cruzam abas.
OS.loadMesaMapView = async function (mapId, options) {
  options = options || {};
  var st = OS.activeMesaState, room = st.mesaId;
  if (!room) return [];
  st.mapCameras = st.mapCameras || {};
  var client = OS.getSupabaseClient(), request = st._mapReadId = (st._mapReadId || 0) + 1;
  var map, rows, snapshot, changed, oldMapId = st.activeMapId;
  try {
    if (st.isMestre) {
      if (options.refresh || !st.mapas || !st.mapas.length) {
        var roomRes = await client.from("mesas").select("mapas,mapa_ativo_jogadores_id").eq("id", room).single();
        if (roomRes.error) throw roomRes.error;
        if (st.mesaId !== room || st._mapReadId !== request) return [];
        st.mapas = roomRes.data.mapas; st.playerMapId = roomRes.data.mapa_ativo_jogadores_id;
      }
      map = st.mapas.find(function (m) { return m.id === (mapId || st.activeMapId); }) || st.mapas[0];
      if (!map) throw Error("Esta mesa não possui mapa válido.");
      var tokenRes = await client.from("mesa_tokens").select("*").eq("mesa_id", room).eq("mapa_id", map.id).order("created_at", { ascending: true });
      if (tokenRes.error) throw tokenRes.error;
      rows = tokenRes.data || [];
    } else {
      var res = await client.rpc("obter_mapa_publico", { p_mesa_id: room });
      if (res.error) throw res.error;
      snapshot = res.data; map = snapshot.mapa; rows = snapshot.tokens || [];
      if (!map) throw Error("Mapa indisponível.");
      rows = rows.map(function (t) { return Object.assign({}, t, { id: t.token_id, mesa_id: room, mapa_id: map.id }); });
    }
    if (st.mesaId !== room || st._mapReadId !== request) return [];
    changed = oldMapId !== map.id;
    if (changed && oldMapId) st.mapCameras[oldMapId] = { zoom: OS.mapCamera.zoom, panX: OS.mapCamera.panX, panY: OS.mapCamera.panY };
    if (changed) {
      if (OS.cancelMapTokenDrag) OS.cancelMapTokenDrag();
      OS.stopMapPan();
      // Retira a cena anterior antes do download; nenhum token antigo aparece sobre o novo mapa.
      st.mesaTokens = []; st.mapaUrl = ""; OS.renderMesaMapStage();
    }
    var assetKey = map.id + "|" + (map.url || ""), blobUrl = st._mapBlobUrl;
    if (assetKey !== st._mapAssetKey) {
      blobUrl = "";
      var path = OS.mapStoragePath(map);
      if (path) {
        var download = await client.storage.from("mesa-maps").download(path, { cacheNonce: String(map.url || "") + "|" + Date.now() }, { cache: "no-store" });
        if (download.error) throw download.error;
        blobUrl = URL.createObjectURL(download.data);
        var preload = new Image(); preload.src = blobUrl;
        try { await preload.decode(); } catch (decodeError) { URL.revokeObjectURL(blobUrl); throw decodeError; }
      } else if (map.url) throw Error("Imagem legada fora do Storage: envie a imagem novamente neste slot.");
      if (st.mesaId !== room || st._mapReadId !== request) { if (blobUrl) URL.revokeObjectURL(blobUrl); return []; }
      if (st._mapBlobUrl) URL.revokeObjectURL(st._mapBlobUrl);
      st._mapBlobUrl = blobUrl; st._mapAssetKey = assetKey;
    }
    if (st.mesaId !== room || st._mapReadId !== request) return [];
    if (snapshot) { st.mapas = [map]; st.playerMapId = map.id; st.mapRevision = snapshot.revisao; }
    st.activeMapId = map.id; st.mapaUrl = blobUrl || ""; st.gridCols = Number(map.grid_cols) || 24;
    // Refresh da mesma cena preserva a prévia/eco de movimentação local.
    rows.forEach(function (t) {
      t.iniciativa = OS.normalizeMesaInitiative(t.iniciativa);
      var old = st.mesaTokens.find(function (v) { return v.id === t.id; });
      if (!changed && old && ((st.isDraggingLocal && st.draggingTokenId === t.id) || st.pendingLocalTokenUpdates[t.id])) {
        t.grid_x = old.grid_x; t.grid_y = old.grid_y;
      }
    });
    st.mesaTokens = rows; st._tokensLoadedOk = true;
    if (changed) st.tokenStatus = {};
    if (OS.loadMesaTokenStatus) await OS.loadMesaTokenStatus();
    if (st.mesaId !== room || st._mapReadId !== request) return [];
    OS.renderMesaMapStage(); OS.renderMesaMapTabs(); OS.renderMesaSceneCards(); OS.renderMesaPlayersCards();
    OS.dispatchMesaCombatantsChange();
    if (changed) {
      var saved = st.isMestre && st.mapCameras[map.id];
      if (saved) { Object.assign(OS.mapCamera, saved); OS.applyMapCamera(); }
      else {
        OS.resetMapCamera();
        var image = OS.$("mesa-map-image");
        if (image && st.mapaUrl) { try { await image.decode(); } catch (_) { /* será indicado pelo backdrop */ } }
        if (st.mesaId === room && st._mapReadId === request) OS.fitMapCamera();
      }
    }
    if (OS.loadMesaCombat) await OS.loadMesaCombat();
    return rows;
  } catch (error) {
    if (st.mesaId !== room || st._mapReadId !== request) return [];
    if (changed || !st.isMestre) { st.mesaTokens = []; st.mapaUrl = ""; OS.renderMesaMapStage(); }
    st._tokensLoadedOk = false; mapStatus("Falha ao carregar mapa: " + error.message, true);
    console.warn("[mapas]", error); return [];
  }
};

OS.changeMesaMap = async function (mapId) {
  if (!OS.activeMesaState.isMestre) return;
  await OS.loadMesaMapView(mapId);
};
OS.mutateMesaMap = async function (action, mapId, data) {
  var st = OS.activeMesaState, room = st.mesaId;
  if (!st.isMestre || !room) throw Error("Apenas o Mestre pode gerenciar mapas.");
  var res = await OS.getSupabaseClient().rpc("gerenciar_mapas", { p_mesa_id: room, p_acao: action, p_mapa_id: mapId || null, p_dados: data || {} });
  if (res.error) throw res.error;
  if (st.mesaId === room) {
    st.mapas = res.data.mapas; st.playerMapId = res.data.mapa_ativo_jogadores_id;
    if (st.mesa) Object.assign(st.mesa, res.data);
    OS.renderMesaMapTabs();
  }
  return res.data;
};
OS.setMesaGridCols = async function (value) {
  var st = OS.activeMesaState, id = st.activeMapId;
  if (!st.isMestre || !id) return st.gridCols;
  var cols = Math.max(4, Math.min(64, parseInt(value, 10) || 24));
  try {
    await OS.mutateMesaMap("editar", id, { grid_cols: cols });
    if (st.activeMapId === id) { st.gridCols = cols; OS.syncMesaGridOverlay(); }
  } catch (error) { mapStatus(error.message, true); }
  return st.gridCols;
};
OS.uploadMesaMapFile = async function (file, slotNumber, mapaId) {
  var st = OS.activeMesaState, room = st.mesaId;
  if (!file || !st.isMestre || !room || st._mapUploading) return null;
  var map = (st.mapas || []).find(function (m) { return m.id === (mapaId || st.activeMapId); });
  if (!map || (slotNumber != null && Number(slotNumber) !== map.slot)) { mapStatus("Selecione um slot válido antes do envio.", true); return null; }
  var ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[file.type];
  if (!ext || file.size > 40 * 1024 * 1024) { mapStatus("Envie JPG, PNG, WEBP ou GIF de até 40 MB.", true); return null; }
  var path = room + "/slot_" + map.slot + "." + ext;
  st._mapUploading = true; mapStatus("Enviando mapa…");
  try {
    var client = OS.getSupabaseClient();
    var res = await client.storage.from("mesa-maps").upload(path, file, { upsert: true, contentType: file.type, cacheControl: "0" });
    if (res.error) throw res.error;
    // Nenhuma listagem/exclusão em massa. Extensões antigas ficam privadas e inacessíveis aos jogadores.
    var url = path + "?t=" + Date.now();
    var saved = await client.rpc("gerenciar_mapas", { p_mesa_id: room, p_acao: "editar", p_mapa_id: map.id,
      p_dados: { url: url, storage_path: path } });
    if (saved.error) throw saved.error;
    if (st.mesaId === room) {
      st.mapas = saved.data.mapas; st.playerMapId = saved.data.mapa_ativo_jogadores_id;
      if (st.activeMapId === map.id) await OS.loadMesaMapView(map.id);
      OS.renderMesaMapTabs(); mapStatus("✓ Mapa atualizado!");
    }
    return url;
  } catch (error) { if (st.mesaId === room) mapStatus(error.message, true); return null; }
  finally { st._mapUploading = false; }
};

OS.renderMesaMapTabs = function () {
  var st = OS.activeMesaState, nav = OS.$("mesa-map-tabs");
  if (!nav) return;
  nav.hidden = !st.isMestre; nav.replaceChildren();
  if (!st.isMestre) return;
  (st.mapas || []).forEach(function (map) {
    var tab = document.createElement("div"); tab.className = "mesa-map-tab" + (map.id === st.activeMapId ? " is-selected" : "");
    var select = document.createElement("button"); select.type = "button"; select.className = "btn btn-secondary btn-small";
    select.textContent = map.nome + " · " + map.grid_cols + " col"; select.setAttribute("aria-pressed", String(map.id === st.activeMapId));
    select.onclick = function () { OS.changeMesaMap(map.id); }; tab.append(select);
    var edit = document.createElement("button"); edit.type = "button"; edit.className = "btn btn-secondary btn-small"; edit.textContent = "⚙";
    edit.setAttribute("aria-label", "Configurar " + map.nome); edit.onclick = function () { OS.openMesaMapSettings(map.id); }; tab.append(edit);
    var flag = document.createElement("button"); flag.type = "button"; flag.className = "btn btn-secondary btn-small mesa-map-flag";
    flag.textContent = map.id === st.playerMapId ? "🚩 Jogadores" : "🚩 Mover jogadores";
    flag.disabled = map.id === st.playerMapId; flag.onclick = function () { OS.openMesaMapSettings(map.id, "flamula"); }; tab.append(flag);
    nav.append(tab);
  });
  if ((st.mapas || []).length < 4) {
    var add = document.createElement("button"); add.type = "button"; add.className = "btn btn-secondary btn-small"; add.textContent = "+ Adicionar mapa";
    add.onclick = async function () {
      add.disabled = true;
      try { var saved = await OS.mutateMesaMap("adicionar"); await OS.changeMesaMap(saved.mapa_id); }
      catch (error) { mapStatus(error.message, true); add.disabled = false; }
    }; nav.append(add);
  }
  OS.positionMapCameraControls();
};

OS.openMesaMapSettings = function (id, action) {
  var map = OS.activeMesaState.mapas.find(function (m) { return m.id === id; });
  if (!map || !OS.activeMesaState.isMestre) return;
  var dialog = OS.$("mesa-map-settings"); dialog.dataset.mapId = id; dialog.dataset.roomId = OS.activeMesaState.mesaId;
  dialog.dataset.action = action || "editar";
  OS.$("mesa-map-settings-title").textContent = action === "flamula" ? "Mover jogadores para “" + map.nome + "”?" : "Configurar mapa";
  OS.$("mesa-map-name").value = map.nome;
  OS.$("mesa-map-name-label").hidden = action === "flamula";
  OS.$("mesa-map-delete").hidden = action === "flamula" || OS.activeMesaState.mapas.length <= 1;
  OS.$("mesa-map-settings-error").textContent = "";
  dialog.showModal();
};
OS.bindMesaMapEvents = function () {
  var dialog = OS.$("mesa-map-settings"); if (!dialog || dialog._mapsBound) return; dialog._mapsBound = true;
  OS.$("mesa-map-cancel").onclick = function () { dialog.close(); };
  OS.$("mesa-map-delete").onclick = function () {
    dialog.dataset.action = "excluir";
    OS.$("mesa-map-settings-title").textContent = "Excluir este mapa e seus tokens? Fichas e outros mapas serão preservados.";
    OS.$("mesa-map-name-label").hidden = true; OS.$("mesa-map-delete").hidden = true;
  };
  OS.$("mesa-map-confirm").onclick = async function () {
    if (dialog.dataset.roomId !== OS.activeMesaState.mesaId) { dialog.close(); return; }
    var button = OS.$("mesa-map-confirm"); button.disabled = true;
    try {
      var action = dialog.dataset.action, id = dialog.dataset.mapId;
      await OS.mutateMesaMap(action, id, action === "editar" ? { nome: OS.$("mesa-map-name").value } : {});
      dialog.close(); await OS.loadMesaMapView(OS.activeMesaState.activeMapId);
    } catch (error) { OS.$("mesa-map-settings-error").textContent = error.message; }
    finally { button.disabled = false; }
  };
};
