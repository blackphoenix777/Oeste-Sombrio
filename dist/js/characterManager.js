/**
 * Gerenciamento de personagens (Tauri + fallback localStorage)
 */
import { OS } from "./app.js";

OS.activeCharacterFilename = null;
OS.activeCharacterName = null;

OS.isTauri = function () {
  return !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
};

OS.invokeTauri = function (cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args || {});
};

OS.toCharacterFilename = function (name) {
  var base = String(name || "Personagem")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\u00C0-\u024F\-]/gi, "");
  if (!base) base = "Personagem";
  return base + ".json";
};

OS.wrapCharacterPayload = function (state, name) {
  var meta = {
    name: name || (state && state.nome) || "Personagem",
    updatedAt: new Date().toISOString()
  };
  if (state && (state.mesa_id || state.mesaId)) {
    meta.mesa_id = state.mesa_id || state.mesaId;
  }
  return {
    meta: meta,
    data: state || {}
  };
};

OS.unwrapCharacterPayload = function (raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.data && typeof raw.data === "object") return raw.data;
  return raw;
};

OS.formatCharacterDate = function (value) {
  if (!value) return "—";
  var ms = Number(value);
  var d;
  if (!isNaN(ms) && ms > 0) {
    d = ms < 1e12 ? new Date(ms * 1000) : new Date(ms);
  } else {
    d = new Date(value);
  }
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
};

/* ---- Fallback browser (sem Tauri) ---- */
var LS_INDEX = "oesteSombrioCharactersIndex_v1";
var LS_CHAR_PREFIX = "oesteSombrioChar_";

OS.listCharactersLocal = function () {
  try {
    var raw = localStorage.getItem(LS_INDEX);
    var list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
      return String(b.last_modified || "").localeCompare(String(a.last_modified || ""));
    });
  } catch (e) {
    return [];
  }
};

OS.saveCharactersIndexLocal = function (list) {
  localStorage.setItem(LS_INDEX, JSON.stringify(list || []));
};

OS.listCharacters = async function () {
  var list = OS.isTauri() ? await OS.invokeTauri("list_characters") : OS.listCharactersLocal();
  return (list || []).filter(function (c) {
    return c && c.filename !== "itens_criados.json" && c.filename !== "magias_criadas.json";
  });
};

OS.loadCharacterFile = async function (filename) {
  var text;
  if (OS.isTauri()) {
    text = await OS.invokeTauri("load_character", { filename: filename });
  } else {
    text = localStorage.getItem(LS_CHAR_PREFIX + filename);
    if (!text) throw new Error("Personagem não encontrado");
  }
  return JSON.parse(text);
};

OS.saveCharacterFile = async function (filename, payload) {
  var text = JSON.stringify(payload, null, 2);
  if (OS.isTauri()) {
    await OS.invokeTauri("save_character", { filename: filename, data: text });
    return;
  }
  localStorage.setItem(LS_CHAR_PREFIX + filename, text);
  var list = OS.listCharactersLocal();
  var name =
    (payload && payload.meta && payload.meta.name) ||
    filename.replace(/\.json$/i, "").replace(/_/g, " ");
  var mesaIdVal =
    (payload && payload.meta && (payload.meta.mesa_id || payload.meta.mesaId)) ||
    (payload && payload.data && (payload.data.mesa_id || payload.data.mesaId)) ||
    null;
  var now = String(Math.floor(Date.now() / 1000));
  var found = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].filename === filename) {
      list[i].name = name;
      list[i].last_modified = now;
      if (mesaIdVal) {
        list[i].mesa_id = mesaIdVal;
      } else {
        delete list[i].mesa_id;
      }
      found = true;
      break;
    }
  }
  if (!found) {
    var newEntry = { name: name, filename: filename, last_modified: now };
    if (mesaIdVal) newEntry.mesa_id = mesaIdVal;
    list.push(newEntry);
  }
  OS.saveCharactersIndexLocal(list);
};

OS.deleteCharacterFile = async function (filename) {
  if (OS.isTauri()) {
    await OS.invokeTauri("delete_character", { filename: filename });
    return;
  }
  localStorage.removeItem(LS_CHAR_PREFIX + filename);
  var list = OS.listCharactersLocal().filter(function (c) {
    return c.filename !== filename;
  });
  OS.saveCharactersIndexLocal(list);
};

OS.persistActiveCharacter = async function () {
  if (!OS.activeCharacterFilename) return false;
  var state = OS.collectState();
  var name = OS.activeCharacterName || state.nome || "Personagem";
  if (state.nome) OS.activeCharacterName = state.nome;
  var payload = OS.wrapCharacterPayload(state, OS.activeCharacterName || name);
  await OS.saveCharacterFile(OS.activeCharacterFilename, payload);
  return true;
};
