import { OS } from "./app.js";

// Somente projeção: resultados autoritativos vêm de RPC, nunca de cena_ativa/fichas.
// Nenhum resultado (aberto ou secreto) é persistido no navegador.
let session = null;
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function current(s) {
  const st = OS.activeMesaState;
  return session === s && st && st.mesaId === s.room && st.currentUserId === s.user && !!st.isMestre === s.gm;
}
function rpcClient() { return OS.getSupabaseClient ? OS.getSupabaseClient() : null; }
function statusFor(error, op) {
  const code = error && error.code;
  if (code === "PGRST202" || code === "42883") return "6B do Xerife indisponível nesta mesa.";
  if (code === "40001") return "O conjunto mudou. Atualize antes de continuar.";
  if (code === "42501") return "Operação não autorizada.";
  if (code === "55000") {
    if (op === "renew") return "Renovação exige gastar todos os dados e ter ao menos 1 jogador ativo.";
    return "Não há jogadores ativos com ficha válida ou conjunto rolado.";
  }
  return "Não foi possível sincronizar o conjunto. Tente atualizar.";
}
function sanitizeSelection(s, type, snapshot) {
  if (!s.selected) s.selected = { aberto: [], secreto: [] };
  const dice = (snapshot && snapshot.dados) || [];
  const values = (snapshot && snapshot.resultados) || [];
  const spent = (snapshot && snapshot.usados) || [];
  const next = (s.selected[type] || []).filter(i => Number.isInteger(i) && i >= 0 && i < dice.length && values[i] != null && !spent.includes(i));
  s.selected[type] = Array.from(new Set(next)).sort((a, b) => a - b);
  return s.selected[type];
}
function render(s) {
  if (!current(s)) return;
  for (const type of s.gm ? ["aberto", "secreto"] : ["aberto"]) {
    const panel = s.panels[type], snapshot = s.snapshots[type];
    panel.body.replaceChildren();
    panel.body.append(element("p", "mesa-xerife-status", s.errors[type] || (snapshot ? "" : "Carregando…")));
    if (!snapshot) continue;
    const dice = snapshot.dados || [], values = snapshot.resultados || [], spent = snapshot.usados || [];
    const selected = s.gm ? sanitizeSelection(s, type, snapshot) : [];
    const available = dice.map((_, i) => i).filter(i => values[i] != null && !spent.includes(i));
    const allSpent = dice.length > 0 && values.length === dice.length && available.length === 0;
    panel.body.append(element("p", "mesa-xerife-composition", dice.length ? dice.length + " × d" + dice[0] : "Nenhum jogador ativo com ficha válida."));
    const chambers = element("div", "scene-chambers-row");
    dice.forEach((sides, i) => {
      const isSpent = spent.includes(i), isSelected = selected.includes(i), canSelect = s.gm && !isSpent && values[i] != null && !s.busy && !s.loading;
      const pillTag = s.gm && values[i] != null ? "button" : "span";
      const die = element(pillTag, "scene-chamber-pill" + (isSpent ? " is-used" : "") + (isSelected ? " is-selected" : ""), "d" + sides + ": " + (values[i] == null ? "—" : values[i]));
      if (pillTag === "button") {
        die.type = "button";
        die.disabled = !canSelect;
        die.setAttribute("aria-pressed", isSelected ? "true" : "false");
        die.addEventListener("click", () => {
          if (!current(s) || s.busy || s.loading) return;
          const list = s.selected[type] || [];
          const pos = list.indexOf(i);
          if (pos >= 0) list.splice(pos, 1);
          else list.push(i);
          s.selected[type] = list;
          render(s);
        });
      }
      die.setAttribute("aria-label", "Dado " + (i + 1) + (isSpent ? ", consumido" : isSelected ? ", selecionado" : ", disponível"));
      chambers.append(die);
    });
    panel.body.append(chambers);
    if (snapshot.composicao_pendente) panel.body.append(element("p", "mesa-xerife-status", "Participantes ou fichas mudaram. O conjunto atual foi preservado."));
    if (s.gm && snapshot.fichas_invalidas > 0) panel.body.append(element("p", "mesa-xerife-status", snapshot.fichas_invalidas + " ficha(s) sem configuração válida foram ignoradas."));
    if (s.gm && type === "aberto" && allSpent && OS.activeMesaState && OS.activeMesaState.combateAtivo && OS.activeMesaState.combateAtivo.ativo) {
      panel.body.append(element("p", "mesa-xerife-status mesa-xerife-combat-warn", "6B Aberto zerado em combate: inimigos que ainda não agiram perdem o turno ao renovar (regra oficial)."));
    }
    if (s.gm) {
      const actions = element("div", "mesa-xerife-actions");
      const roll = element("button", "btn btn-secondary btn-small", "Rolar conjunto");
      roll.type = "button"; roll.disabled = !!s.errors[type] || s.busy || s.loading || !dice.length || values.length > 0;
      roll.addEventListener("click", () => OS.rollXerife6B(type));

      const consume = element("button", "btn btn-secondary btn-small", selected.length > 0 ? "Consumir (" + selected.length + ")" : "Consumir");
      consume.type = "button"; consume.disabled = !!s.errors[type] || s.busy || s.loading || !values.length || selected.length === 0;
      consume.addEventListener("click", () => OS.consumeXerife6B(type, s.selected[type].slice()));

      const consumeAll = element("button", "btn btn-secondary btn-small", "Gastar todos");
      consumeAll.type = "button"; consumeAll.disabled = !!s.errors[type] || s.busy || s.loading || !values.length || available.length === 0;
      consumeAll.addEventListener("click", () => OS.consumeXerife6B(type, available.slice()));

      const renew = element("button", "btn btn-secondary btn-small", "Renovar");
      renew.type = "button"; renew.disabled = !!s.errors[type] || s.busy || s.loading || !values.length || !allSpent;
      renew.title = allSpent ? "Rolar novo conjunto sem custos adicionais." : "Disponível após gastar todos os dados do conjunto.";
      renew.addEventListener("click", () => OS.renewXerife6B(type));

      actions.append(roll, consume, consumeAll, renew);
      panel.body.append(actions);
    }
  }
}
OS.clearXerife6B = function () {
  const previous = session;
  session = null;
  if (!previous) return;
  clearInterval(previous.timer);
  previous.snapshots = {}; // Descarta segredo antes de qualquer callback assíncrono.
  previous.selected = {};
  previous.root.remove();
  if (previous.channel) {
    const client = rpcClient();
    if (client) Promise.resolve(client.removeChannel(previous.channel)).catch(() => {});
  }
  // A saída explícita remove apenas esta conexão; falhas expiram pelo lease do servidor.
  if (!previous.gm && previous.present) {
    const client = rpcClient();
    if (client) Promise.resolve(client.rpc("presenca_6b_xerife", { p_mesa: previous.room, p_conexao: previous.connection, p_ficha: null, p_sair: true })).catch(() => {});
  }
};
OS.refreshXerife6B = async function () {
  const s = session, client = rpcClient();
  if (!s || !current(s) || !client || s.loading || s.busy) return false;
  s.loading = true; render(s);
  try {
    if (!s.gm) {
      const presence = await client.rpc("presenca_6b_xerife", { p_mesa: s.room, p_conexao: s.connection, p_ficha: OS.activeMesaState.playerFichaId || null, p_sair: false });
      if (!current(s)) return false;
      s.present = !presence.error;
    }
    for (const type of s.gm ? ["aberto", "secreto"] : ["aberto"]) {
      const result = await client.rpc("ler_6b_xerife", { p_mesa: s.room, p_tipo: type });
      if (!current(s)) return false;
      if (result.error) { s.snapshots[type] = null; s.errors[type] = statusFor(result.error, "read"); }
      else { s.snapshots[type] = result.data; s.errors[type] = ""; }
    }
    render(s); return true;
  } catch (_) {
    if (current(s)) { s.snapshots = {}; for (const type of Object.keys(s.panels)) s.errors[type] = statusFor(null, "read"); render(s); }
    return false;
  } finally { s.loading = false; render(s); }
};
OS.rollXerife6B = async function (type) {
  const s = session, client = rpcClient();
  if (!s || !current(s) || !s.gm || !["aberto", "secreto"].includes(type) || !client || s.busy || s.loading || !s.snapshots[type] || s.errors[type]) return false;
  s.busy = true; render(s);
  try {
    const result = await client.rpc("rolar_6b_xerife", { p_mesa: s.room, p_tipo: type, p_versao: s.snapshots[type].versao });
    if (!current(s)) return false;
    if (result.error) { s.errors[type] = statusFor(result.error, "roll"); return false; }
    s.snapshots[type] = result.data; s.selected[type] = []; s.errors[type] = ""; return true;
  } catch (_) { if (current(s)) s.errors[type] = statusFor(null, "roll"); return false; }
  finally { s.busy = false; render(s); }
};
OS.consumeXerife6B = async function (type, indices) {
  const s = session, client = rpcClient();
  if (!s || !current(s) || !s.gm || !["aberto", "secreto"].includes(type) || !client || s.busy || s.loading || !s.snapshots[type] || s.errors[type]) return false;
  const cleanIndices = Array.from(new Set((indices || []).map(Number))).filter(i => Number.isInteger(i) && i >= 0);
  if (!cleanIndices.length) return false;
  s.busy = true; render(s);
  try {
    const result = await client.rpc("consumir_6b_xerife", {
      p_mesa: s.room,
      p_tipo: type,
      p_versao: s.snapshots[type].versao,
      p_indices: cleanIndices
    });
    if (!current(s)) return false;
    if (result.error) { s.errors[type] = statusFor(result.error, "consume"); return false; }
    s.snapshots[type] = result.data;
    s.selected[type] = [];
    s.errors[type] = "";
    return true;
  } catch (_) { if (current(s)) s.errors[type] = statusFor(null, "consume"); return false; }
  finally { s.busy = false; render(s); }
};
OS.renewXerife6B = async function (type) {
  const s = session, client = rpcClient();
  if (!s || !current(s) || !s.gm || !["aberto", "secreto"].includes(type) || !client || s.busy || s.loading || !s.snapshots[type] || s.errors[type]) return false;
  s.busy = true; render(s);
  try {
    const result = await client.rpc("renovar_6b_xerife", {
      p_mesa: s.room,
      p_tipo: type,
      p_versao: s.snapshots[type].versao
    });
    if (!current(s)) return false;
    if (result.error) { s.errors[type] = statusFor(result.error, "renew"); return false; }
    s.snapshots[type] = result.data;
    s.selected[type] = [];
    s.errors[type] = "";
    return true;
  } catch (_) { if (current(s)) s.errors[type] = statusFor(null, "renew"); return false; }
  finally { s.busy = false; render(s); }
};
OS.isXerife6BAvailable = function () {
  const s = session;
  return !!(s && current(s) && s.gm && s.snapshots.aberto && !s.errors.aberto);
};
OS.getXerife6BSnapshot = function (type) {
  const s = session;
  if (!s || !current(s) || !s.gm || !["aberto", "secreto"].includes(type)) return null;
  const snapshot = s.snapshots[type];
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
};
// As instâncias consultam a MESMA projeção; não há cópia de dados em cada NPC.
OS.getXerife6BForNpc = function (instanceId) {
  const s = session;
  if (!s || !current(s) || !s.gm || !OS.getSceneCreatureById(instanceId)) return null;
  const snapshot = s.snapshots.aberto;
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
};
OS.initXerife6B = async function () {
  OS.clearXerife6B();
  const st = OS.activeMesaState, host = document.getElementById("mesa-sidebar-feed"), client = rpcClient();
  if (!st || !st.mesaId || !st.currentUserId || !host || !client) return false;
  const root = element("section", "mesa-xerife-pools"); root.id = "mesa-xerife-pools";
  const s = session = { room: st.mesaId, user: st.currentUserId, gm: !!st.isMestre, connection: crypto.randomUUID(), root, panels: {}, snapshots: {}, errors: {}, selected: { aberto: [], secreto: [] }, busy: false, loading: false, present: false };
  for (const type of s.gm ? ["aberto", "secreto"] : ["aberto"]) {
    const panel = element("details", "mesa-xerife-panel"); panel.dataset.pool = type;
    const summary = element("summary", "section-title", type === "aberto" ? "6B Aberto" : "6B Secreto");
    const body = element("div", "mesa-xerife-body"); panel.append(summary, body); root.append(panel); s.panels[type] = { panel, body };
  }
  const refresh = element("button", "btn btn-secondary btn-small", "Atualizar 6B"); refresh.type = "button";
  refresh.addEventListener("click", () => OS.refreshXerife6B()); root.append(refresh); host.append(root);
  await OS.refreshXerife6B();
  if (!current(s)) return false;
  // Segredo nunca é inscrito em Realtime, nem enviado em canais de mesa ou eventos.
  if (client.channel && client.auth && client.realtime) {
    try {
      const auth = await client.auth.getSession();
      if (!current(s) || !auth.data.session) return false;
      await client.realtime.setAuth(auth.data.session.access_token);
      if (!current(s)) return false;
      s.channel = client.channel("xerife-aberto-" + s.room);
      for (const event of ["INSERT", "UPDATE"]) s.channel.on("postgres_changes", { event, schema: "public", table: "mesa_6b_aberto", filter: "mesa_id=eq." + s.room }, () => { if (current(s)) OS.refreshXerife6B(); });
      s.channel.subscribe(status => { if (current(s) && status === "SUBSCRIBED") OS.refreshXerife6B(); });
    } catch (_) { /* Poll autenticado também recupera eventos perdidos. */ }
  }
  s.timer = setInterval(() => { if (current(s)) OS.refreshXerife6B(); else OS.clearXerife6B(); }, 30000);
  return true;
};
