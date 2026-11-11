import { OS } from "./app.js";

// Estado de apresentação é local; ações e ordem são autoritativas no servidor.
var tracker = { mesaId: null, revision: -1, request: 0, minimized: false, busy: false, position: null, error: "" };
var $combat = function (id) { return OS.$(id); };
var combatEscape = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
}); };
function closeCombatDialog(id) { var el = $combat(id); if (el && el.open) el.close(); }

OS.resetMesaCombat = function () {
  tracker.mesaId = null; tracker.revision = -1; tracker.request++;
  tracker.minimized = false; tracker.busy = false; tracker.position = null; tracker.error = "";
  OS.activeMesaState.combateAtivo = null;
  closeCombatDialog("modal-setup-combate"); closeCombatDialog("modal-end-combate");
  OS.renderMesaCombat();
};

OS.acceptMesaCombatSnapshot = function (mesaId, snapshot) {
  var st = OS.activeMesaState;
  if (st.mesaId !== mesaId || !snapshot || Number(snapshot.revisao) < tracker.revision) return;
  var before = st.combateAtivo;
  var next = snapshot.combate || null;
  tracker.revision = Number(snapshot.revisao) || 0;
  st.combateAtivo = next;
  if (next && (!before || before.id !== next.id)) {
    tracker.minimized = false; tracker.position = null;
    closeCombatDialog("modal-setup-combate");
    closeCombatDialog("modal-end-combate");
  }
  if (!next) { tracker.minimized = false; closeCombatDialog("modal-end-combate"); }
  OS.renderMesaCombat();
  if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
};

OS.loadMesaCombat = async function () {
  var st = OS.activeMesaState, mesaId = st && st.mesaId;
  if (!mesaId) return;
  if (tracker.mesaId !== mesaId) { OS.resetMesaCombat(); tracker.mesaId = mesaId; }
  var client = OS.getSupabaseClient && OS.getSupabaseClient();
  if (!client) return;
  var request = ++tracker.request;
  try {
    var res = await client.rpc("obter_combate_publico", { p_mesa_id: mesaId });
    if (st.mesaId !== mesaId || request !== tracker.request) return;
    if (res.error) throw res.error;
    tracker.error = "";
    OS.acceptMesaCombatSnapshot(mesaId, res.data);
  } catch (e) {
    if (st.mesaId !== mesaId || request !== tracker.request) return;
    // Uma sessão que perdeu acesso não conserva o resumo antigo na interface.
    if (e.code === "42501" || e.code === "PGRST301") st.combateAtivo = null;
    tracker.error = "Não foi possível atualizar o combate. Tente atualizar a mesa.";
    OS.renderMesaCombat();
    console.warn("[TurnTracker]", e);
  }
};

OS.runMesaCombatAction = async function (action, extra) {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre || tracker.busy) return false;
  var mesaId = st.mesaId, state = st.combateAtivo;
  var client = OS.getSupabaseClient && OS.getSupabaseClient();
  if (!client) return false;
  tracker.busy = true; tracker.error = ""; OS.renderMesaCombat();
  try {
    var args = Object.assign({ p_mesa_id: mesaId, p_acao: action,
      p_versao: state ? state.versao : null, p_combate_id: state ? state.id : null }, extra || {});
    var res = await client.rpc("gerenciar_combate", args);
    if (res.error) throw res.error;
    if (st.mesaId === mesaId) OS.acceptMesaCombatSnapshot(mesaId, res.data);
    return true;
  } catch (e) {
    if (st.mesaId === mesaId) {
      if (e.code === "40001") await OS.loadMesaCombat();
      tracker.error = e.message || "Não foi possível salvar a ação. Tente novamente.";
    }
    return false;
  } finally {
    if (st.mesaId === mesaId) { tracker.busy = false; OS.renderMesaCombat(); }
  }
};

OS.getCombatTokenMode = function (token) {
  if (token.owner_type === "player") return "ficha";
  var st = OS.activeMesaState;
  var instance = (st.sceneCreatures || []).find(function (c) { return c.instanceId === token.owner_ref; });
  if (!instance) return "ficha";
  var source = (st.npcsMesa || []).find(function (c) { return c.mesaNpcId === instance.sourceId; });
  var official = OS.bestiaryCatalog.byId[(source && source.sourceId) || instance.sourceId];
  var category = String(instance.sourceCategory || (source && source.sourceCategory) || (official && official.category) || "").toLowerCase();
  var data = instance.data || {};
  if (category === "npc" || data.tipo_ficha === "npc" || data.isBestiaryCustom || instance.sourceType !== "oficial") return "ficha";
  return "cascata";
};

