import { OS } from "./app.js";

// Real wounds are independent from spent dice and fatigue. Legacy import excludes
// identifiable fatigue-zero chambers; ordinary usedChambers are never wounds.
OS.getRealDamagedChambers = function (data, total) {
  data = data || {}; total = total || 6;
  var marks = data.damagedChambers;
  if (!Array.isArray(marks)) {
    var fatigue = (data.activeConditions || []).reduce(function (n, c) {
      return c && String(c.nome).toLowerCase() === "fatigado" ? Math.max(n, Number(c.grau) || 0) : n;
    }, 0);
    marks = (data.markedChambers || []).filter(function (i) {
      var original = (data.originalChambers || [])[i];
      return !fatigue || original == null || Number(original) > fatigue;
    });
  }
  return Array.from(new Set(marks.map(Number))).filter(function (i) { return Number.isInteger(i) && i >= 0 && i < total; });
};

OS.loadMesaTokenStatus = async function () {
  var st = OS.activeMesaState, client = OS.getSupabaseClient();
  if (!st || !st.mesaId || !st.activeMapId || !client) return;
  var room = st.mesaId, map = st.activeMapId, request = (st._statusReadId || 0) + 1;
  st._statusReadId = request;
  try {
    var res = await client.from("mesa_token_status").select("*").eq("mesa_id", room).eq("mapa_id", map);
    if (res.error) throw res.error;
    if (st.mesaId !== room || st.activeMapId !== map || st._statusReadId !== request) return;
    st.tokenStatus = {};
    (res.data || []).forEach(function (s) {
      if (st.isMestre || s.owner_type === "player") st.tokenStatus[s.token_id] = s;
    });
    OS.refreshTokenBars();
  } catch (err) { console.warn("[status dos tokens]", err.message); }
};
OS.refreshTokenBars = function () {
  (OS.activeMesaState.mesaTokens || []).forEach(function (t) {
    var el = document.querySelector('.mesa-map-token[data-token-id="' + t.id + '"]');
    if (el) OS.renderMesaTokenBars(el, t);
  });
};
OS.renderMesaTokenBars = function (el, token) {
  var old = el.querySelector(".mesa-token-bars"); if (old) old.remove();
  var st = OS.activeMesaState;
  if (!st || (!st.isMestre && token.owner_type !== "player")) return;
  var s = (st.tokenStatus || {})[token.id];
  if (!s || s.mapa_id !== st.activeMapId || s.mesa_id !== st.mesaId) return;
  var bars = document.createElement("div"); bars.className = "mesa-token-bars";
  if (!(Number(token.grid_y) > 0)) bars.style.top = "2px"; // Keep the first row inside the clipped map viewport.
  function bar(type, value, max, label) {
    var track = document.createElement("div"), fill = document.createElement("span");
    var ratio = Math.max(0, Math.min(1, value / max));
    track.className = "mesa-token-bar mesa-token-bar-" + type;
    track.setAttribute("role", "meter"); track.setAttribute("aria-label", label);
    track.setAttribute("aria-valuenow", value); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", max);
    track.title = label + ": " + value + "/" + max;
    fill.style.width = ratio * 100 + "%";
    if (type === "health") fill.style.background = ratio > .5 ? "#65d28d" : ratio > .25 ? "#efc653" : "#f06565";
    track.appendChild(fill); bars.appendChild(track);
  }
  if (s.six_b_total > 0) bar("health", Math.max(0, s.six_b_total - s.danos_bloqueados), s.six_b_total, "Integridade");
  if (s.rem_max > 0) bar("rem", Math.max(0, Math.min(s.rem_max, s.rem_current || 0)), s.rem_max, "REM");
  el.appendChild(bars);
};
OS.subscribeMesaTokenStatus = function (channel, room) {
  // Never subscribe to DELETE: Postgres Changes does not apply RLS to deletions.
  ["INSERT", "UPDATE"].forEach(function (event) {
    channel.on("postgres_changes", { event: event, schema: "public", table: "mesa_token_status", filter: "mesa_id=eq." + room }, function (payload) {
      var st = OS.activeMesaState, s = payload.new;
      if (OS.activeMesaChannel !== channel || st.mesaId !== room || !s || s.mapa_id !== st.activeMapId) return;
      if (!st.isMestre && s.owner_type !== "player") return;
      if (!(st.mesaTokens || []).some(function (t) { return t.id === s.token_id; })) return;
      st.tokenStatus = st.tokenStatus || {}; st.tokenStatus[s.token_id] = s; OS.refreshTokenBars();
    });
  });
};