OS.openCombatSetup = async function () {
  var st = OS.activeMesaState;
  if (!st.isMestre || !st.mesaId || tracker.busy) return;
  if (st.combateAtivo) { OS.openMesaCombatTracker(); return; }
  var mesaId = st.mesaId;
  await Promise.all([OS.loadMesaTokens(mesaId), OS.loadMesaCombat(), OS.loadOfficialBestiary().catch(function () {})]);
  if (st.mesaId !== mesaId || !st.isMestre) return;
  if (st.combateAtivo) { OS.openMesaCombatTracker(); return; }
  var list = $combat("combat-setup-list");
  list.innerHTML = "";
  (st.mesaTokens || []).forEach(function (token, index) {
    var mode = OS.getCombatTokenMode(token), player = token.owner_type === "player";
    var row = document.createElement("div"); row.className = "combat-setup-row"; row.dataset.tokenId = token.id;
    row.innerHTML = '<label class="combat-setup-name"><input type="checkbox" class="combat-include" checked> <span>' +
      combatEscape(token.display_name) + (token.visible_to_players ? "" : " · oculto") + '</span></label>' +
      '<span class="combat-setup-score">Ficha: ' + OS.normalizeMesaInitiative(token.iniciativa) + '</span>' +
      '<label>Iniciativa <select class="combat-mode"' + (player ? " disabled" : "") + '>' +
      '<option value="ficha"' + (mode === "ficha" ? " selected" : "") + '>Usar Iniciativa da Ficha</option>' +
      '<option value="cascata"' + (mode === "cascata" ? " selected" : "") + '>Entrar na Cascata do Bestiário</option></select></label>' +
      '<label class="combat-priority-label">Prioridade <input class="combat-priority" type="number" min="1" max="200" step="1" value="' + (index + 1) + '"></label>';
    function update() {
      var cascade = row.querySelector(".combat-mode").value === "cascata";
      row.querySelector(".combat-priority-label").hidden = !cascade;
      row.querySelector(".combat-priority").disabled = !cascade || !row.querySelector(".combat-include").checked;
    }
    row.addEventListener("change", update); update(); list.appendChild(row);
  });
  tracker.error = "";
  if (!st.mesaTokens.length) list.textContent = "Coloque pelo menos uma entidade em cena para iniciar o combate.";
  OS.renderMesaCombat();
  $combat("modal-setup-combate").showModal();
};

OS.appendCombatJoinButton = function (container, token) {
  var st = OS.activeMesaState, state = st.combateAtivo;
  if (state && state.mapa_id && token && token.mapa_id !== state.mapa_id) return;
  if (!container || !token || !st.isMestre || !state || state.ordem.some(function (c) { return c.token_id === token.id; })) return;
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "btn btn-secondary btn-small combat-join";
  btn.textContent = "Adicionar ao Combate Ativo"; btn.disabled = tracker.busy;
  btn.addEventListener("click", async function () {
    OS.openMesaCombatTracker();
    await OS.runMesaCombatAction("adicionar", { p_token_id: token.id });
  });
  container.appendChild(btn);
};

OS.openMesaCombatTracker = function () {
  tracker.minimized = false; OS.renderMesaCombat();
  var header = $combat("mesa-tracker-drag"); if (header) header.focus({ preventScroll: true });
};

OS.positionMesaCombatTracker = function () {
  var panel = $combat("mesa-turn-tracker"); if (!panel || panel.hidden) return;
  if (!tracker.position) {
    var map = $combat("mesa-map-stage"), rect = map && map.getBoundingClientRect();
    tracker.position = { x: rect ? rect.left + 12 : 16, y: rect ? rect.top + 12 : 88 };
  }
  tracker.position.x = Math.max(8, Math.min(tracker.position.x, window.innerWidth - panel.offsetWidth - 8));
  tracker.position.y = Math.max(8, Math.min(tracker.position.y, window.innerHeight - Math.min(panel.offsetHeight, window.innerHeight - 16) - 8));
  panel.style.left = tracker.position.x + "px"; panel.style.top = tracker.position.y + "px";
};

OS.renderMesaCombat = function () {
  var st = OS.activeMesaState, state = st && st.combateAtivo;
  var panel = $combat("mesa-turn-tracker"); if (!panel) return;
  var active = !!(st.mesaId && state && state.ativo);
  panel.hidden = !active || tracker.minimized;
  $combat("btn-mesa-combat-open").hidden = !active;
  $combat("btn-mesa-start-combat").textContent = active ? "⚔️ Abrir Tracker" : "⚔️ Iniciar Combate";
  $combat("btn-mesa-start-combat").disabled = tracker.busy;
  ["combat-setup-error", "combat-end-error", "mesa-tracker-feedback"].forEach(function (id) { $combat(id).textContent = tracker.error; });
  ["btn-combat-confirm", "btn-combat-end-confirm", "btn-tracker-next", "btn-tracker-end"].forEach(function (id) { $combat(id).disabled = tracker.busy; });
  if (!active) return;
  $combat("mesa-tracker-round").textContent = "⚔️ Round " + state.round;
  $combat("btn-tracker-end").hidden = !st.isMestre;
  $combat("mesa-tracker-footer").hidden = !st.isMestre;
  $combat("btn-tracker-next").disabled = tracker.busy || !state.ordem.length;
  var current = state.ordem[state.turno_atual_idx];
  $combat("mesa-tracker-current").textContent = current ? "Vez de " + current.name :
    state.turno_oculto ? "Aguardando o Mestre" : "Nenhum participante em cena.";
  var list = $combat("mesa-tracker-order"); list.innerHTML = "";
  state.ordem.forEach(function (c, index) {
    var li = document.createElement("li"); li.className = "mesa-tracker-combatant";
    li.dataset.tokenId = c.token_id;
    if (index === state.turno_atual_idx) { li.classList.add("is-current"); li.setAttribute("aria-current", "step"); }
    var portrait = document.createElement("span"); portrait.className = "mesa-tracker-portrait"; portrait.textContent = c.owner_type === "player" ? "🤠" : "☠";
    if (c.image_url && /^(https?:|data:image\/|blob:|asset:)/i.test(c.image_url)) {
      var img = document.createElement("img"); img.src = c.image_url; img.alt = "";
      img.addEventListener("error", function () { img.remove(); }); portrait.appendChild(img);
    }
    var label = document.createElement("span"); label.className = "mesa-tracker-name"; label.textContent = c.name;
    var note = document.createElement("small");
    note.textContent = (st.isMestre && !c.visible_to_players ? "🙈 Oculto · " : "") +
      (c.entrou_no_meio ? "Entrou nesta rodada" : c.iniciativa_fonte === "cascata" ? "Cascata" : c.iniciativa_fonte === "fixa" ? "Iniciativa fixa" : "Iniciativa da ficha");
    label.appendChild(note);
    var score = document.createElement("strong"); score.className = "mesa-tracker-score"; score.textContent = c.iniciativa;
    li.append(portrait, label, score); list.appendChild(li);
  });
  if (st.isMestre && state.cascata_total && !tracker.error) $combat("mesa-tracker-feedback").textContent =
    "Cascata inicial: d20 (" + state.cascata_d20 + ") + " + state.cascata_total + ".";
  OS.positionMesaCombatTracker();
};

OS.bindTurnTrackerEvents = function () {
  var setup = $combat("modal-setup-combate"); if (!setup || setup.dataset.bound) return; setup.dataset.bound = "true";
  $combat("btn-mesa-start-combat").addEventListener("click", OS.openCombatSetup);
  $combat("btn-mesa-combat-open").addEventListener("click", OS.openMesaCombatTracker);
  $combat("btn-tracker-minimize").addEventListener("click", function () { tracker.minimized = true; OS.renderMesaCombat(); $combat("btn-mesa-combat-open").focus(); });
  $combat("btn-combat-setup-cancel").addEventListener("click", function () { if (!tracker.busy) setup.close(); });
  $combat("form-setup-combate").addEventListener("submit", async function (e) {
    e.preventDefault();
    var selected = [], priorities = new Set();
    var duplicate = false;
    setup.querySelectorAll(".combat-setup-row").forEach(function (row) {
      if (!row.querySelector(".combat-include").checked) return;
      var mode = row.querySelector(".combat-mode").value, priority = Number(row.querySelector(".combat-priority").value);
      if (mode === "cascata") { if (priorities.has(priority)) duplicate = true; priorities.add(priority); }
      selected.push({ token_id: row.dataset.tokenId, modo: mode, prioridade: priority });
    });
    if (!selected.length || duplicate) {
      tracker.error = duplicate ? "Use prioridades diferentes para os monstros da cascata." : "Selecione pelo menos um participante.";
      OS.renderMesaCombat(); return;
    }
    await OS.runMesaCombatAction("iniciar", { p_participantes: selected });
  });
  $combat("btn-tracker-next").addEventListener("click", function () { OS.runMesaCombatAction("proximo"); });
  $combat("btn-tracker-end").addEventListener("click", function () {
    tracker.error = ""; OS.renderMesaCombat(); $combat("modal-end-combate").showModal();
  });
  $combat("btn-combat-end-cancel").addEventListener("click", function () { if (!tracker.busy) closeCombatDialog("modal-end-combate"); });
  $combat("btn-combat-end-confirm").addEventListener("click", function () { OS.runMesaCombatAction("encerrar"); });
  [setup, $combat("modal-end-combate")].forEach(function (dialog) { dialog.addEventListener("cancel", function (e) { if (tracker.busy) e.preventDefault(); }); });
  var header = $combat("mesa-tracker-drag"), drag = null;
  header.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault(); var rect = $combat("mesa-turn-tracker").getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    tracker.position = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; OS.positionMesaCombatTracker();
  });
  function endDrag(e) { if (!drag || drag.id !== e.pointerId) return; drag = null; if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId); }
  header.addEventListener("pointerup", endDrag); header.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", OS.positionMesaCombatTracker);
};
