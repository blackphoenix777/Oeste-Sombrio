/**
 * Tela de Mesa dividida entre Mestre e Jogador (#mesa-screen),
 * Bestiário Oficial (dist/data/bestiario/), NPCs Customizados (public.fichas com mesa_id = NULL),
 * Cards em Cena persistentes (public.mesas.cena_ativa + localStorage oesteSombrioMesaScene_<mesa_id>),
 * Compilado de Magias somente leitura e Modal de Resumo de Regras (#regras-modal).
 */
import { OS } from "./app.js";
import { computeTurnActionBudget, resolveIndividual6BInitiative, resolveCombatantInitiativeMode, computeCascadeInitiatives, extractMonsterFixedActions, inspectCombatConditionsForActions, evaluateSheetOverloadForActions, CANONICAL_ACTION_COSTS, ALLOWED_REACTION_ACTION_TYPES, resolveCanonicalActionCost, createCombatantActionState, computeAvailableActionsFromState, hasPendingActionReservations, applyActionControllerOperation } from "./rules/index.js";

var BESTIARIO_INDEX_URL = "data/bestiario/bestiario-index.json";
var SCENE_LS_PREFIX = "oesteSombrioMesaScene_";
var CUSTOM_NPCS_LS_PREFIX = "oesteSombrioCustomNpcs_";
var GM_POPUPS_LS_PREFIX = "darkwest_gm_popups_";
var SCENE_SAVE_DEBOUNCE_MS = 1200;

OS.bestiaryCatalog = {
  loaded: false,
  loading: null,
  official: [],
  byId: {},
  custom: []
};

OS.activeMesaChannel = null;

OS.activeMesaState = {
  mesaId: null,
  mesa: null,
  membro: null,
  currentUserId: null,
  isMestre: false,
  activeSidebarTab: "chat", // "chat" | "fichas"
  mapaUrl: "",
  gridCols: 24,
  npcsMesa: [],
  mesaTokens: [],
  sceneCreatures: [],
  gmPopups: [],
  gmPopupsHubExpanded: false,
  sceneUpdatedAt: null,
  sceneSaveTimer: null,
  isDraggingLocal: false,
  draggingTokenId: null,
  pendingLocalTokenUpdates: {},
  realtimeStatus: "idle",
  _hasSubscribedOnce: false,
  _needsResyncOnSubscribe: false,
  _isFlushingSceneRemote: false,
  gmEditingSheet: null, // { mode: "custom" | "mesa-npc" | "scene" | "player-readonly", customId, mesaNpcId, instanceId, title }
  playerFichaId: null,
  playerSheets: [],
  feedEvents: []
};

var mesaRealtimeReconnectTimer = null;
var mesaRealtimeReconnectAttempts = 0;

// Compatibilidade com a API de combate: um único cache, sem duplicar arrays.
Object.defineProperty(OS.activeMesaState, "tokens", {
  get: function () { return this.mesaTokens; },
  set: function (value) { this.mesaTokens = value; }
});

OS.normalizeMesaInitiative = function (value) {
  var text = String(value == null ? "" : value).trim();
  if (!/^[+-]?[0-9]+([.][0-9]+)?$/.test(text)) return 0;
  var n = Number(text);
  return Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(n))) : 0;
};

OS.getMesaCombatantsIniciative = function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return [];
  return (st.mesaTokens || []).filter(function (t) {
    return t && (!t.mesa_id || String(t.mesa_id) === String(st.mesaId)) &&
      (st.isMestre || t.visible_to_players === true || t.is_own === true ||
        (st.currentUserId && t.owner_user_id === st.currentUserId));
  }).map(function (t) {
    return { tokenId: t.id, ownerRef: t.owner_ref, ownerType: t.owner_type,
      name: String(t.display_name || ""), imageUrl: t.image_url || null,
      iniciativa: OS.normalizeMesaInitiative(t.iniciativa), visibleToPlayers: t.visible_to_players === true,
      isOwner: t.is_own === true || !!(st.currentUserId && t.owner_user_id === st.currentUserId) };
  }).sort(function (a, b) {
    return b.iniciativa - a.iniciativa || a.name.localeCompare(b.name) ||
      String(a.tokenId).localeCompare(String(b.tokenId));
  });
};

OS.dispatchMesaCombatantsChange = function () {
  var st = OS.activeMesaState;
  var detail = { mesaId: st && st.mesaId, combatants: OS.getMesaCombatantsIniciative() };
  var signature = JSON.stringify(detail);
  if (st && st._combatantsSignature === signature) return;
  if (st) st._combatantsSignature = signature;
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("mesa-combatants-change", { detail: detail }));
  }
};

// Serializa por instância para que edições rápidas não invertam os UPDATEs.
var sceneInitiativeWrites = new Map();
OS.syncSceneTokenInitiative = function (instance) {
  var st = OS.activeMesaState;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!st || !st.isMestre || !st.mesaId || !instance || !client) return Promise.resolve(false);
  var mesaId = st.mesaId, instanceId = instance.instanceId;
  var iniciativa = OS.normalizeMesaInitiative(instance.data && instance.data.iniciativa);
  var key = mesaId + ":" + instanceId;
  var cached = OS.getSceneToken(instanceId);
  if (!sceneInitiativeWrites.has(key) && cached && OS.normalizeMesaInitiative(cached.iniciativa) === iniciativa) {
    return Promise.resolve(true);
  }
  var write = (sceneInitiativeWrites.get(key) || Promise.resolve()).then(async function () {
    var res = await client.from("mesa_tokens").update({ iniciativa: iniciativa, updated_at: new Date().toISOString() })
      .eq("mesa_id", mesaId).eq("owner_type", "creature").eq("owner_ref", instanceId);
    if (res && res.error) throw res.error;
    // O save de cena também sincroniza no servidor, inclusive se esta chamada falhar.
    if (st.mesaId === mesaId) {
      var token = OS.getSceneToken(instanceId);
      if (token) token.iniciativa = iniciativa;
      if (st.combateAtivo && st.combateAtivo.ativo && OS.recordNextRoundInitiative) {
        OS.recordNextRoundInitiative(instanceId, iniciativa);
      }
      OS.dispatchMesaCombatantsChange();
    }
    return true;
  }).catch(function (err) {
    console.warn("[syncSceneTokenInitiative] Falha ao sincronizar iniciativa:", err);
    return false;
  });
  sceneInitiativeWrites.set(key, write);
  write.then(function () { if (sceneInitiativeWrites.get(key) === write) sceneInitiativeWrites.delete(key); });
  return write;
};

var bestiarioModalState = {
  activeTab: "oficial", // "oficial" | "custom"
  searchQuery: "",
  selectedKey: null
};

var RULES_TABS_DEF = [
  { key: "sistema_de_testes", label: "Sistema de Testes", file: "sistema_de_testes.json" },
  { key: "regras_combate", label: "Regras de Combate", file: "regras_combate.json" },
  { key: "fichas_do_destino", label: "Fichas do Destino", file: "fichas_do_destino.json" },
  { key: "itens_e_equipamentos", label: "Itens e Equipamentos", file: "itens_e_equipamentos.json" },
  { key: "tempo_livre", label: "Tempo Livre", file: "tempo_livre.json" },
  { key: "veteranos", label: "Veteranos", file: "veteranos.json" }
];

var regrasModalState = {
  activeKey: "sistema_de_testes",
  selectedSectionKey: null,
  searchQuery: ""
};

/* ─── Utilitários ─────────────────────────────────────────────── */

function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function escHtml(str) {
  return String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSearch(str) {
  return String(str === null || str === undefined ? "" : str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function generateUid(prefix) {
  return (
    (prefix || "id") +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(val) {
  return UUID_REGEX.test(String(val || "").trim());
}

function generateUuidV4() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureValidUuid(raw) {
  var s = String(raw || "").trim();
  if (UUID_REGEX.test(s)) return s.toLowerCase();
  if (!s) return generateUuidV4();
  // Deterministic UUID v4-shaped hash for any legacy non-UUID id
  var h1 = 0x811c9dc5;
  var h2 = 0x01000193;
  var h3 = 0x9e3779b9;
  var h4 = 0x85ebca6b;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (ch * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (ch * 131), 0x27d4eb2f) >>> 0;
  }
  var hex =
    ("00000000" + h1.toString(16)).slice(-8) +
    ("00000000" + h2.toString(16)).slice(-8) +
    ("00000000" + h3.toString(16)).slice(-8) +
    ("00000000" + h4.toString(16)).slice(-8);
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-a" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

function generateInviteCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var out = "";
  for (var i = 0; i < 6; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

if (typeof OS.parse6BConfigString !== "function") {
  OS.parse6BConfigString = function (str) {
    var raw = String(str || "").trim();
    if (!raw) return {};
    var result = {};
    var regex = /(\d+)\s*(d4|d6|d8|d10|d12)/gi;
    var m;
    while ((m = regex.exec(raw)) !== null) {
      var count = parseInt(m[1], 10);
      var die = m[2].toLowerCase();
      if (!isNaN(count) && count > 0) {
        result[die] = (result[die] || 0) + count;
      }
    }
    return result;
  };
}

if (typeof OS.format6BConfig !== "function") {
  OS.format6BConfig = function (config) {
    var cfg = config && typeof config === "object" ? config : { d6: 6 };
    var keys = Object.keys(cfg).filter(function (k) {
      return (parseInt(String(cfg[k] || 0), 10) || 0) > 0;
    });
    if (!keys.length) return "1d6";
    var order = cfg.d12 >= 6 && keys.length > 1
      ? ["d12", "d4", "d6", "d8", "d10"]
      : ["d4", "d6", "d8", "d10", "d12"];
    keys.sort(function (a, b) {
      return order.indexOf(a) - order.indexOf(b);
    });
    return keys
      .map(function (k) {
        return cfg[k] + k;
      })
      .join(" + ");
  };
}

function isPlayerSheetData(d, options) {
  if (options && options.isPlayer) return true;
  if (!d || typeof d !== "object") return false;
  if (
    d.tipo_ficha === "npc" ||
    d.tipo_ficha === "monstro" ||
    d.isBestiaryCustom === true ||
    d.freeEdit === true
  ) {
    return false;
  }
  return (
    d.tipo_ficha === "jogador" ||
    d.freeEdit === false ||
    (Array.isArray(d.tipo_dados_6b) && d.tipo_dados_6b.length > 0) ||
    (d.fateTokens !== undefined && d.fateTokens !== null) ||
    (d.fatePool !== undefined && d.fatePool !== null) ||
    d.classe !== undefined ||
    d.antecedente !== undefined
  );
}

/**
 * Resolve e sincroniza config-6b (string) e config6B (objeto) de uma criatura,
 * tratando config-6b (string) como fonte de verdade quando presente/válida.
 */
OS.resolveCreature6BInfo = function (data, options) {
  var d =
    data && typeof data === "object" && (data.data || data.dados)
      ? data.data || data.dados
      : data && typeof data === "object"
      ? data
      : {};
  var rawStr =
    d["config-6b"] !== undefined && d["config-6b"] !== null
      ? String(d["config-6b"]).trim()
      : "";
  var parsedFromStr =
    rawStr && typeof OS.parse6BConfigString === "function"
      ? OS.parse6BConfigString(rawStr)
      : {};
  var existingObj =
    d.config6B && typeof d.config6B === "object" ? d.config6B : {};

  var cfg = null;
  var mutated = false;

  if (Object.keys(parsedFromStr).length > 0) {
    cfg = deepClone(parsedFromStr);
    if (JSON.stringify(existingObj) !== JSON.stringify(cfg)) {
      d.config6B = deepClone(cfg);
      mutated = true;
    }
  } else if (Object.keys(existingObj).length > 0) {
    cfg = deepClone(existingObj);
    var formatted =
      typeof OS.format6BConfig === "function"
        ? OS.format6BConfig(cfg)
        : "1d6";
    if (!rawStr) {
      d["config-6b"] = formatted;
      mutated = true;
    }
  } else {
    var cfgFromArray = {};
    if (Array.isArray(d.tipo_dados_6b) && d.tipo_dados_6b.length > 0) {
      d.tipo_dados_6b.forEach(function (die) {
        var k = String(die || "").trim().toLowerCase();
        if (/^d(?:4|6|8|10|12)$/.test(k)) {
          cfgFromArray[k] = (cfgFromArray[k] || 0) + 1;
        }
      });
    }
    if (Object.keys(cfgFromArray).length > 0) {
      cfg = cfgFromArray;
    } else if (isPlayerSheetData(d, options)) {
      var nivelNum = parseInt(String(d.nivel || 1), 10) || 1;
      cfg =
        typeof OS.calculate6BConfig === "function"
          ? deepClone(OS.calculate6BConfig(nivelNum))
          : { d6: 6 };
    } else {
      cfg = { d6: 1 };
    }
    d.config6B = deepClone(cfg);
    var defaultFmt =
      typeof OS.format6BConfig === "function"
        ? OS.format6BConfig(cfg)
        : isPlayerSheetData(d, options)
        ? "6d6"
        : "1d6";
    if (!rawStr) {
      d["config-6b"] = defaultFmt;
    }
    mutated = true;
  }

  var diceList = [];
  ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
    var qty = parseInt(String(cfg[die] || 0), 10) || 0;
    for (var i = 0; i < qty; i++) {
      diceList.push(die);
    }
  });
  if (!diceList.length) {
    diceList.push("d6");
  }

  var cfgText =
    d["config-6b"] ||
    (typeof OS.format6BConfig === "function"
      ? OS.format6BConfig(cfg)
      : "1d6");

  return {
    cfg: cfg,
    cfgText: cfgText,
    diceList: diceList,
    count: diceList.length,
    mutated: mutated
  };
};

/**
 * Sanitiza câmaras excedentes (ci >= N, onde N vem de config6B) e garante sincronia
 * entre config-6b e config6B para qualquer criatura/NPC em modo freeEdit.
 */
OS.sanitizeCreature6BData = function (data, options) {
  if (!data || typeof data !== "object") {
    var fallbackPlayer = !!(options && options.isPlayer);
    var fallbackCount = fallbackPlayer ? 6 : 1;
    return {
      cfg: { d6: fallbackCount },
      cfgText: fallbackCount + "d6",
      diceList: Array.from({ length: fallbackCount }, function () {
        return "d6";
      }),
      count: fallbackCount,
      mutated: false
    };
  }
  var info = OS.resolveCreature6BInfo(data, options);
  var n = info.count;
  var mutated = !!info.mutated;

  // Inclui câmaras de configurações anteriores maiores que seis.
  var storedCount = Math.max(6, (data.originalChambers || []).length);
  Object.keys(data).forEach(function (key) {
    var match = /^chamber-(\d+)(?:-mark)?$/.exec(key);
    if (match) storedCount = Math.max(storedCount, Number(match[1]) + 1);
  });
  for (var ci = n; ci < storedCount; ci++) {
    var chKey = "chamber-" + ci;
    if (data[chKey] !== undefined && String(data[chKey]) !== "0") {
      data[chKey] = "0";
      mutated = true;
    } else if (data[chKey] === undefined) {
      data[chKey] = "0";
    }
    var markKey = chKey + "-mark";
    if (data[markKey]) {
      data[markKey] = false;
      mutated = true;
    }
    if (
      Array.isArray(data.originalChambers) &&
      ci < data.originalChambers.length &&
      String(data.originalChambers[ci]) !== "0"
    ) {
      data.originalChambers[ci] = "0";
      mutated = true;
    }
  }

  if (Array.isArray(data.usedChambers)) {
    var filteredUsed = data.usedChambers.filter(function (idx) {
      var num = parseInt(String(idx), 10);
      return !isNaN(num) && num >= 0 && num < n;
    });
    if (filteredUsed.length !== data.usedChambers.length) {
      data.usedChambers = filteredUsed;
      mutated = true;
    }
  } else {
    data.usedChambers = [];
  }

  if (Array.isArray(data.markedChambers)) {
    var filteredMarked = data.markedChambers.filter(function (idx) {
      var num = parseInt(String(idx), 10);
      return !isNaN(num) && num >= 0 && num < n;
    });
    if (filteredMarked.length !== data.markedChambers.length) {
      data.markedChambers = filteredMarked;
      mutated = true;
    }
  }

  if (Array.isArray(data.damagedChambers)) {
    var wounds = data.damagedChambers.filter(function (i) { return Number.isInteger(i) && i >= 0 && i < n; });
    if (wounds.length !== data.damagedChambers.length) { data.damagedChambers = wounds; mutated = true; }
  }
  info.mutated = mutated;
  return info;
};

/**
 * Retorna informações normalizadas de exibição e rolagem do tambor 6B para
 * criaturas, NPCs e jogadores (usado em Em Cena, popups e barras de token).
 */
OS.getCreature6BDisplayInfo = function (targetOrData, options) {
  var d =
    targetOrData && typeof targetOrData === "object" && (targetOrData.data || targetOrData.dados)
      ? targetOrData.data || targetOrData.dados
      : targetOrData && typeof targetOrData === "object"
      ? targetOrData
      : {};
  var info = OS.sanitizeCreature6BData(d, options);
  var count = info.count;
  var usedChambers = Array.isArray(d.usedChambers) ? d.usedChambers : [];
  var markedChambers = Array.isArray(d.markedChambers) ? d.markedChambers : [];
  var damagedChambers = OS.getRealDamagedChambers
    ? OS.getRealDamagedChambers(d, count)
    : Array.isArray(d.damagedChambers)
    ? d.damagedChambers.filter(function (i) {
        return Number.isInteger(i) && i >= 0 && i < count;
      })
    : [];

  var chambers = [];
  var availableValues = [];
  for (var ci = 0; ci < count; ci++) {
    var rawVal = d["chamber-" + ci];
    var cVal =
      rawVal !== undefined && rawVal !== null && String(rawVal) !== ""
        ? String(rawVal)
        : "0";
    var isUsed = usedChambers.indexOf(ci) >= 0;
    var isDamaged = damagedChambers.indexOf(ci) >= 0;
    if (!isUsed && !isDamaged && cVal !== "0") {
      availableValues.push(cVal);
    }
    chambers.push({
      index: ci,
      value: cVal,
      die: info.diceList[ci] || "d6",
      isUsed: isUsed,
      isDamaged: isDamaged
    });
  }

  var intactCount = Math.max(0, count - damagedChambers.length);
  var vidaText = intactCount + "/" + count;

  return {
    cfg: info.cfg,
    cfgText: info.cfgText,
    diceList: info.diceList,
    count: count,
    chamberCount: count,
    mutated: info.mutated,
    usedChambers: usedChambers,
    markedChambers: markedChambers,
    damagedChambers: damagedChambers,
    intactCount: intactCount,
    vidaText: vidaText,
    healthText: vidaText,
    chambers: chambers,
    availableValues: availableValues,
    compactSummary: availableValues.length ? availableValues.join(",") : info.cfgText
  };
};

/**
 * Resolve o tipo de combatente (CombatantKind) e a modalidade operacional
 * (OperationalMode: "creature_mode" | "full_sheet" | null) sem alterar a natureza
 * da ficha e sem usar owner_type === "creature" como único critério.
 */
OS.resolveCombatantOperationalInfo = function (targetOrData, context) {
  context = context || {};
  var rawObj = targetOrData && typeof targetOrData === "object" ? targetOrData : {};
  var st = OS.activeMesaState;

  // Se for um token de mesa_tokens, resolve metadados/entidade associada quando disponível
  if (rawObj.owner_type && rawObj.owner_ref !== undefined && !rawObj.data && !rawObj.dados) {
    var tokOwnerType = rawObj.owner_type;
    if (tokOwnerType === "player") {
      var pRow =
        (st && Array.isArray(st.playerSheets)
          ? st.playerSheets.find(function (r) {
              return r && String(r.id) === String(rawObj.owner_ref);
            })
          : null) || null;
      return OS.resolveCombatantOperationalInfo(
        pRow || { dados: { tipo_ficha: "jogador", freeEdit: false } },
        Object.assign({}, context, { ownerType: "player", isPlayer: true })
      );
    }
    var sceneInst =
      st && Array.isArray(st.sceneCreatures)
        ? st.sceneCreatures.find(function (c) {
            return c && String(c.instanceId) === String(rawObj.owner_ref);
          })
        : null;
    if (sceneInst) {
      return OS.resolveCombatantOperationalInfo(
        sceneInst,
        Object.assign({}, context, { ownerType: "creature" })
      );
    }
  }

  var d =
    rawObj.data && typeof rawObj.data === "object"
      ? rawObj.data
      : rawObj.dados && typeof rawObj.dados === "object"
      ? rawObj.dados
      : rawObj;

  var sourceType = context.sourceType || rawObj.sourceType || null;
  var sourceId = context.sourceId || rawObj.sourceId || rawObj.id || null;
  var sourceCategory = context.sourceCategory || rawObj.sourceCategory || rawObj.category || null;
  if (!sourceCategory && sourceId && OS.bestiaryCatalog && OS.bestiaryCatalog.byId) {
    var catEntry = OS.bestiaryCatalog.byId[sourceId];
    if (catEntry) {
      sourceCategory = catEntry.category || null;
      if (!sourceType) sourceType = catEntry.sourceType || "oficial";
    }
  }

  var ownerType = context.ownerType || rawObj.ownerType || null;
  var isExplicitPlayer = !!(
    context.isPlayer ||
    ownerType === "player" ||
    d.tipo_ficha === "jogador" ||
    (d.freeEdit === false &&
      !d.isBestiaryCustom &&
      d.tipo_ficha !== "npc" &&
      d.tipo_ficha !== "monstro" &&
      sourceType !== "oficial" &&
      sourceType !== "custom" &&
      sourceType !== "mesa_npc")
  );

  if (isExplicitPlayer) {
    return {
      kind: "player",
      operationalMode: "full_sheet",
      effectiveMode: "full_sheet",
      rawChoice: null,
      isExplicit: true,
      isLegacyUnset: false,
      isOfficialMonster: false,
      isVeterano: !!(d.isVeterano === true || d["is-veterano"] === true),
      statusLabel: "Ficha Completa"
    };
  }

  var isVeterano = !!(d.isVeterano === true || d["is-veterano"] === true);
  var catLower = String(sourceCategory || "").trim().toLowerCase();
  var tipoLower = String(d.tipo_ficha || context.classe || rawObj.classe || "").trim().toLowerCase();
  var isOfficialMonster = !!(
    sourceType === "oficial" &&
    catLower !== "npc" &&
    tipoLower !== "npc" &&
    !d.isBestiaryCustom
  );
  var isExplicitMonster = !!(
    isOfficialMonster ||
    tipoLower === "monstro" ||
    (catLower === "monstro" && sourceType !== "custom")
  );

  var kind = "npc_human";
  if (isVeterano && (catLower === "npc" || tipoLower === "npc" || !isExplicitMonster)) {
    kind = "npc_veteran";
  } else if (isExplicitMonster) {
    kind = "bestiary_monster";
  }

  var rawChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(rawObj)
    : d.operationalMode === "creature_mode" || d.isCriatura === true || d["is-criatura"] === true
    ? true
    : d.operationalMode === "full_sheet" || d.isCriatura === false || d["is-criatura"] === false
    ? false
    : null;

  if (rawChoice === true) {
    return {
      kind: kind,
      operationalMode: "creature_mode",
      effectiveMode: "creature_mode",
      rawChoice: true,
      isExplicit: true,
      isLegacyUnset: false,
      isOfficialMonster: isOfficialMonster,
      isVeterano: isVeterano,
      statusLabel: "Modo Criatura"
    };
  }
  if (rawChoice === false) {
    return {
      kind: kind,
      operationalMode: "full_sheet",
      effectiveMode: "full_sheet",
      rawChoice: false,
      isExplicit: true,
      isLegacyUnset: false,
      isOfficialMonster: false,
      isVeterano: isVeterano,
      statusLabel: "Ficha Completa"
    };
  }

  if (isOfficialMonster) {
    return {
      kind: "bestiary_monster",
      operationalMode: "creature_mode",
      effectiveMode: "creature_mode",
      rawChoice: null,
      isExplicit: true,
      isLegacyUnset: false,
      isOfficialMonster: true,
      isVeterano: isVeterano,
      statusLabel: "Modo Criatura (Bestiário)"
    };
  }

  return {
    kind: kind,
    operationalMode: null,
    effectiveMode: "full_sheet",
    rawChoice: null,
    isExplicit: false,
    isLegacyUnset: true,
    isOfficialMonster: false,
    isVeterano: isVeterano,
    statusLabel: "Modo não definido"
  };
};

/**
 * Normaliza campos legados de NPC/criatura apenas em leitura (sem mutar o objeto de entrada).
 */
OS.normalizeLegacyNpcDataReadOnly = function (targetOrData, context) {
  var rawObj = targetOrData && typeof targetOrData === "object" ? targetOrData : {};
  var rawData =
    rawObj.data && typeof rawObj.data === "object"
      ? rawObj.data
      : rawObj.dados && typeof rawObj.dados === "object"
      ? rawObj.dados
      : rawObj;
  var copyData = deepClone(rawData || {});
  var opInfo = OS.resolveCombatantOperationalInfo(rawObj, context);
  var sixBInfo = OS.getCreature6BDisplayInfo(copyData, {
    isPlayer: opInfo.kind === "player"
  });
  var hasExplicitTipo =
    Object.prototype.hasOwnProperty.call(rawData, "tipo_ficha") &&
    rawData.tipo_ficha !== undefined &&
    rawData.tipo_ficha !== null &&
    String(rawData.tipo_ficha).trim() !== "";
  var tipoEfetivo = hasExplicitTipo
    ? String(rawData.tipo_ficha)
    : opInfo.kind === "bestiary_monster"
    ? "monstro"
    : "npc";

  return {
    data: copyData,
    operationalInfo: opInfo,
    tipoFichaEfetivo: tipoEfetivo,
    hasExplicitTipoFicha: hasExplicitTipo,
    damagedChambers: sixBInfo.damagedChambers.slice(),
    hasExplicitDamagedChambers: Array.isArray(rawData.damagedChambers),
    inventoryItems: Array.isArray(rawData.inventoryItems)
      ? deepClone(rawData.inventoryItems)
      : [],
    hasExplicitInventoryItems: Array.isArray(rawData.inventoryItems),
    attacks: OS.getSceneCreatureAttacks ? OS.getSceneCreatureAttacks(copyData) : [],
    sixBInfo: sixBInfo
  };
};

if (typeof resolveIndividual6BInitiative === "function") {
  OS.resolveIndividual6BInitiative = resolveIndividual6BInitiative;
} else {
  OS.resolveIndividual6BInitiative = function (sheetData) {
    var d = sheetData && sheetData.data ? sheetData.data : sheetData && sheetData.dados ? sheetData.dados : sheetData || {};
    var sum = (parseInt(d["chamber-0"] || 0, 10) || 0) + (parseInt(d["chamber-1"] || 0, 10) || 0) + (parseInt(d["chamber-2"] || 0, 10) || 0);
    var exp = OS.normalizeMesaInitiative(d.iniciativa);
    return exp !== 0 ? exp : sum;
  };
}
if (typeof resolveCombatantInitiativeMode === "function") {
  OS.resolveCombatantInitiativeMode = resolveCombatantInitiativeMode;
}
if (typeof computeCascadeInitiatives === "function") {
  OS.computeCascadeInitiatives = computeCascadeInitiatives;
}
if (typeof extractMonsterFixedActions === "function") {
  OS.extractMonsterFixedActions = extractMonsterFixedActions;
}
if (typeof inspectCombatConditionsForActions === "function") {
  OS.inspectCombatConditionsForActions = inspectCombatConditionsForActions;
}
if (typeof evaluateSheetOverloadForActions === "function") {
  OS.evaluateSheetOverloadForActions = evaluateSheetOverloadForActions;
}
if (typeof computeTurnActionBudget === "function") {
  OS.computeTurnActionBudget = computeTurnActionBudget;
}
if (typeof CANONICAL_ACTION_COSTS !== "undefined") {
  OS.CANONICAL_ACTION_COSTS = CANONICAL_ACTION_COSTS;
}
if (typeof ALLOWED_REACTION_ACTION_TYPES !== "undefined") {
  OS.ALLOWED_REACTION_ACTION_TYPES = ALLOWED_REACTION_ACTION_TYPES;
}
if (typeof resolveCanonicalActionCost === "function") {
  OS.resolveCanonicalActionCost = resolveCanonicalActionCost;
}
if (typeof createCombatantActionState === "function") {
  OS.createCombatantActionState = createCombatantActionState;
}
if (typeof computeAvailableActionsFromState === "function") {
  OS.computeAvailableActionsFromState = computeAvailableActionsFromState;
}
if (typeof hasPendingActionReservations === "function") {
  OS.hasPendingActionReservations = hasPendingActionReservations;
}
if (typeof applyActionControllerOperation === "function") {
  OS.applyActionControllerOperation = applyActionControllerOperation;
}

/**
 * Resolve o orçamento de ações inicial (COM-06) para qualquer item de combate,
 * token, instância de cena, NPC da mesa ou ficha de jogador, usando apenas a
 * iniciativa vigente da rodada e sem depender do DOM.
 */
OS.computeCombatantTurnBudget = function (targetOrItem, roundNum, options) {
  options = options || {};
  var st = OS.activeMesaState || {};
  var raw = targetOrItem && typeof targetOrItem === "object" ? targetOrItem : {};
  var combatantId = null;
  var sheetData = null;
  var opInfo = null;
  var linkedToken = null;
  var sceneInst = null;
  var playerRow = null;

  if (raw.token_id || (raw.id && raw.owner_ref !== undefined && raw.owner_type)) {
    combatantId = String(raw.token_id || raw.id);
    if (Array.isArray(st.mesaTokens)) {
      linkedToken =
        st.mesaTokens.find(function (t) {
          return t && String(t.id) === combatantId;
        }) || null;
    }
    var oType = raw.owner_type || (linkedToken && linkedToken.owner_type);
    var oRef = raw.owner_ref !== undefined ? raw.owner_ref : linkedToken && linkedToken.owner_ref;
    if (oType === "player") {
      if (Array.isArray(st.playerSheets)) {
        playerRow =
          st.playerSheets.find(function (r) {
            return r && String(r.id) === String(oRef);
          }) || null;
      }
      sheetData = (playerRow && playerRow.dados) || null;
      opInfo = OS.resolveCombatantOperationalInfo(
        playerRow || { dados: { tipo_ficha: "jogador", freeEdit: false } },
        { ownerType: "player", isPlayer: true }
      );
    } else {
      if (Array.isArray(st.sceneCreatures)) {
        sceneInst =
          st.sceneCreatures.find(function (c) {
            return c && String(c.instanceId) === String(oRef);
          }) || null;
      }
      sheetData = (sceneInst && sceneInst.data) || null;
      opInfo = sceneInst
        ? OS.resolveCombatantOperationalInfo(sceneInst)
        : OS.resolveCombatantOperationalInfo(linkedToken || raw);
    }
  } else if (raw.instanceId) {
    if (Array.isArray(st.mesaTokens)) {
      linkedToken =
        st.mesaTokens.find(function (t) {
          return t && t.owner_type === "creature" && String(t.owner_ref) === String(raw.instanceId);
        }) || null;
    }
    combatantId =
      options.preferTokenId && linkedToken
        ? String(linkedToken.id)
        : String(raw.instanceId);
    sheetData = raw.data || null;
    opInfo = OS.resolveCombatantOperationalInfo(raw);
  } else if (raw.dados) {
    combatantId = raw.id ? String(raw.id) : options.combatantId || null;
    sheetData = raw.dados;
    opInfo = OS.resolveCombatantOperationalInfo(raw, options);
  } else {
    combatantId = options.combatantId || null;
    sheetData = raw.data || raw;
    opInfo = OS.resolveCombatantOperationalInfo(raw, options);
  }

  var currentInit =
    options.currentInitiative !== undefined
      ? OS.normalizeMesaInitiative(options.currentInitiative)
      : raw.currentInitiative !== undefined
      ? OS.normalizeMesaInitiative(raw.currentInitiative)
      : raw.iniciativa !== undefined
      ? OS.normalizeMesaInitiative(raw.iniciativa)
      : linkedToken && linkedToken.iniciativa !== undefined &&
        (opInfo.kind !== "player" && opInfo.operationalMode !== "full_sheet")
      ? OS.normalizeMesaInitiative(linkedToken.iniciativa)
      : (opInfo.kind === "player" || opInfo.operationalMode === "full_sheet") && sheetData
      ? OS.resolveIndividual6BInitiative(sheetData)
      : linkedToken && linkedToken.iniciativa !== undefined
      ? OS.normalizeMesaInitiative(linkedToken.iniciativa)
      : 0;

  // Para full_sheet fora do combate (ou sem valor no token), garante leitura do 6B se token/item = 0 e sheetData > 0
  if (
    options.currentInitiative === undefined &&
    raw.currentInitiative === undefined &&
    (opInfo.kind === "player" || opInfo.operationalMode === "full_sheet") &&
    currentInit === 0 &&
    sheetData
  ) {
    var derived6B = OS.resolveIndividual6BInitiative(sheetData);
    if (derived6B !== 0) currentInit = derived6B;
  }

  var rNum =
    roundNum !== undefined && roundNum !== null
      ? roundNum
      : (st.combateAtivo && st.combateAtivo.round) || 1;

  if (typeof computeTurnActionBudget === "function") {
    return computeTurnActionBudget({
      combatantId: combatantId,
      round: rNum,
      kind: opInfo.kind,
      operationalMode: opInfo.operationalMode,
      isOfficialMonster: opInfo.isOfficialMonster,
      currentInitiative: currentInit,
      sheetData: sheetData,
      conditions: options.conditions,
      isOverloaded: options.isOverloaded,
      overloadBonusPenalty: options.overloadBonusPenalty,
      inTotalCover: options.inTotalCover,
      fixedActions: options.fixedActions
    });
  }

  // Fallback seguro quando importado sem ./rules/index.js (ex.: harnesses Node vm isolados)
  if (opInfo.operationalMode === null && opInfo.kind !== "player" && !opInfo.isOfficialMonster) {
    return { combatantId: combatantId, round: rNum, kind: opInfo.kind, operationalMode: null, currentInitiative: currentInit, budgetDefined: false, pendingReason: "legacy_npc_operational_mode_unset", initialBudget: null, availableActions: null, ledger: [] };
  }
  if (opInfo.isOfficialMonster || opInfo.kind === "bestiary_monster") {
    return { combatantId: combatantId, round: rNum, kind: "bestiary_monster", operationalMode: opInfo.operationalMode || "creature_mode", currentInitiative: currentInit, budgetDefined: false, pendingReason: "bestiary_monster_fixed_actions_undefined", initialBudget: null, availableActions: null, ledger: [] };
  }
  if (opInfo.operationalMode === "creature_mode") {
    return { combatantId: combatantId, round: rNum, kind: opInfo.kind, operationalMode: "creature_mode", currentInitiative: currentInit, budgetDefined: true, pendingReason: null, baseActions: 1, bonusActionsRaw: 0, initialBudget: 1, availableActions: 1, ledger: [] };
  }
  var fallbackBonus = Math.floor(Math.max(0, currentInit) / 5);
  return { combatantId: combatantId, round: rNum, kind: opInfo.kind, operationalMode: "full_sheet", currentInitiative: currentInit, budgetDefined: true, pendingReason: null, baseActions: 1, bonusActionsRaw: fallbackBonus, initialBudget: 1 + fallbackBonus, availableActions: 1 + fallbackBonus, ledger: [] };
};

function sanitizeNpcsMesaListInPlace(list) {
  var anyMutated = false;
  if (!Array.isArray(list)) return false;
  list.forEach(function (item) {
    if (item && item.data && typeof item.data === "object") {
      var san = OS.sanitizeCreature6BData(item.data);
      if (san.mutated) anyMutated = true;
    }
  });
  return anyMutated;
}

OS.getCurrentUserId = async function () {
  if (OS.authSession && OS.authSession.userId) {
    return OS.authSession.userId;
  }
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (client && client.auth && client.auth.getUser) {
    try {
      var res = await client.auth.getUser();
      if (res && res.data && res.data.user && res.data.user.id) {
        if (OS.authSession) OS.authSession.userId = res.data.user.id;
        return res.data.user.id;
      }
    } catch (e) {
      /* ignore */
    }
  }
  return null;
};

async function ensureUsuarioProfile() {
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!client || !uid) return null;
  var email = (OS.authSession && OS.authSession.email) || "";
  var username =
    (OS.authSession && OS.authSession.username) ||
    (email ? email.split("@")[0] : "usuario_" + uid.slice(0, 6));
  try {
    await client.from("usuarios").upsert(
      {
        id: uid,
        email: email || username + "@darkwest.local",
        username: username + "_" + uid.slice(0, 4)
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
  } catch (e) {
    /* ignore */
  }
  return uid;
}

/* ─── 1. Listagem, Criação e Entrada em Mesas (#home-panel-mesas) ─── */

OS.readAccessibleMesa = async function (mesaId) {
  var client = OS.getSupabaseClient();
  var res = await client.rpc("listar_mesas_acessiveis", { p_mesa_id: mesaId });
  if (res.error) return res;
  var mesa = (res.data || [])[0];
  if (!mesa) return { data: null, error: { message: "Mesa não encontrada ou acesso negado" } };
  if (String(mesa.mestre_id) === String(await OS.getCurrentUserId())) {
    return client.from("mesas").select("*").eq("id", mesaId).single();
  }
  return { data: mesa, error: null };
};

OS.getSceneToken = function (instanceId) {
  return (OS.activeMesaState.mesaTokens || []).find(function (t) {
    return t.owner_type === "creature" && String(t.owner_ref) === String(instanceId);
  });
};

OS.getPlayerSceneToken = function (fichaId) {
  return (OS.activeMesaState.mesaTokens || []).find(function (t) {
    return t.owner_type === "player" && String(t.owner_ref) === String(fichaId);
  }) || null;
};

OS.appendTokenVisibilityButton = function (container, token) {
  if (!container || !OS.activeMesaState.isMestre) return;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary btn-small mesa-token-visibility";
  btn.textContent = token && token.visible_to_players ? "🙈 Ocultar dos Players" : "👁 Mostrar aos Players";
  btn.disabled = !token;
  btn.title = token ? "Visibilidade no mapa dos outros jogadores" : "Coloque esta criatura em cena primeiro";
  btn.addEventListener("click", async function (ev) {
    ev.stopPropagation();
    if (!token || btn.disabled) return;
    btn.disabled = true;
    var mesaId = OS.activeMesaState.mesaId;
    try {
      var res = await OS.getSupabaseClient().rpc("definir_visibilidade_token", {
        p_token_id: token.id, p_visible: !token.visible_to_players
      });
      if (res.error) throw res.error;
      if (OS.activeMesaState.mesaId !== mesaId) return;
      await OS.loadMesaTokens(mesaId);
      OS.renderMesaFloatingPopups();
    } catch (err) {
      alert("Não foi possível alterar a visibilidade: " + (err.message || err));
    } finally { btn.disabled = false; }
  });
  container.appendChild(btn);
};

OS.fetchUserMesas = async function () {
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!client || !uid) {
    return { gmTables: [], playerTables: [] };
  }

  var mesasRes = await client.rpc("listar_mesas_acessiveis", {});
  var membrosRes = await client
    .from("membros_mesa")
    .select("*")
    .eq("usuario_id", uid);

  var mesas = (mesasRes && Array.isArray(mesasRes.data)) ? mesasRes.data : [];
  var membros = (membrosRes && Array.isArray(membrosRes.data)) ? membrosRes.data : [];
  var membroByMesa = {};
  membros.forEach(function (m) {
    if (m && m.mesa_id) membroByMesa[m.mesa_id] = m;
  });

  var gmTables = [];
  var playerTables = [];

  mesas.forEach(function (mesa) {
    var membro = membroByMesa[mesa.id] || null;
    var isMestre =
      mesa.mestre_id === uid || !!(membro && membro.cargo === "mestre");
    var entry = {
      id: mesa.id,
      nome: mesa.nome || "Mesa sem nome",
      descricao: mesa.descricao || "",
      sistema: mesa.sistema || "Dark West",
      mestre_id: mesa.mestre_id,
      codigo_convite: mesa.codigo_convite || "",
      mapa_url: mesa.mapa_url || "",
      npcs_mesa: Array.isArray(mesa.npcs_mesa) ? mesa.npcs_mesa : [],
      grid_cols: parseInt(String(mesa.grid_cols || 24), 10) || 24,
      cena_ativa: mesa.cena_ativa,
      created_at: mesa.created_at,
      membro: membro,
      isMestre: isMestre,
      papel: isMestre ? "GM" : "Player"
    };
    if (isMestre) {
      gmTables.push(entry);
    } else {
      playerTables.push(entry);
    }
  });

  return { gmTables: gmTables, playerTables: playerTables };
};

function buildRealMesaCard(entry) {
  var card = document.createElement("article");
  card.className =
    "mesa-card " + (entry.isMestre ? "mesa-card-gm" : "mesa-card-player");
  card.dataset.mesaId = entry.id;
  card.style.cursor = "pointer";

  var topRow = document.createElement("div");
  topRow.className = "mesa-card-top";

  var title = document.createElement("h3");
  title.className = "mesa-card-title";
  title.textContent = entry.nome;

  var badge = document.createElement("span");
  badge.className =
    "mesa-role-badge " + (entry.isMestre ? "badge-gm" : "badge-player");
  badge.textContent = entry.isMestre ? "Mestre" : "Jogador";

  topRow.appendChild(title);
  topRow.appendChild(badge);

  var infoRow = document.createElement("div");
  infoRow.className = "mesa-card-info";

  if (entry.codigo_convite) {
    var codeTag = document.createElement("span");
    codeTag.className = "mesa-info-pill";
    codeTag.textContent = "Código: " + entry.codigo_convite;
    infoRow.appendChild(codeTag);
  }

  var sysTag = document.createElement("span");
  sysTag.className = "mesa-info-pill";
  sysTag.textContent = entry.sistema || "Dark West";
  infoRow.appendChild(sysTag);

  var footerRow = document.createElement("div");
  footerRow.className = "mesa-card-footer";

  var detail = document.createElement("span");
  detail.className = "mesa-card-meta";
  detail.textContent = entry.descricao || "Clique para entrar na mesa";

  var footerActions = document.createElement("div");
  footerActions.style.display = "flex";
  footerActions.style.alignItems = "center";
  footerActions.style.gap = "8px";

  if (entry.isMestre) {
    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-secondary btn-small btn-excluir-mesa-card";
    delBtn.textContent = "Excluir Mesa";
    delBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      OS.confirmDeleteMesa(entry.id, entry.nome);
    });
    footerActions.appendChild(delBtn);
  }

  var openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn btn-danger btn-small btn-entrar-mesa-card";
  openBtn.textContent = "Abrir Mesa";
  openBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    OS.openMesa(entry.id);
  });
  footerActions.appendChild(openBtn);

  footerRow.appendChild(detail);
  footerRow.appendChild(footerActions);

  card.appendChild(topRow);
  card.appendChild(infoRow);
  card.appendChild(footerRow);

  card.addEventListener("click", function () {
    OS.openMesa(entry.id);
  });

  return card;
}

OS.confirmDeleteMesa = function (mesaId, mesaNome) {
  if (!mesaId) return;
  var existing = document.getElementById("modal-delete-mesa");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  var overlay = document.createElement("div");
  overlay.id = "modal-delete-mesa";
  overlay.className = "modal-overlay open";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "modal-delete-mesa-title");

  var safeName = escHtml(mesaNome || "esta mesa");
  overlay.innerHTML =
    '<div class="modal-box">' +
    '<p id="modal-delete-mesa-title">Tem certeza que deseja excluir a mesa ' +
    safeName +
    "? Esta ação não pode ser desfeita.</p>" +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-danger" id="modal-delete-mesa-confirm">Excluir Mesa</button>' +
    '<button type="button" class="btn btn-secondary" id="modal-delete-mesa-cancel">Cancelar</button>' +
    "</div></div>";

  document.body.appendChild(overlay);

  var closeModal = function () {
    overlay.classList.remove("open");
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  var btnConfirm = document.getElementById("modal-delete-mesa-confirm");
  var btnCancel = document.getElementById("modal-delete-mesa-cancel");

  if (btnConfirm) {
    btnConfirm.addEventListener("click", async function () {
      btnConfirm.disabled = true;
      try {
        await OS.deleteMesa(mesaId);
      } finally {
        closeModal();
      }
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", function () {
      closeModal();
    });
  }

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });
};

OS.deleteMesa = async function (mesaId) {
  if (!mesaId) return false;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!client || !uid) return false;

  // Antes do DELETE na mesa (ou em paralelo), limpa dados.mesa_id nas fichas próprias vinculadas no banco
  // O banco já faz ON DELETE SET NULL na coluna fichas.mesa_id para todos os jogadores.
  var delRes = await client
    .from("mesas")
    .delete()
    .eq("id", mesaId);

  if (delRes && delRes.error) {
    console.error("[mesaScreen] Erro ao excluir mesa:", delRes.error);
    alert("Não foi possível excluir a mesa: " + (delRes.error.message || "Erro desconhecido"));
    return false;
  }

  // Limpa o espelho local da cena da mesa excluída
  try {
    localStorage.removeItem(getSceneLocalStorageKey(mesaId));
  } catch (e) {
    /* ignore */
  }

  // Limpa dados.mesa_id nas fichas próprias no Supabase caso o JSONB ainda guardasse o ID antigo
  try {
    var ownFichas = await client
      .from("fichas")
      .select("id, dados, mesa_id")
      .eq("usuario_id", uid)
      .is("mesa_id", null);
    if (ownFichas && Array.isArray(ownFichas.data)) {
      for (var rIdx = 0; rIdx < ownFichas.data.length; rIdx++) {
        var r = ownFichas.data[rIdx];
        if (r && r.dados && (r.dados.mesa_id === mesaId || r.dados.mesaId === mesaId)) {
          var updatedDados = deepClone(r.dados);
          delete updatedDados.mesa_id;
          delete updatedDados.mesaId;
          await client.from("fichas").update({ dados: updatedDados }).eq("id", r.id);
        }
      }
    }
  } catch (e) {
    /* ignore */
  }

  // Limpa dados.mesa_id no cache local de personagens
  if (OS.listCharacters && OS.loadCharacterFile && OS.saveCharacterFile) {
    try {
      var chars = (await OS.listCharacters()) || [];
      for (var i = 0; i < chars.length; i++) {
        var item = chars[i];
        var payload = null;
        try {
          payload = await OS.loadCharacterFile(item.filename);
        } catch (readErr) {
          payload = null;
        }
        if (!payload) continue;
        var currentMesaId = OS.getCharacterMesaId ? OS.getCharacterMesaId(payload, item) : null;
        if (currentMesaId === String(mesaId)) {
          if (payload.meta && typeof payload.meta === "object") {
            delete payload.meta.mesa_id;
            delete payload.meta.mesaId;
          }
          var dataObj = OS.unwrapCharacterPayload ? OS.unwrapCharacterPayload(payload) : payload.data;
          if (dataObj && typeof dataObj === "object") {
            delete dataObj.mesa_id;
            delete dataObj.mesaId;
          }
          await OS.saveCharacterFile(item.filename, payload);
        }
      }
    } catch (localErr) {
      console.warn("[deleteMesa] Falha ao limpar mesa_id local:", localErr);
    }
  }

  await OS.renderMesasList();
  if (OS.renderCharactersList) {
    await OS.renderCharactersList();
  }
  return true;
};

OS.renderMesasList = async function () {
  var gmGrid = OS.$("mesas-gm-grid");
  var playerGrid = OS.$("mesas-player-grid");
  if (!gmGrid && !playerGrid) return;

  try {
    var res = await OS.fetchUserMesas();
    if (gmGrid) {
      gmGrid.innerHTML = "";
      if (!res.gmTables.length) {
        gmGrid.innerHTML =
          '<p class="characters-empty">Nenhuma mesa onde você é Mestre. Clique em "Criar Mesa".</p>';
      } else {
        res.gmTables.forEach(function (entry) {
          gmGrid.appendChild(buildRealMesaCard(entry));
        });
      }
    }
    if (playerGrid) {
      playerGrid.innerHTML = "";
      if (!res.playerTables.length) {
        playerGrid.innerHTML =
          '<p class="characters-empty">Nenhuma mesa onde você participa como Jogador. Use "Entrar com Código".</p>';
      } else {
        res.playerTables.forEach(function (entry) {
          playerGrid.appendChild(buildRealMesaCard(entry));
        });
      }
    }
  } catch (err) {
    console.error("[mesaScreen] Erro ao carregar mesas:", err);
  }
};

OS.createMesa = async function (nomeArg, descricaoArg) {
  var nome =
    nomeArg !== undefined
      ? String(nomeArg).trim()
      : window.prompt("Nome da nova Mesa:");
  if (!nome) return null;

  var descricao =
    descricaoArg !== undefined ? String(descricaoArg).trim() : "";

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await ensureUsuarioProfile();
  if (!client || !uid) {
    alert("Faça login antes de criar uma mesa.");
    return null;
  }

  var code = generateInviteCode();
  var insertRes = await client
    .from("mesas")
    .insert({
      nome: nome,
      descricao: descricao,
      sistema: "Dark West",
      mestre_id: uid,
      codigo_convite: code,
      cena_ativa: []
    })
    .select("*")
    .single();

  if (insertRes.error || !insertRes.data) {
    console.error("[mesaScreen] Erro ao criar mesa:", insertRes.error);
    alert(
      "Não foi possível criar a mesa: " +
        ((insertRes.error && insertRes.error.message) || "Erro desconhecido")
    );
    return null;
  }

  var novaMesa = insertRes.data;
  var memberRes = await client.from("membros_mesa").insert({
    mesa_id: novaMesa.id,
    usuario_id: uid,
    cargo: "mestre"
  });
  if (memberRes.error) {
    console.error("[mesaScreen] Erro ao registrar o Mestre:", memberRes.error);
    alert("A mesa foi criada, mas não foi possível registrar seu vínculo de Mestre: " + memberRes.error.message);
  }

  await OS.renderMesasList();
  return novaMesa;
};

OS.joinMesaByCode = async function (codeArg) {
  var code =
    codeArg !== undefined
      ? String(codeArg).trim().toUpperCase()
      : window.prompt("Digite o código de convite da mesa:");
  if (!code) return null;
  code = String(code).trim().toUpperCase();

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await ensureUsuarioProfile();
  if (!client || !uid) {
    alert("Faça login antes de entrar em uma mesa.");
    return null;
  }

  var rpcRes = await client.rpc("entrar_na_mesa_por_codigo", { p_codigo: code });
  if (rpcRes.error) {
    console.error("[mesaScreen] Erro ao entrar na mesa:", rpcRes.error);
    alert(
      "Não foi possível entrar na mesa: " +
        (rpcRes.error.message || "Código inválido")
    );
    return null;
  }

  await OS.renderMesasList();
  return rpcRes.data;
};

/* ─── 2 & 3. Identificação de Papel (isMestre) e Abertura da #mesa-screen ─── */

OS.calculateIsMestre = function (mesa, membro, currentUserId) {
  if (!mesa || !currentUserId) return false;
  return (
    mesa.mestre_id === currentUserId ||
    !!(membro && membro.cargo === "mestre")
  );
};

function moveFichaIntoMesaSlot() {
  var container = OS.$("mesa-sheet-container");
  var ficha = OS.$("ficha");
  var toolbar = document.querySelector(".toolbar");
  if (!container) return;
  if (ficha && ficha.parentElement !== container) {
    container.appendChild(ficha);
  }
  if (toolbar && toolbar.parentElement !== container) {
    container.appendChild(toolbar);
  }
}

/* ─── Palco do Mapa (#mesa-map-stage), Upload de Mapa e Grade 1:1 ─── */

function showMesaMapUploadStatus(msg, isError, isLoading) {
  var el = OS.$("mesa-map-upload-status");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.hidden = true;
    el.setAttribute("hidden", "");
    el.className = "mesa-map-upload-status";
    return;
  }
  el.textContent = msg;
  el.className =
    "mesa-map-upload-status" +
    (isError ? " is-error" : isLoading ? " is-loading" : " is-success");
  el.hidden = false;
  el.removeAttribute("hidden");
}

// Câmera exclusivamente local: nunca integra o estado persistido da mesa.
OS.mapCamera = { zoom: 1, minZoom: 0.25, maxZoom: 3, panX: 0, panY: 0,
  isPanning: false, startX: 0, startY: 0, pointerId: null };

OS.applyMapCamera = function () {
  var c = OS.mapCamera;
  var canvas = OS.$("mesa-map-canvas");
  if (canvas) canvas.style.transform = "translate(" + c.panX + "px, " + c.panY + "px) scale(" + c.zoom + ")";
  var viewport = OS.$("mesa-map-viewport");
  if (viewport) viewport.classList.toggle("is-panning", c.isPanning);
};

OS.stopMapPan = function () {
  var c = OS.mapCamera, pointerId = c.pointerId;
  c.isPanning = false;
  c.pointerId = null;
  var viewport = OS.$("mesa-map-viewport");
  if (viewport && pointerId != null && viewport.hasPointerCapture(pointerId)) {
    viewport.releasePointerCapture(pointerId);
  }
  OS.applyMapCamera();
};

OS.resetMapCamera = function () {
  if (OS.activeMesaState.isDraggingLocal) return;
  OS.stopMapPan();
  Object.assign(OS.mapCamera, { zoom: 1, panX: 0, panY: 0, startX: 0, startY: 0 });
  OS.applyMapCamera();
};

OS.zoomMapCamera = function (zoom, clientX, clientY) {
  var c = OS.mapCamera, viewport = OS.$("mesa-map-viewport");
  if (!viewport || c.isPanning || OS.activeMesaState.isDraggingLocal) return;
  var rect = viewport.getBoundingClientRect();
  var x = clientX == null ? viewport.clientWidth / 2 : clientX - rect.left - viewport.clientLeft;
  var y = clientY == null ? viewport.clientHeight / 2 : clientY - rect.top - viewport.clientTop;
  var next = Math.max(c.minZoom, Math.min(c.maxZoom, zoom));
  c.panX = x - (x - c.panX) * next / c.zoom;
  c.panY = y - (y - c.panY) * next / c.zoom;
  c.zoom = next;
  OS.applyMapCamera();
};

OS.fitMapCamera = function () {
  var c = OS.mapCamera, viewport = OS.$("mesa-map-viewport"), canvas = OS.$("mesa-map-canvas");
  if (!viewport || !canvas || !canvas.offsetWidth || !canvas.offsetHeight ||
      !viewport.clientWidth || !viewport.clientHeight || OS.activeMesaState.isDraggingLocal) return;
  OS.stopMapPan();
  c.zoom = Math.max(c.minZoom, Math.min(c.maxZoom,
    viewport.clientWidth / canvas.offsetWidth, viewport.clientHeight / canvas.offsetHeight));
  c.panX = (viewport.clientWidth - canvas.offsetWidth * c.zoom) / 2;
  c.panY = (viewport.clientHeight - canvas.offsetHeight * c.zoom) / 2;
  OS.applyMapCamera();
};

OS.positionMapCameraControls = function () {
  var stage = OS.$("mesa-map-stage");
  var controls = stage && stage.querySelector(".mesa-map-zoom-controls");
  if (!controls) return;
  controls.style.bottom = "16px";
  var hub = OS.$("mesa-popups-hub");
  if (!hub || hub.hidden) return;
  var h = hub.getBoundingClientRect(), r = controls.getBoundingClientRect();
  if (h.width && h.height && r.left < h.right + 8 && r.right > h.left && r.bottom > h.top - 8 && r.top < h.bottom) {
    controls.style.bottom = Math.max(16, stage.getBoundingClientRect().bottom - h.top + 8) + "px";
  }
};

OS.bindMapCameraEvents = function () {
  var viewport = OS.$("mesa-map-viewport");
  if (!viewport || viewport._cameraBound) return;
  viewport._cameraBound = true;
  viewport.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  viewport.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    // Normaliza linhas/páginas e limita saltos em dispositivos de roda diferentes.
    var delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? viewport.clientHeight : 1);
    OS.zoomMapCamera(OS.mapCamera.zoom * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), ev.clientX, ev.clientY);
  }, { passive: false });
  viewport.addEventListener("pointerdown", function (ev) {
    var c = OS.mapCamera;
    if (ev.button !== 2 || c.isPanning || OS.activeMesaState.isDraggingLocal) return;
    ev.preventDefault();
    c.isPanning = true;
    c.pointerId = ev.pointerId;
    c.startX = ev.clientX - c.panX;
    c.startY = ev.clientY - c.panY;
    try { viewport.setPointerCapture(ev.pointerId); } catch (_) { /* ponteiro sintético */ }
    OS.applyMapCamera();
  });
  window.addEventListener("pointermove", function (ev) {
    var c = OS.mapCamera;
    if (!c.isPanning || c.pointerId !== ev.pointerId) return;
    if (!(ev.buttons & 2)) { OS.stopMapPan(); return; }
    c.panX = ev.clientX - c.startX;
    c.panY = ev.clientY - c.startY;
    OS.applyMapCamera();
  });
  function endPan(ev) {
    if (OS.mapCamera.isPanning && OS.mapCamera.pointerId === ev.pointerId) OS.stopMapPan();
  }
  window.addEventListener("pointerup", endPan);
  window.addEventListener("pointercancel", endPan);
  viewport.addEventListener("lostpointercapture", endPan);
  window.addEventListener("blur", OS.stopMapPan);
  var actions = {
    "btn-mesa-map-zoom-in": function () { OS.zoomMapCamera(OS.mapCamera.zoom + 0.25); },
    "btn-mesa-map-zoom-out": function () { OS.zoomMapCamera(OS.mapCamera.zoom - 0.25); },
    "btn-mesa-map-zoom-reset": OS.resetMapCamera,
    "btn-mesa-map-zoom-fit": OS.fitMapCamera
  };
  Object.keys(actions).forEach(function (id) {
    var button = OS.$(id);
    if (button) button.addEventListener("click", actions[id]);
  });
  window.addEventListener("resize", OS.positionMapCameraControls);
  if (typeof ResizeObserver === "function") {
    var cameraLayoutObserver = new ResizeObserver(OS.positionMapCameraControls);
    [OS.$("mesa-map-stage"), OS.$("mesa-popups-hub")].forEach(function (el) {
      if (el) cameraLayoutObserver.observe(el);
    });
  }
  OS.positionMapCameraControls();
  OS.applyMapCamera();
};

OS.getMesaGridMetrics = function () {
  var cols = Math.max(
    4,
    Math.min(
      64,
      parseInt(
        String((OS.activeMesaState && OS.activeMesaState.gridCols) || 24),
        10
      ) || 24
    )
  );
  var canvasEl = OS.$("mesa-map-canvas");
  var viewportEl = OS.$("mesa-map-viewport");
  // clientWidth/clientHeight são lógicos e não incluem o transform da câmera.
  var refWidth =
    (canvasEl && canvasEl.clientWidth) ||
    (viewportEl && viewportEl.clientWidth) ||
    960;
  var cellPx = refWidth > 0 ? refWidth / cols : 40;
  var refHeight =
    (canvasEl && canvasEl.clientHeight) ||
    (viewportEl && viewportEl.clientHeight) ||
    Math.max(360, cellPx * 10);
  var rows = Math.max(1, Math.floor(refHeight / cellPx));
  return {
    cols: cols,
    rows: rows,
    cellPx: cellPx,
    width: refWidth,
    height: refHeight
  };
};

OS.syncMesaGridOverlay = function () {
  var metrics = OS.getMesaGridMetrics();
  var cols = metrics.cols;
  var cellPx = metrics.cellPx;

  var valEl = OS.$("mesa-grid-cols-value");
  if (valEl) {
    valEl.textContent = cols + " col";
  }

  var canvasEl = OS.$("mesa-map-canvas");
  if (canvasEl) {
    canvasEl.style.setProperty("--grid-cols", String(cols));
    canvasEl.style.setProperty("--grid-cell-px", cellPx.toFixed(3) + "px");
  }

  var overlayEl = OS.$("mesa-map-grid-overlay");
  if (overlayEl) {
    overlayEl.dataset.gridCols = String(cols);
    overlayEl.style.setProperty("--grid-cols", String(cols));
    overlayEl.style.setProperty("--grid-cell-px", cellPx.toFixed(3) + "px");
  }

  if (OS.positionMesaMapTokens) {
    OS.positionMesaMapTokens();
  }
};

OS.updateMesaMapBackdropDom = function () {
  var st = OS.activeMesaState || {};
  var isMestre = !!st.isMestre;
  var mapaUrl = st.mapaUrl ? String(st.mapaUrl).trim() : "";

  var mapToolbar = OS.$("mesa-map-toolbar");
  if (mapToolbar) {
    if (isMestre) {
      mapToolbar.removeAttribute("hidden");
      mapToolbar.hidden = false;
    } else {
      mapToolbar.setAttribute("hidden", "");
      mapToolbar.hidden = true;
    }
  }

  var btnEmptyUpload = OS.$("btn-mesa-map-empty-upload");
  if (btnEmptyUpload) {
    if (isMestre) {
      btnEmptyUpload.removeAttribute("hidden");
      btnEmptyUpload.hidden = false;
    } else {
      btnEmptyUpload.setAttribute("hidden", "");
      btnEmptyUpload.hidden = true;
    }
  }

  var canvasEl = OS.$("mesa-map-canvas");
  var imgEl = OS.$("mesa-map-image");
  var emptyEl = OS.$("mesa-map-empty-state");

  if (mapaUrl) {
    if (canvasEl) canvasEl.classList.add("has-map");
    if (imgEl) {
      if (imgEl.getAttribute("src") !== mapaUrl) {
        imgEl.src = mapaUrl;
      }
      imgEl.removeAttribute("hidden");
      imgEl.hidden = false;
    }
    if (emptyEl) {
      emptyEl.setAttribute("hidden", "");
      emptyEl.hidden = true;
    }
  } else {
    if (canvasEl) canvasEl.classList.remove("has-map");
    if (imgEl) {
      imgEl.removeAttribute("src");
      imgEl.setAttribute("hidden", "");
      imgEl.hidden = true;
    }
    if (emptyEl) {
      emptyEl.removeAttribute("hidden");
      emptyEl.hidden = false;
    }
  }

  OS.syncMesaGridOverlay();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(function () {
      OS.syncMesaGridOverlay();
    });
  }
};

OS.renderMesaMapStage = function () {
  OS.updateMesaMapBackdropDom();
  if (
    OS.renderMesaMapTokens &&
    !(OS.activeMesaState && OS.activeMesaState.isDraggingLocal)
  ) {
    OS.renderMesaMapTokens();
  }
};

OS.canCurrentUserMoveToken = function (token) {
  var st = OS.activeMesaState;
  if (!token || !st || !st.mesaId) return false;
  if (st.isMestre) return true;
  var uid =
    st.currentUserId || (OS.authSession && OS.authSession.userId) || null;
  if (!uid) return false;
  return (
    token.owner_type === "player" &&
    (token.is_own === true || String(token.owner_user_id || "") === String(uid))
  );
};

OS.findFirstFreeGridCell = function () {
  var metrics = OS.getMesaGridMetrics();
  var cols = metrics.cols;
  var maxRowsScan = Math.max(metrics.rows, 64);
  var occupied = {};
  var tokens = (OS.activeMesaState && OS.activeMesaState.mesaTokens) || [];
  tokens.forEach(function (t) {
    if (!t) return;
    var gx = Math.max(0, parseInt(String(t.grid_x || 0), 10) || 0);
    var gy = Math.max(0, parseInt(String(t.grid_y || 0), 10) || 0);
    occupied[gx + "," + gy] = true;
  });

  for (var y = 0; y < maxRowsScan; y++) {
    for (var x = 0; x < cols; x++) {
      if (!occupied[x + "," + y]) {
        return { x: x, y: y };
      }
    }
  }
  return { x: 0, y: maxRowsScan };
};

OS.positionMesaMapTokens = function () {
  var layerEl = OS.$("mesa-map-tokens-layer");
  if (!layerEl) return;
  var metrics = OS.getMesaGridMetrics();
  var cellPx = metrics.cellPx;
  var cols = metrics.cols;

  var nodes = layerEl.querySelectorAll(".mesa-map-token");
  nodes.forEach(function (node) {
    if (node.classList.contains("is-dragging")) return;
    var gx = Math.max(
      0,
      Math.min(cols - 1, parseInt(node.dataset.gridX || "0", 10) || 0)
    );
    var gy = Math.max(0, parseInt(node.dataset.gridY || "0", 10) || 0);
    node.style.width = cellPx.toFixed(3) + "px";
    node.style.height = cellPx.toFixed(3) + "px";
    node.style.left = (gx * cellPx).toFixed(3) + "px";
    node.style.top = (gy * cellPx).toFixed(3) + "px";
  });
};

var DEFAULT_PLAYER_TOKEN_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="66%" height="66%" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 3c-2.2 0-3.8 1.5-4.1 3.7L7.5 9H3.8c-.7 0-1.1.8-.6 1.3C4.8 11.8 8 12.6 12 12.6s7.2-.8 8.8-2.3c.5-.5.1-1.3-.6-1.3h-3.7l-.4-2.3C15.8 4.5 14.2 3 12 3zm0 11.2c-3.9 0-7 1.9-7 4.3V20h14v-1.5c0-2.4-3.1-4.3-7-4.3z"/>' +
  "</svg>";

var DEFAULT_CREATURE_TOKEN_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="64%" height="64%" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 2C7.6 2 4 5.4 4 9.6c0 2.7 1.5 5.1 3.8 6.4V19c0 .6.4 1 1 1h1.2v-2h1.3v2h1.4v-2H14v2h1.2c.6 0 1-.4 1-1v-3c2.3-1.3 3.8-3.7 3.8-6.4C20 5.4 16.4 2 12 2zm-3 8.5c-.8 0-1.5-.7-1.5-1.5S8.2 7.5 9 7.5s1.5.7 1.5 1.5S9.8 10.5 9 10.5zm6 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5z"/>' +
  "</svg>";

function syncMesaMapTokenDom(el, token, metricsArg) {
  if (!el || !token || !token.id) return;
  var metrics = metricsArg || OS.getMesaGridMetrics();
  var cellPx = metrics.cellPx;
  var cols = metrics.cols;
  var gx = Math.max(0, parseInt(String(token.grid_x || 0), 10) || 0);
  var gy = Math.max(0, parseInt(String(token.grid_y || 0), 10) || 0);
  var visX = Math.min(cols - 1, gx);
  var movable = OS.canCurrentUserMoveToken(token);
  var isPlayer = token.owner_type === "player";
  var dispName = String(
    token.display_name || (isPlayer ? "Jogador" : "Criatura")
  );
  var imgUrl = token.image_url ? String(token.image_url).trim() : "";
  var wasDragging = el.classList.contains("is-dragging");

  el.className =
    "mesa-map-token " +
    (isPlayer ? "token-type-player" : "token-type-creature") +
    (movable ? " is-movable" : " is-locked") +
    (wasDragging ? " is-dragging" : "");
  el.dataset.tokenId = token.id;
  el.dataset.ownerType = token.owner_type;
  el.dataset.ownerRef = token.owner_ref;
  el.dataset.ownerUserId = token.owner_user_id || "";
  el.dataset.gridX = String(gx);
  el.dataset.gridY = String(gy);
  el.title = dispName + (movable ? " (arraste para mover)" : "");

  if (!wasDragging) {
    el.style.width = cellPx.toFixed(3) + "px";
    el.style.height = cellPx.toFixed(3) + "px";
    el.style.left = (visX * cellPx).toFixed(3) + "px";
    el.style.top = (gy * cellPx).toFixed(3) + "px";
  }

  var prevImgUrl = el.dataset.renderedImgUrl;
  var avatarWrap = el.querySelector(".mesa-map-token-avatar");
  var labelNode = el.querySelector(".mesa-map-token-label");

  if (!avatarWrap || !labelNode || prevImgUrl !== imgUrl) {
    el.dataset.renderedImgUrl = imgUrl;
    var fallbackSvg = isPlayer
      ? DEFAULT_PLAYER_TOKEN_ICON_SVG
      : DEFAULT_CREATURE_TOKEN_ICON_SVG;

    var avatarInner = imgUrl
      ? '<img class="mesa-map-token-img" src="' +
        escHtml(imgUrl) +
        '" alt="' +
        escHtml(dispName) +
        '" draggable="false">' +
        '<span class="mesa-map-token-fallback-icon" hidden>' +
        fallbackSvg +
        "</span>"
      : '<span class="mesa-map-token-fallback-icon">' +
        fallbackSvg +
        "</span>";

    el.innerHTML =
      '<div class="mesa-map-token-avatar">' +
      avatarInner +
      "</div>" +
      '<span class="mesa-map-token-label">' +
      escHtml(dispName) +
      "</span>";

    var imgNode = el.querySelector(".mesa-map-token-img");
    var fbNode = el.querySelector(".mesa-map-token-fallback-icon");
    if (imgNode && fbNode) {
      imgNode.addEventListener("error", function () {
        imgNode.hidden = true;
        imgNode.setAttribute("hidden", "");
        fbNode.hidden = false;
        fbNode.removeAttribute("hidden");
      });
    }
  } else {
    if (labelNode.textContent !== dispName) {
      labelNode.textContent = dispName;
    }
    var curImg = el.querySelector(".mesa-map-token-img");
    if (curImg && curImg.getAttribute("alt") !== dispName) {
      curImg.setAttribute("alt", dispName);
    }
  }
}

function buildMesaMapTokenElement(token, metricsArg) {
  if (!token || !token.id) return null;
  var el = document.createElement("div");
  syncMesaMapTokenDom(el, token, metricsArg);
  if (OS.renderMesaTokenBars) OS.renderMesaTokenBars(el, token);

  var tokenId = String(token.id);
  el.addEventListener("pointerdown", function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (OS.mapCamera.isPanning || OS.activeMesaState.isDraggingLocal) return;
    var stNow = OS.activeMesaState;
    var liveTok =
      (stNow &&
        Array.isArray(stNow.mesaTokens) &&
        stNow.mesaTokens.find(function (t) {
          return t && String(t.id) === tokenId;
        })) ||
      token;

    if (!OS.canCurrentUserMoveToken(liveTok)) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();

    var dragMetrics = OS.getMesaGridMetrics();
    var curCellPx = dragMetrics.cellPx;
    var curCols = dragMetrics.cols;
    var maxLeft = Math.max(0, dragMetrics.width - curCellPx);
    var maxTop = Math.max(0, dragMetrics.height - curCellPx);

    var origX = Math.max(0, parseInt(String(liveTok.grid_x || 0), 10) || 0);
    var origY = Math.max(0, parseInt(String(liveTok.grid_y || 0), 10) || 0);
    var startClientX = ev.clientX;
    var startClientY = ev.clientY;
    var dragZoom = OS.mapCamera.zoom;
    var dragPointerId = ev.pointerId;
    var startLeftPx = Math.min(curCols - 1, origX) * curCellPx;
    var startTopPx = origY * curCellPx;
    var currentLeftPx = startLeftPx;
    var currentTopPx = startTopPx;

    if (stNow) {
      stNow.isDraggingLocal = true;
      stNow.draggingTokenId = tokenId;
    }

    el.classList.add("is-dragging");
    if (el.setPointerCapture && ev.pointerId !== undefined) {
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (capErr) {
        /* synthetic or unsupported pointerId */
      }
    }

    var finished = false;
    function onPointerMove(moveEv) {
      if (finished || moveEv.pointerId !== dragPointerId) return;
      var dx = (moveEv.clientX - startClientX) / dragZoom;
      var dy = (moveEv.clientY - startClientY) / dragZoom;
      currentLeftPx = Math.max(0, Math.min(maxLeft, startLeftPx + dx));
      currentTopPx = Math.max(0, Math.min(maxTop, startTopPx + dy));
      el.style.left = currentLeftPx.toFixed(2) + "px";
      el.style.top = currentTopPx.toFixed(2) + "px";
    }

    async function onPointerEnd(endEv) {
      if (finished || (endEv && endEv.pointerId !== dragPointerId)) return;
      if (endEv && endEv.type === "pointerup") onPointerMove(endEv);
      finished = true;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", cancelDrag);
      el.removeEventListener("lostpointercapture", cancelDrag);
      OS.cancelMapTokenDrag = null;
      if (el.hasPointerCapture && el.hasPointerCapture(dragPointerId)) el.releasePointerCapture(dragPointerId);
      el.classList.remove("is-dragging");

      var stEnd = OS.activeMesaState;

      if (endEv && endEv.type === "pointercancel") {
        if (stEnd && String(stEnd.draggingTokenId) === tokenId) {
          stEnd.isDraggingLocal = false;
          stEnd.draggingTokenId = null;
        }
        el.style.left = startLeftPx.toFixed(3) + "px";
        el.style.top = startTopPx.toFixed(3) + "px";
        return;
      }

      var endMetrics = OS.getMesaGridMetrics();
      var endCellPx = endMetrics.cellPx || curCellPx;
      var endCols = endMetrics.cols || curCols;
      var maxGridY = Math.max(
        0,
        Math.round(Math.max(0, endMetrics.height - endCellPx) / endCellPx)
      );

      var snappedX = Math.max(
        0,
        Math.min(endCols - 1, Math.round(currentLeftPx / endCellPx))
      );
      var snappedY = Math.max(
        0,
        Math.min(maxGridY, Math.round(currentTopPx / endCellPx))
      );

      el.style.width = endCellPx.toFixed(3) + "px";
      el.style.height = endCellPx.toFixed(3) + "px";
      el.style.left = (snappedX * endCellPx).toFixed(3) + "px";
      el.style.top = (snappedY * endCellPx).toFixed(3) + "px";
      el.dataset.gridX = String(snappedX);
      el.dataset.gridY = String(snappedY);

      if (snappedX === origX && snappedY === origY) {
        if (stEnd && String(stEnd.draggingTokenId) === tokenId) {
          stEnd.isDraggingLocal = false;
          stEnd.draggingTokenId = null;
        }
        return;
      }

      // Marca confirmação local pendente antes de encerrar isDraggingLocal para evitar eco elástico
      liveTok.grid_x = snappedX;
      liveTok.grid_y = snappedY;
      if (stEnd) {
        if (!stEnd.pendingLocalTokenUpdates) {
          stEnd.pendingLocalTokenUpdates = {};
        }
        stEnd.pendingLocalTokenUpdates[tokenId] =
          (stEnd.pendingLocalTokenUpdates[tokenId] || 0) + 1;
        if (String(stEnd.draggingTokenId) === tokenId) {
          stEnd.isDraggingLocal = false;
          stEnd.draggingTokenId = null;
        }
      }

      try {
        var saved = await OS.updateMesaTokenPosition(
          tokenId,
          snappedX,
          snappedY
        );
        if (!saved) {
          liveTok.grid_x = origX;
          liveTok.grid_y = origY;
          el.dataset.gridX = String(origX);
          el.dataset.gridY = String(origY);
          el.style.left =
            (Math.min(endCols - 1, origX) * endCellPx).toFixed(3) + "px";
          el.style.top = (origY * endCellPx).toFixed(3) + "px";
        }
      } finally {
        var stFin = OS.activeMesaState;
        if (stFin && stFin.pendingLocalTokenUpdates) {
          var nextCnt =
            (stFin.pendingLocalTokenUpdates[tokenId] || 1) - 1;
          if (nextCnt <= 0) {
            delete stFin.pendingLocalTokenUpdates[tokenId];
          } else {
            stFin.pendingLocalTokenUpdates[tokenId] = nextCnt;
          }
        }
      }
    }

    function cancelDrag() { onPointerEnd({ type: "pointercancel", pointerId: dragPointerId }); }
    OS.cancelMapTokenDrag = cancelDrag;
    window.addEventListener("blur", cancelDrag);
    el.addEventListener("lostpointercapture", cancelDrag);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  });

  return el;
}

OS.renderSingleMesaMapToken = function (token) {
  var layerEl = OS.$("mesa-map-tokens-layer");
  if (!layerEl || !token || !token.id) return null;
  var existingNode = layerEl.querySelector(
    '.mesa-map-token[data-token-id="' + String(token.id) + '"]'
  );
  var metrics = OS.getMesaGridMetrics();
  if (existingNode) {
    syncMesaMapTokenDom(existingNode, token, metrics);
    if (OS.renderMesaTokenBars) OS.renderMesaTokenBars(existingNode, token);
    return existingNode;
  }
  var el = buildMesaMapTokenElement(token, metrics);
  if (el) {
    layerEl.appendChild(el);
  }
  return el;
};

OS.renderMesaMapTokens = function () {
  OS.dispatchMesaCombatantsChange();
  var layerEl = OS.$("mesa-map-tokens-layer");
  if (!layerEl) return;

  var st = OS.activeMesaState;
  var tokens = st && Array.isArray(st.mesaTokens) ? st.mesaTokens : [];
  layerEl.innerHTML = "";

  if (!st || !st.mesaId || !tokens.length) {
    return;
  }

  var metrics = OS.getMesaGridMetrics();
  tokens.forEach(function (token) {
    var el = buildMesaMapTokenElement(token, metrics);
    if (el) {
      layerEl.appendChild(el);
    }
  });
};

OS.updateMesaTokenPosition = async function (tokenId, newGridX, newGridY) {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !tokenId) return null;

  var token = (st.mesaTokens || []).find(function (t) {
    return t && t.id === tokenId;
  });
  if (!token || !OS.canCurrentUserMoveToken(token)) {
    return null;
  }

  var gx = Math.max(0, parseInt(String(newGridX || 0), 10) || 0);
  var gy = Math.max(0, parseInt(String(newGridY || 0), 10) || 0);

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return null;

  var nowIso = new Date().toISOString();
  var res = await client
    .from("mesa_tokens")
    .update({
      grid_x: gx,
      grid_y: gy,
      updated_at: nowIso
    })
    .eq("id", tokenId)
    .eq("mesa_id", st.mesaId)
    .select("*")
    .maybeSingle();

  if (!res || res.error || !res.data) {
    console.warn("[updateMesaTokenPosition] Falha ou bloqueio RLS:", res && res.error);
    return null;
  }

  token.grid_x = res.data.grid_x;
  token.grid_y = res.data.grid_y;
  token.updated_at = res.data.updated_at || nowIso;
  return res.data;
};

OS.loadMesaTokens = async function (mesaIdArg) {
  if (OS.loadMesaMapView) return OS.loadMesaMapView();
  var st = OS.activeMesaState;
  var mesaId = mesaIdArg || (st && st.mesaId);
  if (!mesaId) return [];

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) {
    if (st) st.mesaTokens = [];
    OS.renderMesaMapTokens();
    return [];
  }

  try {
    var requestId = st._tokenReadId = (st._tokenReadId || 0) + 1;
    var res = st.isMestre
      ? await client.from("mesa_tokens").select("*").eq("mesa_id", mesaId).order("created_at", { ascending: true })
      : await client.rpc("obter_cena_publica", { p_mesa_id: mesaId });
    if (st.mesaId !== mesaId || st._tokenReadId !== requestId) return [];

    if (res && res.error) {
      console.warn("[loadMesaTokens] Erro na consulta mesa_tokens:", res.error);
      if (st && st.mesaId === mesaId) {
        st.mesaTokens = [];
        st._tokensLoadedOk = false;
      }
      OS.renderMesaMapTokens();
      return [];
    }

    var rows = res && Array.isArray(res.data) ? res.data : [];
    if (!st.isMestre) {
      rows = rows.map(function (row) { return Object.assign({}, row, { id: row.token_id, mesa_id: mesaId }); });
    }
    rows.forEach(function (row) { row.iniciativa = OS.normalizeMesaInitiative(row.iniciativa); });
    if (st && st.mesaId === mesaId) {
      st.mesaTokens = rows;
      st._tokensLoadedOk = true;
      OS.dispatchMesaCombatantsChange();
    }
    OS.renderMesaMapTokens();
    if (st && OS.renderMesaSceneCards) {
      OS.renderMesaSceneCards();
    }
    return rows;
  } catch (err) {
    if (st.mesaId !== mesaId || st._tokenReadId !== requestId) return [];
    console.warn("[loadMesaTokens] Erro ao buscar mesa_tokens:", err);
    if (st && st.mesaId === mesaId) {
      st.mesaTokens = [];
      st._tokensLoadedOk = false;
    }
    OS.renderMesaMapTokens();
    return [];
  }
};

function normalizeRemoteCenaList(remoteCena) {
  var rawList = [];
  if (Array.isArray(remoteCena)) {
    rawList = deepClone(remoteCena);
  } else if (
    remoteCena &&
    typeof remoteCena === "object" &&
    Array.isArray(remoteCena.cena_ativa)
  ) {
    rawList = deepClone(remoteCena.cena_ativa);
  }
  return rawList
    .map(function (c) {
      if (!c || typeof c !== "object") return null;
      c.instanceId = ensureValidUuid(c.instanceId);
      if (c.collapsed === undefined) {
        c.collapsed = true;
      }
      if (c.data && typeof c.data === "object") {
        OS.sanitizeCreature6BData(c.data);
      }
      return c;
    })
    .filter(Boolean);
}

OS.refreshMesaStageAndTokens = async function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return;

  var refreshId = st.mesaId;
  var mesaRes = await OS.readAccessibleMesa(refreshId);
  if (st.mesaId !== refreshId) return;

  if (mesaRes && mesaRes.data) {
    var m = mesaRes.data;
    st.mesa = m;
    if (OS.loadMesaMapView && st.isMestre) { st.mapas = m.mapas || []; st.playerMapId = m.mapa_ativo_jogadores_id; }
    if (!OS.loadMesaMapView) st.mapaUrl = m.mapa_url || "";
    st.gridCols = Math.max(
      4,
      Math.min(64, parseInt(String(m.grid_cols || 24), 10) || 24)
    );
    st.npcsMesa = Array.isArray(m.npcs_mesa) ? deepClone(m.npcs_mesa) : [];
    sanitizeNpcsMesaListInPlace(st.npcsMesa);
    if (st.isMestre) {
      await OS.restoreMesaSceneState(m);
      OS.renderMesaNpcsList();
    } else {
      st.sceneCreatures = [];
    }
  }

  if (st.isMestre) {
    await Promise.all([
      OS.loadMesaPlayersSheets(st.mesaId),
      OS.loadMesaTokens(st.mesaId)
    ]);
    await OS.reconcileSceneCreaturesWithTokens();
  } else {
    await OS.loadMesaTokens(st.mesaId);
  }
  if (OS.renderMesaSceneCards) {
    OS.renderMesaSceneCards();
  }
  if (OS.renderMesaFloatingPopups) {
    OS.renderMesaFloatingPopups();
  }
  OS.renderMesaMapStage();
  if (OS.loadMesaCombat) await OS.loadMesaCombat();
};

/* ─── Etapa 3: Sincronização em Tempo Real (Supabase Realtime) ─── */

OS.setMesaRealtimeStatusUi = function (statusKey, customLabel) {
  var st = OS.activeMesaState;
  if (st) {
    st.realtimeStatus = statusKey || "idle";
  }
  var hintEl = OS.$("mesa-map-sync-hint");
  if (!hintEl) return;

  if (statusKey === "live") {
    hintEl.className = "mesa-map-sync-hint is-live";
    hintEl.dataset.realtimeState = "live";
    hintEl.textContent = customLabel || "🟢 Sincronizado em tempo real";
  } else if (statusKey === "reconnecting") {
    hintEl.className = "mesa-map-sync-hint is-reconnecting";
    hintEl.dataset.realtimeState = "reconnecting";
    hintEl.textContent = customLabel || "🟡 Reconectando...";
  } else {
    hintEl.className = "mesa-map-sync-hint is-connecting";
    hintEl.dataset.realtimeState = statusKey || "connecting";
    hintEl.textContent = customLabel || "🟡 Conectando em tempo real...";
  }
};

OS.teardownMesaRealtimeChannel = async function (opts) {
  clearInterval(OS.publicSceneTimer);
  OS.publicSceneTimer = null;
  opts = opts || {};
  if (!opts.keepTimer && mesaRealtimeReconnectTimer) {
    clearTimeout(mesaRealtimeReconnectTimer);
    mesaRealtimeReconnectTimer = null;
  }
  if (!opts.preserveAttempts) {
    mesaRealtimeReconnectAttempts = 0;
  }

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var ch = OS.activeMesaChannel;
  OS.activeMesaChannel = null;

  var removals = [];
  if (ch) {
    ch._intentionalClose = true;
    if (client && typeof client.removeChannel === "function") {
      try {
        removals.push(Promise.resolve(client.removeChannel(ch)));
      } catch (remErr) {
        console.warn("[Realtime] Aviso ao remover canal ativo:", remErr);
      }
    } else if (typeof ch.unsubscribe === "function") {
      try {
        removals.push(Promise.resolve(ch.unsubscribe()));
      } catch (unsubErr) {
        /* ignore */
      }
    }
  }

  if (client && typeof client.getChannels === "function" && typeof client.removeChannel === "function") {
    try {
      var openChs = client.getChannels() || [];
      openChs.slice().forEach(function (c) {
        if (!c || c === ch) return;
        var topicStr = String(c.topic || "");
        if (
          topicStr.indexOf("realtime:mesa-") === 0 ||
          topicStr.indexOf("mesa-") === 0
        ) {
          c._intentionalClose = true;
          removals.push(Promise.resolve(client.removeChannel(c)));
        }
      });
    } catch (listErr) {
      /* ignore */
    }
  }

  if (removals.length) {
    try {
      await Promise.all(removals);
    } catch (e) {
      /* ignore */
    }
  }
};

OS.scheduleMesaRealtimeReconnect = function (mesaIdArg) {
  var st = OS.activeMesaState;
  var targetMesaId = mesaIdArg || (st && st.mesaId);
  if (!st || !st.mesaId || String(st.mesaId) !== String(targetMesaId)) {
    return;
  }
  if (mesaRealtimeReconnectTimer) return;

  var delays = [800, 1600, 3000, 5000];
  var delayMs =
    delays[Math.min(mesaRealtimeReconnectAttempts, delays.length - 1)];
  mesaRealtimeReconnectAttempts++;

  mesaRealtimeReconnectTimer = setTimeout(function () {
    mesaRealtimeReconnectTimer = null;
    var curSt = OS.activeMesaState;
    if (!curSt || String(curSt.mesaId) !== String(targetMesaId)) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      OS.setMesaRealtimeStatusUi("reconnecting");
      OS.scheduleMesaRealtimeReconnect(targetMesaId);
      return;
    }
    OS.reconnectMesaRealtimeNow(targetMesaId);
  }, delayMs);
};

OS.reconnectMesaRealtimeNow = async function (mesaIdArg) {
  var st = OS.activeMesaState;
  var targetMesaId = mesaIdArg || (st && st.mesaId);
  if (!st || !st.mesaId || String(st.mesaId) !== String(targetMesaId)) {
    return null;
  }
  st._needsResyncOnSubscribe = true;
  OS.setMesaRealtimeStatusUi("reconnecting");
  await OS.teardownMesaRealtimeChannel({ preserveAttempts: true });
  if (!OS.activeMesaState || String(OS.activeMesaState.mesaId) !== String(targetMesaId)) {
    return null;
  }
  return OS.subscribeMesaRealtimeChannel(targetMesaId, { isReconnect: true });
};

OS.subscribeMesaRealtimeChannel = function (mesaId, opts) {
  opts = opts || {};
  if (!mesaId) return null;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client || typeof client.channel !== "function") return null;

  if (OS.activeMesaChannel) {
    var prev = OS.activeMesaChannel;
    prev._intentionalClose = true;
    OS.activeMesaChannel = null;
    if (typeof client.removeChannel === "function") {
      try {
        client.removeChannel(prev);
      } catch (e) {
        /* ignore */
      }
    }
  }

  OS.setMesaRealtimeStatusUi(opts.isReconnect ? "reconnecting" : "connecting");

  var channel = client.channel("mesa-" + mesaId);
  channel._mesaId = mesaId;
  channel._intentionalClose = false;
  OS.activeMesaChannel = channel;
  if (OS.subscribeMesaTokenStatus) OS.subscribeMesaTokenStatus(channel, mesaId);
  if (OS.subscribeMesaDeliveries) OS.subscribeMesaDeliveries(channel);

  channel.on("postgres_changes", { event: "*", schema: "public", table: "mesa_mapa_sinais", filter: "mesa_id=eq." + mesaId }, function (payload) {
    var st = OS.activeMesaState;
    if (OS.activeMesaChannel !== channel || !payload.new || payload.new.mesa_id !== st.mesaId) return;
    if (!st.isMestre && payload.new.mapa_ativo_id !== st.activeMapId && OS.cancelMapTokenDrag) OS.cancelMapTokenDrag();
    if (OS.loadMesaMapView) OS.loadMesaMapView(st.activeMapId, { refresh: st.isMestre });
  });
  // Sinal sem dados privados: jogadores não podem assinar o conteúdo completo de mesas.
  channel.on("postgres_changes", {
    event: "*", schema: "public", table: "mesa_combate_sinais", filter: "mesa_id=eq." + mesaId
  }, function (payload) {
    if (OS.activeMesaChannel === channel && payload.new && payload.new.mesa_id === mesaId && OS.loadMesaCombat) OS.loadMesaCombat();
  });

  channel.on("postgres_changes", {
    event: "UPDATE", schema: "public", table: "fichas", filter: "mesa_id=eq." + mesaId
  }, function (payload) {
    var updatedFicha = payload && payload.new;
    if (!updatedFicha) return;
    var st = OS.activeMesaState;
    if (!st || OS.activeMesaChannel !== channel) return;
    if (!st.isMestre && st.playerFichaId && String(st.playerFichaId) === String(updatedFicha.id)) {
      if (updatedFicha.dados && typeof updatedFicha.dados === "object") {
        OS.applyState(updatedFicha.dados, { readOnlyMode: false });
        if (OS.renderFateTokens) OS.renderFateTokens();
      }
    }
    if (st.isMestre && Array.isArray(st.playerSheets)) {
      var idx = st.playerSheets.findIndex(function (r) {
        return r && String(r.id) === String(updatedFicha.id);
      });
      if (idx >= 0) {
        st.playerSheets[idx] = updatedFicha;
        if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
        if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
      }
    }
  });

  // Jogadores escutam somente sinais autorizados; DELETE de Postgres Changes não aplica RLS.
  if (OS.activeMesaState.isMestre) {
  // Nota: em Supabase Realtime com RLS, eventos DELETE enviam apenas a PK (payload.old = { id })
  // e não aceitam filtro por coluna não-PK (filter: mesa_id=eq.<uuid>). Por isso escutamos
  // event: "*" filtrado por mesa_id (INSERT/UPDATE) + event: "DELETE" sem filtro na mesma
  // tabela mesa_tokens dentro deste único canal, descartando de forma idempotente IDs ausentes.
  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "mesa_tokens",
        filter: "mesa_id=eq." + mesaId
      },
      function (payload) {
        OS.handleRealtimeTokenChange(payload);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "mesa_tokens"
      },
      function (payload) {
        OS.handleRealtimeTokenChange(payload);
      }
    )
;
  }
  channel
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "mesas",
        filter: "id=eq." + mesaId
      },
      function (payload) {
        OS.handleRealtimeMesaChange(payload);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "eventos_mesa",
        filter: "mesa_id=eq." + mesaId
      },
      function (payload) {
        OS.handleRealtimeEventoMesa(payload);
      }
    )
    ;
  var onStatus = function (status) {
      if (channel._intentionalClose) return;
      if (OS.activeMesaChannel !== channel) return;
      var curSt = OS.activeMesaState;
      if (!curSt || String(curSt.mesaId) !== String(mesaId)) return;

      if (status === "SUBSCRIBED") {
        mesaRealtimeReconnectAttempts = 0;
        if (mesaRealtimeReconnectTimer) {
          clearTimeout(mesaRealtimeReconnectTimer);
          mesaRealtimeReconnectTimer = null;
        }
        var shouldResync = !!(
          opts.isReconnect ||
          curSt._needsResyncOnSubscribe ||
          curSt._hasSubscribedOnce
        );
        curSt._hasSubscribedOnce = true;
        curSt._needsResyncOnSubscribe = false;
        OS.setMesaRealtimeStatusUi("live");
        if (OS.processMesaDeliveries) OS.processMesaDeliveries();
        if (OS.loadMesaCombat) OS.loadMesaCombat();
        if (shouldResync || OS.loadMesaMapView) {
          Promise.all([
            OS.refreshMesaStageAndTokens(),
            OS.loadMesaFeedEvents(mesaId)
          ]).catch(function (resyncErr) {
            console.warn(
              "[Realtime] Erro na re-sincronização pós-reconexão:",
              resyncErr
            );
          });
        }
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        curSt._needsResyncOnSubscribe = true;
        OS.setMesaRealtimeStatusUi("reconnecting");
        OS.scheduleMesaRealtimeReconnect(mesaId);
      }
    };
  // Sincroniza o JWT antes do join; SUBSCRIBED sempre reconcilia a janela entre leitura e assinatura.
  if (client.auth && client.realtime && client.realtime.setAuth) {
    client.auth.getSession().then(function (res) {
      if (res.error || !res.data.session) throw Error("Sessão Realtime indisponível");
      return client.realtime.setAuth(res.data.session.access_token);
    }).then(function () {
      if (OS.activeMesaChannel === channel && !channel._intentionalClose) channel.subscribe(onStatus);
    }).catch(function () {
      if (OS.activeMesaChannel === channel) onStatus("CHANNEL_ERROR");
    });
  } else channel.subscribe(onStatus);

  return channel;
};

OS.handleRealtimeTokenChange = function (payload) {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !payload) return;
  var eventType = String(payload.eventType || payload.event || "").toUpperCase();
  if (["INSERT", "UPDATE", "DELETE"].indexOf(eventType) < 0) return;
  var incoming = eventType === "DELETE" ? payload.old : payload.new;
  if (!incoming || !incoming.id || (incoming.mesa_id && String(incoming.mesa_id) !== String(st.mesaId))) return;

  // A RPC é a autoridade da visão pública. Não copia old/new privados para o cache.
  // DELETE pode trazer só a chave primária; nunca usa seus outros campos.
  if (!st.isMestre) return OS.loadMesaTokens(st.mesaId);
  if (incoming.mapa_id && st.activeMapId && incoming.mapa_id !== st.activeMapId) return;
  if (!Array.isArray(st.mesaTokens)) st.mesaTokens = [];
  var id = String(incoming.id);
  var index = st.mesaTokens.findIndex(function (t) { return t && String(t.id) === id; });
  var refreshCards = eventType !== "UPDATE" || index < 0;
  if (eventType === "DELETE") {
    if (index < 0) return;
    st.mesaTokens.splice(index, 1);
    OS.renderMesaMapTokens();
  } else {
    var existing = index >= 0 ? st.mesaTokens[index] : null;
    if (existing && existing.updated_at && incoming.updated_at &&
        Date.parse(incoming.updated_at) < Date.parse(existing.updated_at)) return;
    var prevInitRT = existing ? OS.normalizeMesaInitiative(existing.iniciativa) : null;
    var next = Object.assign({}, existing || {}, deepClone(incoming));
    next.iniciativa = OS.normalizeMesaInitiative(next.iniciativa);
    refreshCards = refreshCards || !existing || existing.display_name !== next.display_name ||
      existing.image_url !== next.image_url || existing.visible_to_players !== next.visible_to_players;
    // Arraste suprime somente o eco da posição: iniciativa e visibilidade continuam entrando.
    if (existing && ((st.isDraggingLocal && String(st.draggingTokenId) === id) ||
        (st.pendingLocalTokenUpdates && st.pendingLocalTokenUpdates[id] > 0))) {
      next.grid_x = existing.grid_x;
      next.grid_y = existing.grid_y;
    }
    if (existing) Object.assign(existing, next);
    else { existing = next; st.mesaTokens.push(existing); }
    OS.renderSingleMesaMapToken(existing);
    if (
      eventType === "UPDATE" &&
      prevInitRT !== null &&
      prevInitRT !== next.iniciativa &&
      st.combateAtivo &&
      st.combateAtivo.ativo &&
      OS.recordNextRoundInitiative
    ) {
      OS.recordNextRoundInitiative(existing.id, next.iniciativa);
    }
  }
  OS.dispatchMesaCombatantsChange();
  if (refreshCards) {
    if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
    if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
    if (OS.renderMesaPlayersCards) OS.renderMesaPlayersCards();
  }
};

OS.handleRealtimeMesaChange = function (payload) {
  var st = OS.activeMesaState;
  var m = payload && payload.new;
  if (!st || !st.mesaId || !m || String(m.id) !== String(st.mesaId)) {
    return;
  }

  st.mesa = Object.assign({}, st.mesa || {}, deepClone(m));
  if (Object.prototype.hasOwnProperty.call(m, "combate_ativo") && OS.loadMesaCombat) OS.loadMesaCombat();

  if (OS.loadMesaMapView && Array.isArray(m.mapas)) {
    st.mapas = m.mapas; st.playerMapId = m.mapa_ativo_jogadores_id;
    OS.loadMesaMapView(st.activeMapId);
  }

  // 1. mapa_url alterado
  if (!OS.loadMesaMapView && m.mapa_url !== undefined) {
    var incomingMapa = m.mapa_url ? String(m.mapa_url).trim() : "";
    var currentMapa = st.mapaUrl ? String(st.mapaUrl).trim() : "";
    if (incomingMapa !== currentMapa) {
      st.mapaUrl = incomingMapa;
      OS.updateMesaMapBackdropDom();
    }
  }

  // 2. grid_cols alterado
  if (!OS.loadMesaMapView && m.grid_cols !== undefined && m.grid_cols !== null) {
    var incomingCols = Math.max(
      4,
      Math.min(64, parseInt(String(m.grid_cols || 24), 10) || 24)
    );
    if (incomingCols !== st.gridCols) {
      st.gridCols = incomingCols;
      OS.syncMesaGridOverlay();
    }
  }

  // 3. cena_ativa alterada
  if (m.cena_ativa !== undefined) {
    var incomingCena = normalizeRemoteCenaList(m.cena_ativa);
    var localCenaJson = JSON.stringify(st.sceneCreatures || []);
    var remoteCenaJson = JSON.stringify(incomingCena);
    var gmHasUnsavedLocalDebounce = !!(
      st.isMestre &&
      (st.sceneSaveTimer || st._isFlushingSceneRemote)
    );
    if (remoteCenaJson !== localCenaJson && !gmHasUnsavedLocalDebounce) {
      st.sceneCreatures = incomingCena;
      if (st.isMestre) {
        OS.persistMesaSceneImmediateLocal();
      }
      if (OS.renderMesaSceneCards) {
        OS.renderMesaSceneCards();
      }
      if (OS.renderMesaFloatingPopups) {
        OS.renderMesaFloatingPopups();
      }
    }
  }

  // 4. npcs_mesa alterada
  if (m.npcs_mesa !== undefined) {
    var incomingNpcs = Array.isArray(m.npcs_mesa)
      ? deepClone(m.npcs_mesa)
      : [];
    sanitizeNpcsMesaListInPlace(incomingNpcs);
    if (JSON.stringify(incomingNpcs) !== JSON.stringify(st.npcsMesa || [])) {
      st.npcsMesa = incomingNpcs;
      if (st.isMestre && OS.renderMesaNpcsList) {
        OS.renderMesaNpcsList();
      }
      if (st.isMestre && OS.renderMesaFloatingPopups) {
        OS.renderMesaFloatingPopups();
      }
    }
  }
};

OS.handleRealtimeEventoMesa = function (payload) {
  var st = OS.activeMesaState;
  var ev = payload && payload.new;
  if (!st || !st.mesaId || !ev || !ev.id) return;
  if (ev.mesa_id && String(ev.mesa_id) !== String(st.mesaId)) return;

  // Defesa adicional em profundidade (além da policy RLS eventos_select_visiveis no banco)
  if (ev.visivel_para === "mestre" && !st.isMestre) {
    return;
  }

  OS.appendMesaFeedEventIfNew(ev);

  // Sincronização automática quando o Mestre dispara Nova Sessão
  if (ev.tipo === "sistema" && ev.conteudo && ev.conteudo.subtipo === "nova_sessao") {
    if (st.isMestre) {
      OS.loadMesaPlayersSheets().then(function () {
        if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
        if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
      });
    } else {
      OS.loadPlayerSheetForMesa(st.mesaId, st.currentUserId).then(function () {
        if (typeof OS.showToast === "function") {
          OS.showToast("O Mestre iniciou uma Nova Sessão! Novas Fichas do Destino foram sorteadas e o 6B foi preparado.", "info");
        }
      });
    }
  }
};

OS.adjustMesaGridCols = async function (delta) {
  var st = OS.activeMesaState;
  var cur = (st && st.gridCols) || 24;
  return await OS.setMesaGridCols(cur + (parseInt(String(delta), 10) || 0));
};

/* ─── Alternância da Lateral Direita (💬 Chat | 👤 Fichas) ──────── */

OS.switchMesaSidebarTab = function (tabName) {
  var target = tabName === "notes" && OS.activeMesaState.isMestre ? "notes" : tabName === "fichas" ? "fichas" : "chat";
  var notesPanel = OS.$("mesa-sidebar-panel-notes"), notesTab = OS.$("btn-mesa-tab-notes");
  if (notesPanel) notesPanel.hidden = target !== "notes";
  if (notesTab) { notesTab.classList.toggle("active", target === "notes"); notesTab.setAttribute("aria-selected", String(target === "notes")); }
  if (OS.activeMesaState) {
    OS.activeMesaState.activeSidebarTab = target;
  }

  var sidebarEl = OS.$("mesa-sidebar-feed");
  var btnChat = OS.$("btn-mesa-tab-chat");
  var btnFichas = OS.$("btn-mesa-tab-fichas");
  var panelChat = OS.$("mesa-sidebar-panel-chat");
  var panelFichas = OS.$("mesa-sidebar-panel-fichas");

  var isFichas = target === "fichas";
  if (sidebarEl) {
    sidebarEl.classList.toggle("is-fichas-expanded", isFichas);
  }
  if (btnChat) {
    btnChat.classList.toggle("active", target === "chat");
    btnChat.setAttribute("aria-selected", target === "chat" ? "true" : "false");
  }
  if (btnFichas) {
    btnFichas.classList.toggle("active", isFichas);
    btnFichas.setAttribute("aria-selected", isFichas ? "true" : "false");
  }
  if (panelChat) {
    if (target === "chat") {
      panelChat.removeAttribute("hidden");
      panelChat.hidden = false;
    } else {
      panelChat.setAttribute("hidden", "");
      panelChat.hidden = true;
    }
  }
  if (panelFichas) {
    if (isFichas) {
      panelFichas.removeAttribute("hidden");
      panelFichas.hidden = false;
    } else {
      panelFichas.setAttribute("hidden", "");
      panelFichas.hidden = true;
    }
  }
};

OS.openMesa = async function (mesaId) {
  if (OS.flushMesaNotes && !(await OS.flushMesaNotes())) return false;
  if (OS.activeMesaState.deliveryTask) await OS.activeMesaState.deliveryTask;
  if (!(await OS.verifyAuthSession())) return false;
  if (!mesaId) return false;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!client || !uid) return false;

  // Se já estava em uma mesa com alterações pendentes ou canal ativo, faz flush e remove o canal anterior
  if (OS.activeMesaState && OS.activeMesaState.mesaId) {
    await OS.flushMesaSceneRemoteSave();
  }
  await OS.teardownMesaRealtimeChannel();

  var mesaRes = await OS.readAccessibleMesa(mesaId);
  if (mesaRes.error || !mesaRes.data) {
    console.error("[mesaScreen] Mesa não encontrada:", mesaRes.error);
    return false;
  }

  var membroRes = await client
    .from("membros_mesa")
    .select("*")
    .eq("mesa_id", mesaId)
    .eq("usuario_id", uid)
    .maybeSingle();

  var mesa = mesaRes.data;
  var membro = (membroRes && membroRes.data) || null;
  var isMestre = OS.calculateIsMestre(mesa, membro, uid);

  if (OS.clearMesaMaps) OS.clearMesaMaps();
  OS.activeMesaState.mesaId = mesa.id;
  if (OS.cancelMapTokenDrag) OS.cancelMapTokenDrag();
  OS.resetMapCamera();
  if (OS.resetMesaCombat) OS.resetMesaCombat();
  OS.activeMesaState.mesa = mesa;
  OS.activeMesaState.membro = membro;
  OS.activeMesaState.currentUserId = uid;
  OS.activeMesaState.isMestre = isMestre;
  OS.activeMesaState.mapaUrl = OS.loadMesaMapView ? "" : (mesa.mapa_url || "");
  if (OS.loadMesaMapView) { OS.activeMesaState.mapas = isMestre ? (mesa.mapas || []) : []; OS.activeMesaState.playerMapId = mesa.mapa_ativo_jogadores_id; }
  OS.activeMesaState.gridCols = Math.max(
    4,
    Math.min(64, parseInt(String(mesa.grid_cols || 24), 10) || 24)
  );
  OS.activeMesaState.npcsMesa = Array.isArray(mesa.npcs_mesa)
    ? deepClone(mesa.npcs_mesa)
    : [];
  var npcsSanitizedMutated = sanitizeNpcsMesaListInPlace(
    OS.activeMesaState.npcsMesa
  );
  OS.activeMesaState.mesaTokens = [];
  OS.activeMesaState.gmPopups = [];
  OS.activeMesaState.gmPopupsHubExpanded = false;
  OS.activeMesaState._tokensLoadedOk = false;
  OS.activeMesaState.isDraggingLocal = false;
  OS.activeMesaState.draggingTokenId = null;
  OS.activeMesaState.pendingLocalTokenUpdates = {};
  OS.activeMesaState._hasSubscribedOnce = false;
  OS.activeMesaState._needsResyncOnSubscribe = false;
  OS.activeMesaState._isFlushingSceneRemote = false;
  OS.activeMesaState.gmEditingSheet = null;
  OS.activeMesaState.playerFichaId = null;
  OS.setMesaRealtimeStatusUi("connecting");

  // Esconder outras telas e exibir #mesa-screen em tela cheia (100vw × 100vh)
  if (!OS.isAuthenticated() || !OS.authSession || OS.authSession.userId !== uid) {
    OS.clearAuthSession();
    return false;
  }
  if (OS.hideAuthScreens) OS.hideAuthScreens();
  var homeEl = OS.$("home-screen");
  var mesaEl = OS.$("mesa-screen");
  if (homeEl) homeEl.style.display = "none";
  if (mesaEl) mesaEl.style.display = "";
  document.body.classList.add("mesa-fullscreen-active");
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
  showMesaMapUploadStatus("", false, false);

  // Atualizar cabeçalho da #mesa-screen e ferramentas compactas do Mestre
  var titleEl = OS.$("mesa-header-title");
  var codeEl = OS.$("mesa-header-code");
  var roleBadgeEl = OS.$("mesa-header-role-badge");
  var gmTopTools = OS.$("mesa-topbar-gm-tools");
  if (titleEl) titleEl.textContent = mesa.nome || "Mesa";
  if (codeEl) {
    codeEl.textContent = mesa.codigo_convite
      ? "Convite: " + mesa.codigo_convite
      : "";
  }
  if (roleBadgeEl) {
    roleBadgeEl.textContent = isMestre ? "Mestre" : "Jogador";
    roleBadgeEl.className =
      "mesa-role-badge " + (isMestre ? "badge-gm" : "badge-player");
  }
  if (gmTopTools) {
    if (isMestre) {
      gmTopTools.removeAttribute("hidden");
      gmTopTools.hidden = false;
    } else {
      gmTopTools.setAttribute("hidden", "");
      gmTopTools.hidden = true;
    }
  }

  // Visibilidade do seletor de eventos secretos no feed
  var visRow = OS.$("mesa-feed-vis-row");
  if (visRow) {
    if (isMestre) {
      visRow.removeAttribute("hidden");
      visRow.hidden = false;
    } else {
      visRow.setAttribute("hidden", "");
      visRow.hidden = true;
    }
  }

  // Renderiza o palco permanente de mapa + grade e inicia lateral em 💬 Chat (330px)
  OS.renderMesaMapStage();
  OS.switchMesaSidebarTab("chat");

  var gmListsView = OS.$("mesa-gm-lists-view");
  var sheetSlot = OS.$("mesa-sheet-slot");
  var gmSheetBar = OS.$("mesa-gm-sheet-bar");

  if (isMestre) {
    if (gmListsView) {
      gmListsView.removeAttribute("hidden");
      gmListsView.hidden = false;
    }
    if (sheetSlot) {
      sheetSlot.setAttribute("hidden", "");
      sheetSlot.hidden = true;
    }
    if (gmSheetBar) {
      gmSheetBar.setAttribute("hidden", "");
      gmSheetBar.hidden = true;
    }
    var fichaEl = OS.$("ficha");
    var toolbarEl = document.querySelector(".toolbar");
    if (fichaEl) fichaEl.style.display = "none";
    if (toolbarEl) toolbarEl.style.display = "none";

    var localMirror = OS.readMesaSceneLocal(mesa.id);
    var terrorInp = OS.$("mesa-terror-input");
    if (terrorInp) {
      terrorInp.value = String(
        localMirror && localMirror.sceneTerrorLevel !== undefined
          ? localMirror.sceneTerrorLevel
          : 0
      );
    }

    OS.renderMesaEmCenaPlaceholder();
    OS.renderMesaNpcsList();
    if (npcsSanitizedMutated) {
      OS.saveMesaNpcsRemote();
    }
    await Promise.all([
      OS.restoreMesaSceneState(mesa),
      OS.loadMesaPlayersSheets(mesa.id),
      OS.loadMesaTokens(mesa.id)
    ]);
    await OS.reconcileSceneCreaturesWithTokens();
    if (OS.loadGmPopupsStateLocal) {
      OS.loadGmPopupsStateLocal();
    }
    OS.renderMesaSceneCards();
    if (OS.renderMesaFloatingPopups) {
      OS.renderMesaFloatingPopups();
    }
    OS.renderMesaMapStage();
  } else {
    // Modo Jogador (Opção A): sem listas do Mestre; aba 👤 Fichas abre diretamente a própria #ficha completa
    if (gmListsView) {
      gmListsView.setAttribute("hidden", "");
      gmListsView.hidden = true;
    }
    if (gmSheetBar) {
      gmSheetBar.setAttribute("hidden", "");
      gmSheetBar.hidden = true;
    }
    if (sheetSlot) {
      sheetSlot.removeAttribute("hidden");
      sheetSlot.hidden = false;
    }
    moveFichaIntoMesaSlot();
    OS.activeMesaState.sceneCreatures = [];
    OS.activeMesaState.gmPopups = [];
    OS.activeMesaState.gmPopupsHubExpanded = false;
    await Promise.all([
      OS.loadPlayerSheetForMesa(mesa.id, uid),
      OS.loadMesaTokens(mesa.id)
    ]);
    OS.renderMesaSceneCards();
    if (OS.renderMesaFloatingPopups) {
      OS.renderMesaFloatingPopups();
    }
    OS.showSheetScreen({ insideMesa: true, readOnlyMode: false });
    OS.renderMesaMapStage();
  }

  if (OS.initMesaNotes) OS.initMesaNotes();
  clearInterval(OS.deliveryTimer);
  if (!isMestre && OS.processMesaDeliveries) {
    await OS.processMesaDeliveries();
    OS.deliveryTimer = setInterval(function () { OS.processMesaDeliveries(); }, 8000);
  }
  await OS.loadMesaFeedEvents(mesa.id);
  if (!OS.isAuthenticated() || !OS.authSession || OS.authSession.userId !== uid) {
    OS.clearAuthSession();
    return false;
  }
  if (OS.loadMesaCombat) await OS.loadMesaCombat();
  OS.subscribeMesaRealtimeChannel(mesa.id, { isReconnect: false });
  if (!isMestre) {
    // UPDATE que oculta uma linha pode deixar de ser entregue por RLS.
    // Releitura também atualiza metadados do mapa, agora privados no Realtime de mesas.
    clearInterval(OS.publicSceneTimer);
    var polling = false;
    OS.publicSceneTimer = setInterval(async function () {
      if (polling || OS.activeMesaState.mesaId !== mesa.id || OS.activeMesaState.isDraggingLocal) return;
      polling = true;
      try { await OS.refreshMesaStageAndTokens(); }
      finally { polling = false; }
    }, 2000);
  }
  return true;
};

OS.isBlankPlayerMesaSheet = function (dados) {
  if (!dados || typeof dados !== "object") return true;
  var keys = Object.keys(dados);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (
      (k.indexOf("pericia-") === 0 || k.indexOf("combate-") === 0) &&
      dados[k] === true
    ) {
      return false;
    }
  }
  if (Array.isArray(dados.inventoryItems) && dados.inventoryItems.length > 0) {
    return false;
  }
  if (typeof dados.inventario === "string" && dados.inventario.trim().length > 0) {
    return false;
  }
  return true;
};

OS.loadPlayerSheetForMesa = async function (mesaId, userId) {
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client || !mesaId || !userId) return;

  var res = await client
    .from("fichas")
    .select("*")
    .eq("mesa_id", mesaId)
    .eq("usuario_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  var fichaRow =
    res && Array.isArray(res.data) && res.data.length ? res.data[0] : null;

  if (!fichaRow) {
    if (OS.switchMesaSidebarTab) OS.switchMesaSidebarTab("fichas");
    await OS.createNewCharacter({
      mesaId: mesaId,
      userId: userId,
      existingFichaId: null
    });
    return;
  }

  var existingDados =
    fichaRow.dados && typeof fichaRow.dados === "object"
      ? fichaRow.dados
      : {};

  if (OS.isBlankPlayerMesaSheet(existingDados)) {
    OS.activeMesaState.playerFichaId = fichaRow.id;
    var existingDefaultName =
      fichaRow.nome_personagem || existingDados.nome || "";
    if (OS.switchMesaSidebarTab) OS.switchMesaSidebarTab("fichas");
    await OS.createNewCharacter({
      mesaId: mesaId,
      userId: userId,
      existingFichaId: fichaRow.id,
      defaultName: existingDefaultName
    });
    return;
  }

  OS.activeMesaState.playerFichaId = fichaRow.id;
  var dados = deepClone(existingDados);
  dados.freeEdit = false;
  dados.mesa_id = mesaId;
  OS.clearForm({ freeEdit: false });
  OS.applyState(dados, { readOnlyMode: false });
  if (fichaRow.nome_personagem && !dados.nome) {
    var nEl = OS.$("nome");
    if (nEl) nEl.value = fichaRow.nome_personagem;
  }
  var charName = fichaRow.nome_personagem || dados.nome || "Personagem";
  OS.activeCharacterName = charName;
  OS.activeCharacterFilename = OS.toCharacterFilename(charName);
  OS.activeCharacterMesaId = mesaId;
  OS.initCylinder();
};

OS.leaveMesaScreen = async function () {
  if (OS.flushMesaNotes && !(await OS.flushMesaNotes())) return false;
  clearInterval(OS.deliveryTimer);
  if (OS.activeMesaState.deliveryTask) await OS.activeMesaState.deliveryTask;
  if (OS.clearMesaNotes) OS.clearMesaNotes();
  OS.activeMesaState.tokenStatus = {};
  if (OS.clearMesaMaps) OS.clearMesaMaps();
  if (OS.cancelMapTokenDrag) OS.cancelMapTokenDrag();
  OS.resetMapCamera();
  var channelTeardownPromise = OS.teardownMesaRealtimeChannel();

  if (OS.activeMesaState && OS.activeMesaState.mesaId) {
    if (OS.activeMesaState.isMestre) {
      if (
        OS.activeMesaState.gmEditingSheet &&
        OS.activeMesaState.gmEditingSheet.mode !== "player-readonly"
      ) {
        await OS.saveActiveGmEditedSheet();
      }
      await OS.flushMesaSceneRemoteSave();
    } else if (OS.activeMesaState.playerFichaId) {
      await OS.saveActivePlayerMesaSheet();
    }
  }

  await channelTeardownPromise;

  OS.activeMesaState.mesaId = null;
  if (OS.resetMesaCombat) OS.resetMesaCombat();
  OS.activeMesaState.mesa = null;
  OS.activeMesaState.membro = null;
  OS.activeMesaState.currentUserId = null;
  OS.activeMesaState.isMestre = false;
  OS.activeMesaState.activeSidebarTab = "chat";
  OS.activeMesaState.mapaUrl = "";
  OS.activeMesaState.gridCols = 24;
  OS.activeMesaState.npcsMesa = [];
  OS.activeMesaState.mesaTokens = [];
  OS.activeMesaState.sceneCreatures = [];
  OS.activeMesaState.gmPopups = [];
  OS.activeMesaState.gmPopupsHubExpanded = false;
  OS.activeMesaState.isDraggingLocal = false;
  OS.activeMesaState.draggingTokenId = null;
  OS.activeMesaState.pendingLocalTokenUpdates = {};
  OS.activeMesaState.realtimeStatus = "idle";
  OS.activeMesaState._hasSubscribedOnce = false;
  OS.activeMesaState._needsResyncOnSubscribe = false;
  OS.activeMesaState._isFlushingSceneRemote = false;
  OS.activeMesaState.gmEditingSheet = null;
  OS.activeMesaState.playerFichaId = null;
  OS.activeMesaState.playerSheets = [];
  OS.activeMesaState.feedEvents = [];
  if (OS.renderMesaMapTokens) OS.renderMesaMapTokens();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();

  OS.switchMesaSidebarTab("chat");

  document.body.classList.remove("mesa-fullscreen-active");
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
  if (OS.setFreeEditMode) OS.setFreeEditMode(false);
  if (OS.restoreFichaToHomeSlot) OS.restoreFichaToHomeSlot();
  OS.showHomeScreen({ tab: "mesas" });
};

OS.closeMesaToHome = OS.leaveMesaScreen;

OS.saveActivePlayerMesaSheet = async function (stateArg) {
  if (OS.activeMesaState && OS.activeMesaState._pendingPlayerSheetUpsert) {
    try {
      await OS.activeMesaState._pendingPlayerSheetUpsert;
    } catch (e) {
      /* ignore */
    }
  }
  if (
    !OS.activeMesaState ||
    !OS.activeMesaState.mesaId ||
    OS.activeMesaState.isMestre ||
    !OS.activeMesaState.playerFichaId
  ) {
    return false;
  }
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var state = stateArg || OS.collectState();
  state.mesa_id = OS.activeMesaState.mesaId;
  state.freeEdit = false;
  if (!client) return false;

  var mesaId = OS.activeMesaState.mesaId;
  var res = await client
    .from("fichas")
    .update({
      nome_personagem: state.nome || "Personagem",
      nivel: parseInt(String(state.nivel || 1), 10) || 1,
      dados: state,
      updated_at: new Date().toISOString()
    })
    .eq("id", OS.activeMesaState.playerFichaId);
  if (res && res.error) { console.warn("[saveActivePlayerMesaSheet]", res.error); return false; }
  if (OS.activeMesaState.mesaId === mesaId) await OS.loadMesaTokens(mesaId);
  return true;
};

/* ─── 4a. Bestiário Oficial (dist/data/bestiario/) ───────────── */

OS.loadOfficialBestiary = async function () {
  if (OS.bestiaryCatalog.loaded && OS.bestiaryCatalog.official.length > 0) {
    return OS.bestiaryCatalog.official;
  }
  if (OS.bestiaryCatalog.loading) {
    return OS.bestiaryCatalog.loading;
  }

  OS.bestiaryCatalog.loading = (async function () {
    var idxRes = await fetch(BESTIARIO_INDEX_URL);
    if (!idxRes.ok) {
      throw new Error("Falha ao carregar bestiario-index.json");
    }
    var index = await idxRes.json();
    var basePath = (index.basePath || "data/bestiario").replace(/\/+$/, "");
    var files = Array.isArray(index.files) ? index.files : [];
    var loadedList = [];

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var url = basePath + "/" + f.path;
      var r = await fetch(url);
      if (!r.ok) continue;
      var payload = await r.json();
      var data = OS.unwrapCharacterPayload
        ? OS.unwrapCharacterPayload(payload)
        : (payload && payload.data) || payload || {};
      var entry = {
        key: "oficial:" + f.id,
        id: f.id,
        sourceType: "oficial",
        name:
          data.nome ||
          f.name ||
          (payload && payload.meta && payload.meta.name) ||
          f.id,
        category: f.category || "Criatura",
        meta: deepClone((payload && payload.meta) || {}),
        data: deepClone(data)
      };
      // Oficial sempre tem freeEdit=true quando aberto ou clonado
      entry.data.freeEdit = true;
      loadedList.push(entry);
      OS.bestiaryCatalog.byId[f.id] = entry;
    }

    OS.bestiaryCatalog.official = loadedList;
    OS.bestiaryCatalog.loaded = true;
    OS.bestiaryCatalog.loading = null;
    return loadedList;
  })();

  return OS.bestiaryCatalog.loading;
};

OS.getOfficialBestiaryEntry = function (id) {
  var found = OS.bestiaryCatalog.byId[id];
  return found ? deepClone(found) : null;
};

/* ─── 4b. NPCs / Monstros Customizados do Mestre (public.fichas com mesa_id = NULL) ─── */

function getCustomNpcsLocalCache(uid) {
  if (!uid) return [];
  try {
    var raw = localStorage.getItem(CUSTOM_NPCS_LS_PREFIX + uid);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function setCustomNpcsLocalCache(uid, list) {
  if (!uid) return;
  try {
    localStorage.setItem(CUSTOM_NPCS_LS_PREFIX + uid, JSON.stringify(list || []));
  } catch (e) {
    /* ignore */
  }
}

OS.loadCustomNpcs = async function () {
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!uid) {
    OS.bestiaryCatalog.custom = [];
    return [];
  }

  var entries = [];
  if (client) {
    try {
      var res = await client
        .from("fichas")
        .select("*")
        .eq("usuario_id", uid)
        .is("mesa_id", null)
        .order("updated_at", { ascending: false });

      if (res && Array.isArray(res.data)) {
        res.data.forEach(function (row) {
          var d = row.dados && typeof row.dados === "object" ? row.dados : {};
          if (
            d.isBestiaryCustom === true ||
            d.freeEdit === true ||
            d.tipo_ficha === "npc" ||
            d.tipo_ficha === "monstro" ||
            row.classe === "npc" ||
            row.classe === "monstro" ||
            d.isCriatura !== undefined ||
            d["is-criatura"] !== undefined ||
            d.operationalMode !== undefined
          ) {
            var copyData = deepClone(d);
            copyData.freeEdit = true;
            copyData.isBestiaryCustom = true;
            if (!copyData.nome && row.nome_personagem) {
              copyData.nome = row.nome_personagem;
            }
            entries.push({
              key: "custom:" + row.id,
              id: row.id,
              sourceType: "custom",
              name:
                copyData.nome ||
                row.nome_personagem ||
                "NPC Customizado",
              category:
                (copyData.tipo_ficha || row.classe) === "monstro" ? "Monstro" : "NPC",
              updatedAt: row.updated_at,
              data: copyData
            });
          }
        });
        setCustomNpcsLocalCache(uid, entries);
        OS.bestiaryCatalog.custom = entries;
        return entries;
      }
    } catch (err) {
      console.warn("[mesaScreen] Falha ao buscar NPCs no Supabase, usando cache local:", err);
    }
  }

  entries = getCustomNpcsLocalCache(uid);
  OS.bestiaryCatalog.custom = entries;
  return entries;
};

OS.saveCustomNpcToSupabase = async function (stateData, existingId, tipoFicha) {
  if (OS.activeMesaState && OS.activeMesaState.mesaId && !OS.activeMesaState.isMestre) {
    return null;
  }
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await ensureUsuarioProfile();
  if (!uid) return null;

  var cleanData = deepClone(stateData || {});
  cleanData.freeEdit = true;
  cleanData.isBestiaryCustom = true;
  if (tipoFicha && (!cleanData.tipo_ficha || String(cleanData.tipo_ficha).trim() === "")) {
    cleanData.tipo_ficha = tipoFicha;
  }
  var modeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(cleanData)
    : null;
  if (modeChoice === true) {
    cleanData.isCriatura = true;
    cleanData["is-criatura"] = true;
    cleanData.operationalMode = "creature_mode";
  } else if (modeChoice === false) {
    cleanData.isCriatura = false;
    cleanData["is-criatura"] = false;
    cleanData.operationalMode = "full_sheet";
  }
  OS.sanitizeCreature6BData(cleanData);

  var nome = String(cleanData.nome || "NPC Customizado").trim() || "NPC Customizado";
  cleanData.nome = nome;
  var rawLv = parseInt(String(cleanData.nivel || 0), 10);
  var nivelInt = isNaN(rawLv) ? 0 : rawLv;
  var sqlClasse = cleanData.tipo_ficha || tipoFicha || "npc";
  var nowIso = new Date().toISOString();

  if (client) {
    if (existingId) {
      var upd = await client
        .from("fichas")
        .update({
          nome_personagem: nome,
          nivel: nivelInt,
          classe: sqlClasse,
          dados: cleanData,
          updated_at: nowIso
        })
        .eq("id", existingId)
        .eq("usuario_id", uid)
        .select("*")
        .single();

      if (upd && upd.data) {
        await OS.loadCustomNpcs();
        return upd.data;
      }
    } else {
      var ins = await client
        .from("fichas")
        .insert({
          usuario_id: uid,
          mesa_id: null,
          nome_personagem: nome,
          nivel: nivelInt,
          classe: sqlClasse,
          dados: cleanData
        })
        .select("*")
        .single();

      if (ins && ins.data) {
        await OS.loadCustomNpcs();
        return ins.data;
      }
    }
  }

  // Fallback local por usuário
  var localList = getCustomNpcsLocalCache(uid);
  var fallbackId = existingId || generateUid("npc");
  var entry = {
    key: "custom:" + fallbackId,
    id: fallbackId,
    sourceType: "custom",
    name: nome,
    category: sqlClasse === "monstro" ? "Monstro" : "NPC",
    updatedAt: nowIso,
    data: cleanData
  };
  var idx = localList.findIndex(function (x) {
    return x.id === fallbackId;
  });
  if (idx >= 0) localList[idx] = entry;
  else localList.unshift(entry);
  setCustomNpcsLocalCache(uid, localList);
  OS.bestiaryCatalog.custom = localList;
  return { id: fallbackId, nome_personagem: nome, dados: cleanData };
};

/* ─── 4c. Cards em Cena (cena_ativa em public.mesas + localStorage) ─── */

function getSceneLocalStorageKey(mesaId) {
  return SCENE_LS_PREFIX + String(mesaId || "");
}

OS.readMesaSceneLocal = function (mesaId) {
  if (!mesaId) return null;
  try {
    var raw = localStorage.getItem(getSceneLocalStorageKey(mesaId));
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    return null;
  }
};

OS.persistMesaSceneImmediateLocal = function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return null;
  var nowIso = new Date().toISOString();
  st.sceneUpdatedAt = nowIso;
  var terrorInp = OS.$("mesa-terror-input");
  var terrorLv = terrorInp ? parseInt(String(terrorInp.value || 0), 10) || 0 : 0;
  var envelope = {
    mesaId: st.mesaId,
    updatedAt: nowIso,
    sceneTerrorLevel: terrorLv,
    cena_ativa: deepClone(st.sceneCreatures || [])
  };
  try {
    localStorage.setItem(getSceneLocalStorageKey(st.mesaId), JSON.stringify(envelope));
  } catch (e) {
    console.warn("[mesaScreen] Falha ao gravar espelho local da cena:", e);
  }
  return envelope;
};

OS.flushMesaSceneRemoteSave = async function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) return false;
  if (st.sceneSaveTimer) {
    clearTimeout(st.sceneSaveTimer);
    st.sceneSaveTimer = null;
  }
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return false;

  var statusEl = OS.$("mesa-scene-save-status");
  if (statusEl) statusEl.textContent = "Salvando cena…";

  var payload = deepClone(st.sceneCreatures || []);
  if (st.mesa) {
    st.mesa.cena_ativa = deepClone(payload);
  }
  st._isFlushingSceneRemote = true;
  try {
    var res = await client
      .from("mesas")
      .update({ cena_ativa: payload })
      .eq("id", st.mesaId);

    if (res && !res.error) {
      if (statusEl) statusEl.textContent = "Cena sincronizada";
      return true;
    } else {
      if (statusEl) statusEl.textContent = "Salvo localmente (espelho)";
      return false;
    }
  } finally {
    st._isFlushingSceneRemote = false;
  }
};

OS.scheduleMesaSceneSave = function () {
  OS.persistMesaSceneImmediateLocal();
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) return;

  var statusEl = OS.$("mesa-scene-save-status");
  if (statusEl) statusEl.textContent = "Salvando alterações…";

  if (st.sceneSaveTimer) {
    clearTimeout(st.sceneSaveTimer);
  }
  st.sceneSaveTimer = setTimeout(function () {
    OS.flushMesaSceneRemoteSave();
  }, SCENE_SAVE_DEBOUNCE_MS);
};

OS.restoreMesaSceneState = async function (mesaRow) {
  var mesaId = mesaRow && mesaRow.id;
  if (!mesaId) return [];

  var localMirror = OS.readMesaSceneLocal(mesaId);
  var remoteCena = mesaRow.cena_ativa;
  var remoteList = [];
  var remoteMaxTs = 0;

  if (Array.isArray(remoteCena)) {
    remoteList = deepClone(remoteCena);
    remoteList.forEach(function (item) {
      var ts = item && item.updatedAt ? Date.parse(item.updatedAt) : 0;
      if (!isNaN(ts) && ts > remoteMaxTs) remoteMaxTs = ts;
    });
  } else if (remoteCena && typeof remoteCena === "object" && Array.isArray(remoteCena.cena_ativa)) {
    remoteList = deepClone(remoteCena.cena_ativa);
    var rTs = remoteCena.updatedAt ? Date.parse(remoteCena.updatedAt) : 0;
    if (!isNaN(rTs)) remoteMaxTs = rTs;
  }

  var localList =
    localMirror && Array.isArray(localMirror.cena_ativa)
      ? deepClone(localMirror.cena_ativa)
      : null;
  var localTs =
    localMirror && localMirror.updatedAt
      ? Date.parse(localMirror.updatedAt)
      : 0;
  if (isNaN(localTs)) localTs = 0;

  var chosenList = remoteList;
  var shouldSyncLocalToRemote = false;

  if (localList && (localTs >= remoteMaxTs || (!remoteList.length && localList.length))) {
    chosenList = localList;
    if (localTs > remoteMaxTs) {
      shouldSyncLocalToRemote = true;
    }
  }

  var mutatedIds = false;
  chosenList = (Array.isArray(chosenList) ? chosenList : [])
    .map(function (c) {
      if (!c || typeof c !== "object") return null;
      var normId = ensureValidUuid(c.instanceId);
      if (normId !== c.instanceId) {
        c.instanceId = normId;
        mutatedIds = true;
      }
      if (c.collapsed === undefined) {
        c.collapsed = true;
      }
      if (c.data && typeof c.data === "object") {
        var san = OS.sanitizeCreature6BData(c.data);
        if (san && san.mutated) {
          mutatedIds = true;
        }
      }
      return c;
    })
    .filter(Boolean);

  if (mutatedIds) {
    shouldSyncLocalToRemote = true;
  }

  OS.activeMesaState.sceneCreatures = chosenList;
  OS.persistMesaSceneImmediateLocal();

  if (shouldSyncLocalToRemote) {
    await OS.flushMesaSceneRemoteSave();
  }

  return chosenList;
};

/**
 * Reconcilia cena_ativa (st.sceneCreatures) com mesa_tokens (owner_type = 'creature')
 * garantindo sincronia estrita 1-para-1 entre a lista "Em Cena" e os tokens no mapa.
 */
OS.reconcileSceneCreaturesWithTokens = async function () {
  // O cache contém somente o mapa visualizado. Ausência aqui não significa exclusão da cena global.
  var st = OS.activeMesaState;
  if (!st || !st.isMestre || !st._tokensLoadedOk) return;
  st.mesaTokens = (st.mesaTokens || []).filter(function (t) { return !st.activeMapId || t.mapa_id === st.activeMapId; });
  OS.renderMesaSceneCards();
};

/**
 * Adiciona um clone profundo de uma criatura (de npcs_mesa, Bestiário Oficial ou Meus NPCs)
 * na cena ativa da mesa atual, com instanceId UUID único e numeração automática quando houver repetição.
 */
OS.addCreatureToScene = function (sourceEntry, options) {
  options = options || {};
  if (!sourceEntry || !sourceEntry.data) return null;
  var st = OS.activeMesaState;
  if (!Array.isArray(st.sceneCreatures)) {
    st.sceneCreatures = [];
  }

  var clonedData = deepClone(sourceEntry.data);
  clonedData.freeEdit = true;
  var wrapperModeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(sourceEntry)
    : null;
  if (
    wrapperModeChoice !== null &&
    OS.extractCreatureModeChoice &&
    OS.extractCreatureModeChoice(clonedData) === null
  ) {
    clonedData.isCriatura = wrapperModeChoice;
    clonedData["is-criatura"] = wrapperModeChoice;
    clonedData.operationalMode = wrapperModeChoice ? "creature_mode" : "full_sheet";
  }
  if (!Array.isArray(clonedData.usedChambers)) clonedData.usedChambers = [];
  if (!Array.isArray(clonedData.activeConditions)) clonedData.activeConditions = [];
  OS.sanitizeCreature6BData(clonedData);

  var baseName = String(
    clonedData.nome || sourceEntry.name || "Criatura"
  )
    .replace(/\s+#\d+$/, "")
    .trim();

  // Verifica se já existem instâncias com o mesmo baseName em cena
  var sameBaseInstances = st.sceneCreatures.filter(function (c) {
    var cBase = String(c.baseName || c.name || "")
      .replace(/\s+#\d+$/, "")
      .trim();
    return cBase.toLowerCase() === baseName.toLowerCase();
  });

  var renamedFirstSibling = null;
  var displayName = baseName;
  if (sameBaseInstances.length >= 1) {
    // Se a primeira instância ainda não estava numerada com #1, numera-a agora como #1
    if (sameBaseInstances.length === 1 && !/#\d+$/.test(sameBaseInstances[0].name)) {
      var prevFirstName = sameBaseInstances[0].name;
      sameBaseInstances[0].name = baseName + " #1";
      if (sameBaseInstances[0].data) {
        sameBaseInstances[0].data.nome = sameBaseInstances[0].name;
      }
      sameBaseInstances[0].updatedAt = new Date().toISOString();
      renamedFirstSibling = {
        instanceRef: sameBaseInstances[0],
        instanceId: sameBaseInstances[0].instanceId,
        previousName: prevFirstName,
        newName: sameBaseInstances[0].name
      };
    }
    // Encontra o próximo número disponível
    var maxNum = 0;
    sameBaseInstances.forEach(function (inst, idx) {
      var m = String(inst.name || "").match(/#(\d+)$/);
      var n = m ? parseInt(m[1], 10) : idx + 1;
      if (n > maxNum) maxNum = n;
    });
    displayName = baseName + " #" + (maxNum + 1);
  }

  clonedData.nome = displayName;
  var nowIso = new Date().toISOString();
  var instanceModeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(clonedData)
    : null;
  if (
    instanceModeChoice === false &&
    (clonedData.iniciativa === undefined ||
      clonedData.iniciativa === "" ||
      String(clonedData.iniciativa).trim() === "0") &&
    OS.resolveIndividual6BInitiative
  ) {
    var derivedInitOnAdd = OS.resolveIndividual6BInitiative(clonedData, { fromChambersOnly: true });
    if (derivedInitOnAdd !== 0) {
      clonedData.iniciativa = String(derivedInitOnAdd);
      clonedData._initiativeFrom6B = true;
    }
  }
  var instance = {
    instanceId: generateUuidV4(),
    baseName: baseName,
    name: displayName,
    collapsed: true,
    sourceType: sourceEntry.sourceType || "oficial",
    sourceCategory: sourceEntry.sourceCategory || sourceEntry.category || null,
    sourceId: sourceEntry.mesaNpcId || sourceEntry.id || null,
    isCriatura: instanceModeChoice,
    operationalMode:
      instanceModeChoice === true
        ? "creature_mode"
        : instanceModeChoice === false
        ? "full_sheet"
        : null,
    updatedAt: nowIso,
    data: clonedData
  };

  st.sceneCreatures.push(instance);

  if (options.returnMeta) {
    return {
      instance: instance,
      renamedFirstSibling: renamedFirstSibling
    };
  }

  OS.renderMesaSceneCards();
  OS.scheduleMesaSceneSave();
  return instance;
};

OS.getSceneCreatureById = function (instanceId) {
  var list = (OS.activeMesaState && OS.activeMesaState.sceneCreatures) || [];
  return (
    list.find(function (c) {
      return c.instanceId === instanceId;
    }) || null
  );
};

function countFadigaFromState(data) {
  if (!data) return 0;
  if (Array.isArray(data.activeConditions)) {
    for (var j = 0; j < data.activeConditions.length; j++) {
      var c = data.activeConditions[j];
      var cName = typeof c === "string" ? c : c && (c.nome || c.name || c.id);
      if (String(cName || "").toLowerCase() === "fatigado") {
        var g = typeof c === "object" && c ? parseInt(String(c.grau), 10) : 1;
        return isNaN(g) ? 1 : Math.max(0, g);
      }
    }
  }
  if (!data._fatigueMigrated) {
    var legacyCount = 0;
    for (var i = 0; i < 40; i++) {
      if (data["fadiga-" + i]) legacyCount++;
    }
    data._fatigueMigrated = true;
    if (legacyCount > 0) {
      if (!Array.isArray(data.activeConditions)) data.activeConditions = [];
      data.activeConditions.push({
        nome: "Fatigado",
        grau: legacyCount,
        possui_grau: true,
        cumulativo: true
      });
      return legacyCount;
    }
  }
  return 0;
}

function setFadigaInState(data, newCount) {
  if (!data) return;
  var clamped = Math.max(0, Math.min(40, parseInt(String(newCount || 0), 10) || 0));
  data._fatigueMigrated = true;
  for (var i = 0; i < 40; i++) {
    delete data["fadiga-" + i];
  }
  if (!Array.isArray(data.activeConditions)) {
    data.activeConditions = [];
  }
  var idx = data.activeConditions.findIndex(function (c) {
    var cName = typeof c === "string" ? c : c && (c.nome || c.name || c.id);
    return String(cName || "").toLowerCase() === "fatigado";
  });
  if (clamped <= 0) {
    if (idx >= 0) {
      data.activeConditions.splice(idx, 1);
    }
  } else if (idx >= 0) {
    var existing = data.activeConditions[idx];
    if (typeof existing === "object" && existing) {
      existing.nome = "Fatigado";
      existing.grau = clamped;
      existing.possui_grau = true;
      existing.cumulativo = true;
    } else {
      data.activeConditions[idx] = {
        nome: "Fatigado",
        grau: clamped,
        possui_grau: true,
        cumulativo: true
      };
    }
  } else {
    data.activeConditions.push({
      nome: "Fatigado",
      grau: clamped,
      possui_grau: true,
      cumulativo: true
    });
  }
}

function applyCreatureStatsChanges(entity, changes) {
  if (!entity || !entity.data) return false;
  changes = changes || {};
  var d = entity.data;
  if (changes.config6BText !== undefined) {
    var configText = String(changes.config6BText).trim();
    if (!/^[1-9]\d*d(?:4|6|8|10|12)(?:\s*\+\s*[1-9]\d*d(?:4|6|8|10|12))*$/i.test(configText)) return false;
    d["config-6b"] = configText.toLowerCase();
  }
  var info6B = OS.resolveCreature6BInfo(d);
  var maxChambers = info6B.count;

  if (changes.defesa !== undefined) {
    d.defesa = String(changes.defesa);
  }
  if (changes.iniciativa !== undefined) {
    d.iniciativa = String(changes.iniciativa);
  }
  if (changes.fadiga !== undefined) {
    setFadigaInState(d, changes.fadiga);
  }
  if (changes.addCondition) {
    if (!Array.isArray(d.activeConditions)) {
      d.activeConditions = [];
    }
    var condName = String(changes.addCondition).trim();
    if (condName) {
      var exists = d.activeConditions.some(function (c) {
        var n = typeof c === "string" ? c : c && (c.nome || c.name || c.id);
        return String(n || "").toLowerCase() === condName.toLowerCase();
      });
      if (!exists) {
        d.activeConditions.push({
          id: generateUid("cond"),
          nome: condName
        });
      }
    }
  }
  if (changes.removeConditionIndex !== undefined) {
    if (Array.isArray(d.activeConditions)) {
      d.activeConditions.splice(changes.removeConditionIndex, 1);
    }
  }
  if (changes.toggleChamber !== undefined) {
    var chIdx = parseInt(String(changes.toggleChamber), 10);
    if (!isNaN(chIdx) && chIdx >= 0 && chIdx < maxChambers) {
      if (!Array.isArray(d.usedChambers)) d.usedChambers = [];
      var pos = d.usedChambers.indexOf(chIdx);
      if (pos >= 0) d.usedChambers.splice(pos, 1);
      else d.usedChambers.push(chIdx);
    }
  }
  if (changes.notas !== undefined) {
    // Notes on a creature remain separate from the GM notebook.
    d.notas = String(changes.notas);
  }
  if (changes.damageCount !== undefined) {
    var wounds = Math.max(0, Math.min(maxChambers, parseInt(changes.damageCount, 10) || 0));
    d.damagedChambers = Array.from({ length: wounds }, function (_, i) { return i; });
  }
  if (changes.isCriatura !== undefined) {
    if (changes.isCriatura === true) {
      d.isCriatura = true;
      d["is-criatura"] = true;
      d.operationalMode = "creature_mode";
      entity.isCriatura = true;
      entity.operationalMode = "creature_mode";
    } else if (changes.isCriatura === false) {
      d.isCriatura = false;
      d["is-criatura"] = false;
      d.operationalMode = "full_sheet";
      entity.isCriatura = false;
      entity.operationalMode = "full_sheet";
    } else {
      delete d.isCriatura;
      delete d["is-criatura"];
      delete d.operationalMode;
      delete entity.isCriatura;
      delete entity.operationalMode;
    }
  }

  OS.sanitizeCreature6BData(d);
  entity.updatedAt = new Date().toISOString();
  return true;
}

OS.updateSceneCreatureStats = function (instanceId, changes) {
  if (!OS.activeMesaState || !OS.activeMesaState.isMestre) return null;
  var inst = OS.getSceneCreatureById(instanceId);
  if (!inst || !inst.data) return null;
  applyCreatureStatsChanges(inst, changes);
  var st = OS.activeMesaState;
  if (st.combateAtivo && st.combateAtivo.ativo) {
    if (changes && changes.iniciativa !== undefined && OS.recordNextRoundInitiative) {
      OS.recordNextRoundInitiative(instanceId, inst.data.iniciativa);
    }
    if (
      changes &&
      (changes.addCondition !== undefined ||
        changes.removeConditionIndex !== undefined ||
        changes.isCriatura !== undefined) &&
      OS.recalculateCombatantTurnBudget
    ) {
      OS.recalculateCombatantTurnBudget(instanceId);
    }
  }
  OS.renderMesaSceneCards();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  OS.syncSceneTokenInitiative(inst);
  OS.scheduleMesaSceneSave();
  return inst;
};

OS.updateMesaNpcStats = function (mesaNpcId, changes) {
  if (!OS.activeMesaState || !OS.activeMesaState.isMestre) return null;
  var item = OS.getMesaNpcById(mesaNpcId);
  if (!item || !item.data) return null;
  applyCreatureStatsChanges(item, changes);
  OS.renderMesaNpcsList();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  OS.saveMesaNpcsRemote();
  return item;
};

function rollCreatureEntity6B(entity, forcedValues) {
  if (!entity || !entity.data) return null;
  var info = OS.sanitizeCreature6BData(entity.data);
  var diceList = info.diceList;
  var forced = Array.isArray(forcedValues) ? forcedValues : null;

  for (var c = 0; c < diceList.length; c++) {
    var sides = parseInt(diceList[c].slice(1), 10) || 6;
    var rolled =
      forced && c < forced.length && Number.isFinite(Number(forced[c]))
        ? Math.max(0, Math.trunc(Number(forced[c])))
        : Math.floor(Math.random() * sides) + 1;
    entity.data["chamber-" + c] = String(rolled);
  }
  entity.data.usedChambers = [];

  var opInfo = OS.resolveCombatantOperationalInfo
    ? OS.resolveCombatantOperationalInfo(entity)
    : null;
  if (
    opInfo &&
    opInfo.operationalMode === "full_sheet" &&
    opInfo.kind !== "bestiary_monster" &&
    OS.resolveIndividual6BInitiative
  ) {
    entity.data.iniciativa = String(
      OS.resolveIndividual6BInitiative(entity.data, { fromChambersOnly: true })
    );
    entity.data._initiativeFrom6B = true;
  }

  entity.updatedAt = new Date().toISOString();
  return entity;
}

OS.rollSceneCreature6B = function (instanceId, forcedValues) {
  var inst = OS.getSceneCreatureById(instanceId);
  if (!inst || !inst.data) return null;
  rollCreatureEntity6B(inst, forcedValues);
  var st = OS.activeMesaState;
  if (
    st &&
    st.combateAtivo &&
    st.combateAtivo.ativo &&
    inst.data._initiativeFrom6B &&
    OS.recordNextRoundInitiative
  ) {
    OS.recordNextRoundInitiative(instanceId, inst.data.iniciativa);
  }
  OS.renderMesaSceneCards();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  OS.syncSceneTokenInitiative(inst);
  OS.scheduleMesaSceneSave();
  return inst;
};

OS.rollMesaNpc6B = function (mesaNpcId) {
  var item = OS.getMesaNpcById(mesaNpcId);
  if (!item || !item.data) return null;
  rollCreatureEntity6B(item);
  OS.renderMesaNpcsList();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  OS.saveMesaNpcsRemote();
  return item;
};

function getSlotSelectedDieFromData(d, slotCategory) {
  if (!d || typeof d !== "object") return "";
  var slug = String(slotCategory || "corpo_a_corpo").replace(/_/g, "-");
  var prefix = "combate-" + slug + "-";
  var diceOrder = ["d12", "d10", "d8", "d6", "d4"];
  for (var i = 0; i < diceOrder.length; i++) {
    if (d[prefix + diceOrder[i]]) return diceOrder[i];
  }
  return "";
}

OS.getSceneCreatureAttacks = function (instOrData) {
  var d = instOrData && instOrData.data ? instOrData.data : instOrData || {};
  var parsed = OS.parseEquipmentAttackLines
    ? OS.parseEquipmentAttackLines(d.equipamentos || "", d)
    : [];
  var out = [];
  var seenNames = {};

  parsed.forEach(function (atk, idx) {
    var key = atk.naturalKey || "natural-" + idx;
    var saved =
      (d.sceneAttackRolls && d.sceneAttackRolls[key]) ||
      (d.skillRollResults && d.skillRollResults[key]);
    var rollText = saved
      ? typeof saved === "string"
        ? saved
        : saved.text || ""
      : atk.lastWeaponRollText || "";
    seenNames[String(atk.name || "").trim().toLowerCase()] = true;
    out.push({
      index: out.length,
      key: key,
      name: atk.name,
      rawLine: atk.rawLine,
      skillDie: atk.naturalSkillDie || getSlotSelectedDieFromData(d, atk.slotCategory),
      damageExpr: atk.damageExpr || "d6",
      slotCategory: atk.slotCategory || "corpo_a_corpo",
      lastRollText: rollText
    });
  });

  if (Array.isArray(d.inventoryItems)) {
    d.inventoryItems.forEach(function (invItem, wIdx) {
      if (!invItem || invItem.group !== "armas" || !invItem.equipped) return;
      var lower = String(invItem.name || "").trim().toLowerCase();
      if (seenNames[lower]) return;
      seenNames[lower] = true;
      var cats = OS.getEquippedCategories ? OS.getEquippedCategories(invItem) : ["arma_curta"];
      var slot = cats[0] || "arma_curta";
      var sDie = getSlotSelectedDieFromData(d, slot);
      var dmg = (invItem.attrs && invItem.attrs.dano) || "d6";
      var key = "inv-" + (invItem.id || wIdx);
      var saved = d.sceneAttackRolls && d.sceneAttackRolls[key];
      var rollText = saved
        ? typeof saved === "string"
          ? saved
          : saved.text || ""
        : invItem.lastWeaponRollText || invItem.lastMeleeRollText || invItem.lastRangedRollText || "";
      out.push({
        index: out.length,
        key: key,
        invId: invItem.id,
        name: invItem.name,
        rawLine: "⚙ " + invItem.name + " — Perícia " + (sDie || "d4-2") + " + Dano " + dmg,
        skillDie: sDie,
        damageExpr: dmg,
        slotCategory: slot,
        lastRollText: rollText
      });
    });
  }

  return out;
};

function rollCreatureEntityAttack(entity, attackSpec, optSelectedChambers, onReload6B, afterUpdate) {
  if (!entity || !entity.data) return null;

  var attacks = OS.getSceneCreatureAttacks(entity);
  var atk = null;

  if (typeof attackSpec === "number") {
    atk = attacks[attackSpec] || attacks[0] || null;
  } else if (typeof attackSpec === "string") {
    var trimmed = attackSpec.trim();
    var asNum = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    if (!isNaN(asNum) && attacks[asNum]) {
      atk = attacks[asNum];
    } else {
      atk =
        attacks.find(function (a) {
          return (
            a.key === trimmed ||
            a.name.toLowerCase() === trimmed.toLowerCase() ||
            a.rawLine === trimmed
          );
        }) ||
        attacks[0] ||
        null;
    }
  } else if (attackSpec && typeof attackSpec === "object") {
    atk =
      attacks.find(function (a) {
        return (
          (attackSpec.key && a.key === attackSpec.key) ||
          (typeof attackSpec.index === "number" && a.index === attackSpec.index) ||
          (attackSpec.name && a.name.toLowerCase() === String(attackSpec.name).toLowerCase())
        );
      }) || {
        index: typeof attackSpec.index === "number" ? attackSpec.index : 0,
        key: attackSpec.key || "natural-0",
        name: attackSpec.name || "Ataque",
        rawLine: attackSpec.rawLine || attackSpec.name || "Ataque",
        skillDie: attackSpec.skillDie || "",
        damageExpr: attackSpec.damageExpr || "d6",
        slotCategory: attackSpec.slotCategory || "corpo_a_corpo"
      };
  } else {
    atk = attacks[0] || null;
  }

  if (!atk) return null;

  var d = entity.data;
  OS.sanitizeCreature6BData(d);
  var info6B = OS.resolveCreature6BInfo(d);
  var maxChambers = info6B.count;
  if (!Array.isArray(d.usedChambers)) d.usedChambers = [];

  var getAvailableChamberIndices = function () {
    var avail = [];
    for (var c = 0; c < maxChambers; c++) {
      var val = parseInt(String(d["chamber-" + c] || "0"), 10) || 0;
      if (val > 0 && d.usedChambers.indexOf(c) < 0 && !(OS.getRealDamagedChambers && OS.getRealDamagedChambers(d, maxChambers).includes(c))) {
        avail.push(c);
      }
    }
    return avail;
  };

  var availIndices = getAvailableChamberIndices();
  if (!availIndices.length) {
    if (typeof onReload6B === "function") {
      onReload6B();
    } else {
      rollCreatureEntity6B(entity);
    }
    d = entity.data;
    availIndices = getAvailableChamberIndices();
  }

  var chosenChambers = null;
  if (Array.isArray(optSelectedChambers) && optSelectedChambers.length > 0) {
    chosenChambers = optSelectedChambers.slice();
  } else if (
    attackSpec &&
    typeof attackSpec === "object" &&
    Array.isArray(attackSpec.selectedChambers) &&
    attackSpec.selectedChambers.length > 0
  ) {
    chosenChambers = attackSpec.selectedChambers.slice();
  } else if (availIndices.length > 0) {
    chosenChambers = [availIndices[0]];
  } else {
    chosenChambers = [0];
  }

  var chamberValues = [];
  var chamberBonus = 0;
  chosenChambers.forEach(function (idx) {
    var cIdx = parseInt(String(idx), 10);
    if (isNaN(cIdx) || cIdx < 0 || cIdx >= maxChambers) return;
    var val = parseInt(String(d["chamber-" + cIdx] || "0"), 10) || 0;
    chamberValues.push(val);
    chamberBonus += val;
    if (d.usedChambers.indexOf(cIdx) < 0) {
      d.usedChambers.push(cIdx);
    }
  });

  var skillDie = atk.skillDie || getSlotSelectedDieFromData(d, atk.slotCategory);
  var skillTotal = 0;
  var skillBreakdown = "";
  if (skillDie) {
    var sRoll = OS.rollSelectedDiceDetailed
      ? OS.rollSelectedDiceDetailed([skillDie])
      : {
          results: [
            OS.generateDiceResult
              ? OS.generateDiceResult(skillDie)
              : Math.floor(Math.random() * 6) + 1
          ],
          details: []
        };
    skillTotal = OS.getHighestRoll ? OS.getHighestRoll(sRoll.results) : sRoll.results[0];
    skillBreakdown = "1" + skillDie + "(" + skillTotal + ")";
  } else {
    var rawD4 = OS.generateDiceResult
      ? OS.generateDiceResult("d4")
      : Math.floor(Math.random() * 4) + 1;
    skillTotal = rawD4 - 2;
    skillBreakdown = "1d4(" + rawD4 + ")-2";
  }

  var dmgExpr = atk.damageExpr || "d6";
  var dmgRoll = OS.rollWeaponDamageString
    ? OS.rollWeaponDamageString(dmgExpr)
    : { total: 1, label: dmgExpr };

  var finalTotal = skillTotal + dmgRoll.total + chamberBonus;
  var rollText =
    "Perícia " +
    skillTotal +
    " + Dano " +
    dmgRoll.label +
    "(" +
    dmgRoll.total +
    ") + 6B(+" +
    chamberBonus +
    ") = " +
    finalTotal;

  if (!d.sceneAttackRolls || typeof d.sceneAttackRolls !== "object") {
    d.sceneAttackRolls = {};
  }
  d.sceneAttackRolls[atk.key] = {
    text: rollText,
    total: finalTotal,
    rolled: true,
    updatedAt: new Date().toISOString()
  };

  if (!d.skillRollResults || typeof d.skillRollResults !== "object") {
    d.skillRollResults = {};
  }
  d.skillRollResults[atk.key] = {
    text: rollText,
    total: finalTotal,
    rolled: true
  };
  var slotRollKey =
    "combate-" + String(atk.slotCategory || "corpo_a_corpo").replace(/_/g, "-");
  d.skillRollResults[slotRollKey] = {
    text: atk.name + ": " + rollText,
    rolled: true
  };

  if (atk.invId && Array.isArray(d.inventoryItems)) {
    var matchInv = d.inventoryItems.find(function (it) {
      return it && it.id === atk.invId;
    });
    if (matchInv) {
      matchInv.lastWeaponRoll = finalTotal;
      matchInv.lastWeaponRollText = rollText;
      if (atk.slotCategory === "corpo_a_corpo") {
        matchInv.lastMeleeRollText = rollText;
      } else {
        matchInv.lastRangedRollText = rollText;
      }
    }
  }

  entity.updatedAt = new Date().toISOString();
  if (typeof afterUpdate === "function") {
    afterUpdate();
  }

  var rollModal = document.getElementById("roll-modal");
  if (rollModal) {
    if (OS.syncTestCalcModalPlacement) {
      OS.syncTestCalcModalPlacement("roll-modal-test-calc-slot", false);
    }
    var creatureTitle = entity.name || d.nome || "Criatura";
    var titleEl = document.getElementById("roll-modal-title");
    var subEl = document.getElementById("roll-modal-sub");
    var detailsEl = document.getElementById("roll-modal-details");
    var totalEl = document.getElementById("roll-modal-total");
    var totalLabel = rollModal.querySelector(".roll-total-label");
    if (titleEl) titleEl.textContent = creatureTitle + " — " + atk.name;
    if (subEl) subEl.textContent = "Perícia + Dano + Valores do 6B";
    if (totalLabel) totalLabel.textContent = "Resultado Final";
    if (totalEl) totalEl.textContent = String(finalTotal);
    if (detailsEl) {
      detailsEl.innerHTML =
        '<div class="roll-line">Perícia (' +
        escHtml(skillDie || "d4-2") +
        "): <strong>" +
        skillTotal +
        "</strong> (" +
        escHtml(skillBreakdown) +
        ")</div>" +
        '<div class="roll-line">Dano (' +
        escHtml(dmgExpr) +
        "): <strong>" +
        dmgRoll.total +
        "</strong> (" +
        escHtml(dmgRoll.label) +
        ")</div>" +
        '<div class="roll-line">Câmaras 6B (' +
        chamberValues
          .map(function (v) {
            return "+" + v;
          })
          .join(", ") +
        "): <strong>+" +
        chamberBonus +
        "</strong></div>" +
        '<div class="roll-line roll-line-best">Total Final: <strong>' +
        finalTotal +
        "</strong></div>";
    }
    rollModal.classList.add("open");
  }

  if (OS.sendMesaFeedEvent && OS.activeMesaState && OS.activeMesaState.mesaId) {
    var visSel = OS.$("mesa-feed-visibilidade");
    var vis = visSel && visSel.value ? visSel.value : "todos";
    var feedText =
      "🎲 " +
      (entity.name || d.nome || "Criatura") +
      " rolou " +
      atk.name +
      ": " +
      rollText;
    OS.sendMesaFeedEvent(feedText, vis, "rolagem").catch(function (err) {
      console.warn("[rollCreatureEntityAttack feed]", err);
    });
  }

  return {
    instanceId: entity.instanceId || entity.mesaNpcId,
    attackKey: atk.key,
    attackName: atk.name,
    skillRoll: skillTotal,
    damageRoll: dmgRoll.total,
    chamberBonus: chamberBonus,
    selectedChambers: chosenChambers,
    total: finalTotal,
    rollText: rollText
  };
}

OS.rollSceneCreatureAttack = function (instanceId, attackSpec, optSelectedChambers) {
  var inst = OS.getSceneCreatureById(instanceId);
  if (!inst || !inst.data) return null;
  return rollCreatureEntityAttack(
    inst,
    attackSpec,
    optSelectedChambers,
    function () {
      rollCreatureEntity6B(inst);
    },
    function () {
      OS.renderMesaSceneCards();
      if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
      OS.scheduleMesaSceneSave();
    }
  );
};

OS.rollMesaNpcAttack = function (mesaNpcId, attackSpec, optSelectedChambers) {
  var item = OS.getMesaNpcById(mesaNpcId);
  if (!item || !item.data) return null;
  return rollCreatureEntityAttack(
    item,
    attackSpec,
    optSelectedChambers,
    function () {
      rollCreatureEntity6B(item);
    },
    function () {
      OS.renderMesaNpcsList();
      if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
      OS.saveMesaNpcsRemote();
    }
  );
};

OS.addPlayerToScene = async function (fichaId) {
  var st = OS.activeMesaState;
  var targetMapId = st.activeMapId, targetMesaId = st.mesaId;
  if (OS.loadMesaMapView && !targetMapId) return null;
  if (!st || !st.mesaId || !st.isMestre || !fichaId) return null;

  var fichaRow = (st.playerSheets || []).find(function (r) {
    return r && String(r.id) === String(fichaId);
  });
  if (!fichaRow) return null;

  var existingToken = (st.mesaTokens || []).find(function (t) {
    return (
      t &&
      t.owner_type === "player" &&
      String(t.owner_ref) === String(fichaRow.id)
    );
  });
  if (existingToken) {
    OS.renderMesaSceneCards();
    OS.renderMesaMapTokens();
    return existingToken;
  }

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return null;

  var d =
    fichaRow.dados && typeof fichaRow.dados === "object" ? fichaRow.dados : {};
  var charName =
    String(d.nome || fichaRow.nome_personagem || "Personagem").trim() ||
    "Personagem";
  var portraitUrl = d.retrato_url ? String(d.retrato_url).trim() : "";
  var freeCell = OS.findFirstFreeGridCell();

  var insRes = await client
    .from("mesa_tokens")
    .insert({
      mesa_id: targetMesaId,
      mapa_id: targetMapId,
      owner_type: "player",
      owner_ref: fichaRow.id,
      owner_user_id: fichaRow.usuario_id || null,
      display_name: charName.slice(0, 100),
      image_url: portraitUrl || null,
      grid_x: freeCell.x,
      grid_y: freeCell.y,
      iniciativa: OS.normalizeMesaInitiative(d.iniciativa)
    })
    .select("*")
    .single();

  if (!insRes || insRes.error || !insRes.data) {
    console.warn("[addPlayerToScene] Falha ao inserir token de jogador:", insRes && insRes.error);
    return null;
  }

  if (st.mesaId !== targetMesaId || st.activeMapId !== targetMapId) return insRes.data;
  if (!Array.isArray(st.mesaTokens)) st.mesaTokens = [];
  var alreadyInArr = st.mesaTokens.some(function (t) {
    return t && t.id === insRes.data.id;
  });
  if (!alreadyInArr) {
    st.mesaTokens.push(insRes.data);
  }

  OS.renderMesaSceneCards();
  OS.renderMesaPlayersCards();
  OS.renderMesaMapTokens();
  return insRes.data;
};

OS.removePlayerFromScene = async function (fichaId) {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre || !fichaId) return false;

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (client) {
    var delRes = await client
      .from("mesa_tokens")
      .delete()
      .eq("mesa_id", st.mesaId)
      .eq("mapa_id", st.activeMapId)
      .eq("owner_type", "player")
      .eq("owner_ref", fichaId);

    if (delRes && delRes.error) {
      console.warn("[removePlayerFromScene] Erro ao remover token:", delRes.error);
      return false;
    }
  }

  st.mesaTokens = (st.mesaTokens || []).filter(function (t) {
    return !(
      t &&
      t.owner_type === "player" &&
      String(t.owner_ref) === String(fichaId)
    );
  });

  OS.renderMesaSceneCards();
  OS.renderMesaPlayersCards();
  OS.renderMesaMapTokens();
  return true;
};

OS.addNpcMesaToScene = async function (mesaNpcId) {
  var st = OS.activeMesaState;
  var targetMapId = st.activeMapId, targetMesaId = st.mesaId;
  if (OS.loadMesaMapView && !targetMapId) return null;
  if (!st || !st.mesaId || !st.isMestre || !mesaNpcId) return null;

  var npcEntry = OS.getMesaNpcById(mesaNpcId);
  if (!npcEntry || !npcEntry.data) return null;

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return null;

  var createdMeta = OS.addCreatureToScene(npcEntry, { returnMeta: true });
  if (!createdMeta || !createdMeta.instance) return null;

  var instance = createdMeta.instance;
  var renamedFirst = createdMeta.renamedFirstSibling;
  var d = instance.data || {};
  var portraitUrl = d.retrato_url ? String(d.retrato_url).trim() : "";
  var freeCell = OS.findFirstFreeGridCell();

  var insRes = await client
    .from("mesa_tokens")
    .insert({
      mesa_id: targetMesaId,
      mapa_id: targetMapId,
      owner_type: "creature",
      owner_ref: instance.instanceId,
      owner_user_id: null,
      display_name: String(instance.name || d.nome || "Criatura").slice(0, 100),
      image_url: portraitUrl || null,
      grid_x: freeCell.x,
      grid_y: freeCell.y,
      iniciativa: OS.normalizeMesaInitiative(d.iniciativa)
    })
    .select("*")
    .single();

  if (!insRes || insRes.error || !insRes.data) {
    console.warn("[addNpcMesaToScene] Falha ao inserir token de criatura:", insRes && insRes.error);
    st.sceneCreatures = (st.sceneCreatures || []).filter(function (c) {
      return c && c.instanceId !== instance.instanceId;
    });
    if (renamedFirst && renamedFirst.instanceRef) {
      renamedFirst.instanceRef.name = renamedFirst.previousName;
      if (renamedFirst.instanceRef.data) {
        renamedFirst.instanceRef.data.nome = renamedFirst.previousName;
      }
    }
    return null;
  }

  // Se a 1ª instância do mesmo nome foi renomeada para "#1", atualiza o token dela também
  if (renamedFirst && renamedFirst.instanceId) {
    var newFirstLabel = String(renamedFirst.newName || "").slice(0, 100);
    var firstTok = (st.mesaTokens || []).find(function (t) {
      return (
        t &&
        t.owner_type === "creature" &&
        String(t.owner_ref) === String(renamedFirst.instanceId)
      );
    });
    if (firstTok) {
      firstTok.display_name = newFirstLabel;
    }
    await client
      .from("mesa_tokens")
      .update({
        display_name: newFirstLabel,
        updated_at: new Date().toISOString()
      })
      .eq("mesa_id", st.mesaId)
      .eq("owner_type", "creature")
      .eq("owner_ref", renamedFirst.instanceId);
  }

  if (st.mesaId !== targetMesaId) return { instance: instance, token: insRes.data };
  if (!Array.isArray(st.mesaTokens)) st.mesaTokens = [];
  if (st.activeMapId === targetMapId && !st.mesaTokens.some(function (t) { return t.id === insRes.data.id; })) st.mesaTokens.push(insRes.data);

  // Se havia um popup apontando para este mesaNpcId (targetType === "mesa-npc") e esta é a única instância em cena,
  // redireciona/atualiza automaticamente o popup para a instância viva em cena (targetType === "scene")
  if (Array.isArray(st.gmPopups) && st.gmPopups.length > 0) {
    var sameSourceInScene = (st.sceneCreatures || []).filter(function (c) {
      return c && String(c.sourceId) === String(mesaNpcId);
    });
    if (sameSourceInScene.length === 1) {
      var upgradedPopup = false;
      st.gmPopups.forEach(function (p) {
        if (p && p.targetType === "mesa-npc" && String(p.targetId) === String(mesaNpcId)) {
          p.targetType = "scene";
          p.targetId = instance.instanceId;
          upgradedPopup = true;
        }
      });
      if (upgradedPopup && OS.saveGmPopupsStateLocal) {
        OS.saveGmPopupsStateLocal();
      }
    }
  }

  OS.persistMesaSceneImmediateLocal();
  await OS.flushMesaSceneRemoteSave();
  OS.renderMesaSceneCards();
  OS.renderMesaMapTokens();
  if (OS.renderMesaFloatingPopups) {
    OS.renderMesaFloatingPopups();
  }

  return {
    instance: instance,
    token: insRes.data
  };
};

OS.removeCreatureFromScene = async function (instanceId) {
  var st = OS.activeMesaState, room = st.mesaId, mid = st.activeMapId;
  if (!st.isMestre || !room || !mid) return false;
  var client = OS.getSupabaseClient();
  var result = await client.from("mesa_tokens").delete().eq("mesa_id", room).eq("mapa_id", mid).eq("owner_type", "creature").eq("owner_ref", instanceId);
  if (result.error) return false;
  var remaining = await client.from("mesa_tokens").select("id").eq("mesa_id", room).eq("owner_type", "creature").eq("owner_ref", instanceId);
  if (remaining.error || st.mesaId !== room) return false;
  if (!remaining.data.length) {
    st.sceneCreatures = st.sceneCreatures.filter(function (c) { return c.instanceId !== instanceId; });
    st.gmPopups = st.gmPopups.filter(function (p) { return !(p.targetType === "scene" && p.targetId === instanceId); });
    OS.persistMesaSceneImmediateLocal(); await OS.flushMesaSceneRemoteSave();
  }
  await OS.loadMesaTokens();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  return true;
};

function resolvePlayerFichaRow(fichaId) {
  var st = OS.activeMesaState;
  if (!st || !fichaId) return null;
  var fichaRow = (st.playerSheets || []).find(function (r) {
    return r && String(r.id) === String(fichaId);
  });
  if (!fichaRow && st.playerFichaId && String(st.playerFichaId) === String(fichaId)) {
    var liveData =
      OS.activeCharacterState && typeof OS.activeCharacterState === "object"
        ? OS.activeCharacterState
        : OS.getCharacterState
        ? OS.getCharacterState()
        : {};
    if (!st._ownPlayerFichaRow || String(st._ownPlayerFichaRow.id) !== String(fichaId)) {
      st._ownPlayerFichaRow = {
        id: st.playerFichaId,
        nome_personagem: (st.mesa && st.mesa.player_nome) || liveData.nome || "Meu Personagem",
        dados: liveData
      };
    } else if (liveData && st._ownPlayerFichaRow.dados !== liveData) {
      st._ownPlayerFichaRow.dados = liveData;
    }
    fichaRow = st._ownPlayerFichaRow;
  }
  return fichaRow || null;
}

function applyFatigueTo6BValues(results, fatigue) {
  if (typeof OS.applyFatigueTo6BRoll === "function") {
    return OS.applyFatigueTo6BRoll(results, fatigue);
  }
  var values = (results || []).slice();
  var remaining = Math.max(0, fatigue || 0);
  var zeroedIndices = [];
  while (remaining > 0) {
    var highestValue = -1;
    var highestIndex = -1;
    for (var i = 0; i < values.length; i++) {
      var val = values[i] || 0;
      if (val <= 0) continue;
      if (val > highestValue) {
        highestValue = val;
        highestIndex = i;
      }
    }
    if (highestIndex === -1 || highestValue <= 0) break;
    var reduction = Math.min(remaining, highestValue);
    values[highestIndex] = highestValue - reduction;
    remaining -= reduction;
    if (values[highestIndex] === 0 && zeroedIndices.indexOf(highestIndex) === -1) {
      zeroedIndices.push(highestIndex);
    }
  }
  return { values: values, zeroedIndices: zeroedIndices };
}

/**
 * Constrói o corpo de combate do jogador para exibição na ficha flutuante (.mesa-floating-popup).
 */
OS.buildPlayerCombatCardBody = function (fichaRow, callbacks) {
  callbacks = callbacks || {};
  var d = (fichaRow && fichaRow.dados && typeof fichaRow.dados === "object") ? fichaRow.dados : {};

  var info6B = OS.getCreature6BDisplayInfo(d, { isPlayer: true });
  var chamberCount = info6B.count;
  var fadigaCount = countFadigaFromState(d);
  var usedChambers = info6B.usedChambers;
  var markedChambers = info6B.markedChambers;
  var damagedChambers = info6B.damagedChambers;
  var activeConds = Array.isArray(d.activeConditions) ? d.activeConditions : [];
  var fateTokens = (d.fateTokens && typeof d.fateTokens === "object") ? d.fateTokens : { vermelha: 0, azul: 0, verde: 0, preta: 0 };

  var remVal = d["rem-atual"] !== undefined && d["rem-atual"] !== "" ? d["rem-atual"] : (d.rem || 0);

  var chambersHtml = "";
  for (var ci = 0; ci < chamberCount; ci++) {
    var cVal = d["chamber-" + ci] !== undefined && d["chamber-" + ci] !== "" ? d["chamber-" + ci] : "0";
    var isUsed = usedChambers.indexOf(ci) >= 0 || markedChambers.indexOf(ci) >= 0;
    var isDamaged = damagedChambers.indexOf(ci) >= 0;
    var chamberClass = "scene-chamber-pill" + (isUsed ? " is-used" : "") + (isDamaged ? " is-damaged" : "");
    var chamberTitle = isDamaged
      ? "Câmara " + (ci + 1) + " (Bloqueada por Ferimento)"
      : "Clique para marcar/desmarcar câmara " + (ci + 1) + " (Valor: " + cVal + ")";
    chambersHtml +=
      '<button type="button" class="' + chamberClass + '" data-action="toggle-chamber" data-chamber="' + ci + '" title="' + chamberTitle + '">' +
      (isDamaged ? "✕" : escHtml(cVal)) +
      '</button>';
  }

  var condsHtml = "";
  if (!activeConds.length) {
    condsHtml = '<span class="scene-cond-empty">Sem condições ativas</span>';
  } else {
    activeConds.forEach(function (c, cIdx) {
      var cLabel = typeof c === "string" ? c : (c && (c.nome || c.name || c.id)) || "Condição";
      var cDeg = typeof c === "object" && c && c.grau !== undefined && c.grau !== null ? " " + c.grau : "";
      condsHtml +=
        '<span class="scene-cond-tag" data-cond-index="' + cIdx + '">' +
        escHtml(cLabel + cDeg) +
        ' <button type="button" class="scene-cond-remove" data-action="remove-cond" data-cond-index="' + cIdx + '" aria-label="Remover condição">×</button></span>';
    });
  }

  var attacks = OS.getSceneCreatureAttacks(d);
  var ataquesHtml = attacks.length
    ? attacks.map(function (atk, atkIdx) {
        var rollBadgeHtml = atk.lastRollText
          ? '<span class="weapon-roll-result rolled" data-attack-key="' + escHtml(atk.key) + '">' + escHtml(atk.lastRollText) + '</span>'
          : '<span class="weapon-roll-result" data-attack-key="' + escHtml(atk.key) + '" hidden></span>';
        return (
          '<div class="scene-attack-line" data-attack-index="' + atkIdx + '" data-attack-key="' + escHtml(atk.key) + '">' +
          '  <div class="scene-attack-main">' +
          '    <span class="scene-attack-label">' + escHtml(atk.rawLine || atk.name) + '</span>' +
          '    <button type="button" class="btn btn-secondary btn-small scene-attack-roll-btn" data-action="roll-attack" data-attack-index="' + atkIdx + '" data-attack-key="' + escHtml(atk.key) + '" title="Rolar ' + escHtml(atk.name) + '">🎲 Rolar</button>' +
          '  </div>' +
          rollBadgeHtml +
          '</div>'
        );
      }).join("")
    : '<div class="scene-attack-empty">Sem armas/ataques equipados</div>';

  var bodyEl = document.createElement("div");
  bodyEl.className = "player-combat-card-body";
  bodyEl.innerHTML =
    '<div class="scene-card-compact-summary">' +
    '  <span>Def: <strong>' + escHtml(d.defesa || "0") + '</strong></span>' +
    '  <span>Inic: <strong>' + escHtml(d.iniciativa || "0") + '</strong></span>' +
    '  <span>Fadiga: <strong>' + fadigaCount + '</strong></span>' +
    '  <span>REM: <strong>' + escHtml(remVal) + '</strong></span>' +
    '</div>' +
    '<div class="scene-card-stats-row">' +
    '  <label class="scene-stat-field">' +
    '    <span>Defesa</span>' +
    '    <input type="number" class="field-line player-defesa-input" value="' + escHtml(d.defesa || "0") + '">' +
    '  </label>' +
    '  <label class="scene-stat-field">' +
    '    <span>Iniciativa</span>' +
    '    <input type="number" class="field-line player-init-input" value="' + escHtml(d.iniciativa || "0") + '">' +
    '  </label>' +
    '  <div class="scene-stat-field">' +
    '    <span>Fadiga</span>' +
    '    <div class="scene-fadiga-controls">' +
    '      <button type="button" class="btn btn-secondary btn-small" data-action="fadiga-minus">-</button>' +
    '      <strong class="scene-fadiga-val">' + fadigaCount + '</strong>' +
    '      <button type="button" class="btn btn-secondary btn-small" data-action="fadiga-plus">+</button>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '<div class="player-fate-row">' +
    '  <div class="player-fate-pill pill-vermelha" title="Fichas Vermelhas (Ataque / Ação)">' +
    '    <span>🔴 Vermelha</span>' +
    '    <strong>' + (fateTokens.vermelha || 0) + '</strong>' +
    '  </div>' +
    '  <div class="player-fate-pill pill-azul" title="Fichas Azuis (Defesa / Reação)">' +
    '    <span>🔵 Azul</span>' +
    '    <strong>' + (fateTokens.azul || 0) + '</strong>' +
    '  </div>' +
    '  <div class="player-fate-pill pill-verde" title="Fichas Verdes (Cura / Recuperação)">' +
    '    <span>🟢 Verde</span>' +
    '    <strong>' + (fateTokens.verde || 0) + '</strong>' +
    '  </div>' +
    '  <div class="player-fate-pill pill-preta" title="Fichas Pretas (Sobrevivência)">' +
    '    <span>⚫ Preta</span>' +
    '    <strong>' + (fateTokens.preta || 0) + '</strong>' +
    '  </div>' +
    '</div>' +
    '<div class="scene-card-6b-block">' +
    '  <div class="scene-card-6b-top">' +
    '    <span class="field-label">Tambor 6B (' + (damagedChambers.length ? (chamberCount - damagedChambers.length) + "/" + chamberCount + " livres" : chamberCount + " câmaras") + ')</span>' +
    '    <button type="button" class="btn btn-secondary btn-small" data-action="roll-6b">🎲 Rolar 6B</button>' +
    '  </div>' +
    '  <div class="scene-chambers-row" data-chamber-count="' + chamberCount + '">' +
    chambersHtml +
    '  </div>' +
    '</div>' +
    '<div class="scene-damage-row" style="display:flex; gap:8px; align-items:center; margin-top:4px;">' +
    '  <label class="field-label" style="margin:0; flex:1;">Dano real (câmaras bloqueadas): ' +
    '    <input type="number" class="field-line player-damage-count" min="0" max="' + chamberCount + '" value="' + damagedChambers.length + '" style="width:50px; display:inline-block; margin-left:6px;">' +
    '  </label>' +
    '  <button type="button" class="btn btn-secondary btn-small" data-action="save-damage">Aplicar</button>' +
    '</div>' +
    '<div class="scene-card-conds-block">' +
    '  <div class="scene-conds-list">' + condsHtml + '</div>' +
    '  <div class="scene-cond-add-row">' +
    '    <input type="text" class="field-line player-cond-input" placeholder="Adicionar condição (ex: Sangrando)">' +
    '    <button type="button" class="btn btn-secondary btn-small" data-action="add-cond">+</button>' +
    '  </div>' +
    '</div>' +
    '<div class="scene-card-attacks">' + ataquesHtml + '</div>' +
    '<footer class="scene-card-footer">' +
    '  <button type="button" class="btn btn-secondary btn-small btn-player-open-sheet" data-action="open-full-sheet">Visualizar Ficha Completa</button>' +
    '</footer>';

  var defInp = bodyEl.querySelector(".player-defesa-input");
  if (defInp && typeof callbacks.onUpdateStats === "function") {
    defInp.addEventListener("change", function () {
      callbacks.onUpdateStats({ defesa: defInp.value });
    });
  }
  var initInp = bodyEl.querySelector(".player-init-input");
  if (initInp && typeof callbacks.onUpdateStats === "function") {
    initInp.addEventListener("change", function () {
      callbacks.onUpdateStats({ iniciativa: initInp.value });
    });
  }

  bodyEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var act = btn.getAttribute("data-action");
    if (act === "save-damage") {
      var damageInput = bodyEl.querySelector(".player-damage-count");
      if (damageInput && damageInput.reportValidity() && callbacks.onUpdateStats) {
        callbacks.onUpdateStats({ damageCount: damageInput.value });
      }
    } else if (act === "fadiga-minus") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ fadiga: Math.max(0, fadigaCount - 1) });
      }
    } else if (act === "fadiga-plus") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ fadiga: Math.min(40, fadigaCount + 1) });
      }
    } else if (act === "roll-6b") {
      if (typeof callbacks.onRoll6B === "function") {
        callbacks.onRoll6B();
      }
    } else if (act === "toggle-chamber") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({
          toggleChamber: btn.getAttribute("data-chamber")
        });
      }
    } else if (act === "add-cond") {
      var cInp = bodyEl.querySelector(".player-cond-input");
      if (cInp && cInp.value.trim() && typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ addCondition: cInp.value.trim() });
      }
    } else if (act === "remove-cond") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({
          removeConditionIndex: parseInt(btn.getAttribute("data-cond-index"), 10)
        });
      }
    } else if (act === "roll-attack") {
      var atkIdx = parseInt(btn.getAttribute("data-attack-index"), 10);
      var atkKey = btn.getAttribute("data-attack-key");
      if (typeof callbacks.onRollAttack === "function") {
        callbacks.onRollAttack(!isNaN(atkIdx) ? atkIdx : atkKey);
      }
    } else if (act === "open-full-sheet") {
      if (typeof callbacks.onOpenFullSheet === "function") {
        callbacks.onOpenFullSheet();
      }
    }
  });

  return bodyEl;
};

OS.updatePlayerSheetStats = function (fichaId, changes) {
  var st = OS.activeMesaState;
  if (!st) return null;
  changes = changes || {};
  var fichaRow = resolvePlayerFichaRow(fichaId);
  if (!fichaRow || !fichaRow.dados) return null;
  var d = fichaRow.dados;
  var info6B = OS.getCreature6BDisplayInfo(d, { isPlayer: true });
  var maxChambers = info6B.count;

  if (changes.defesa !== undefined) {
    d.defesa = String(changes.defesa);
  }
  if (changes.iniciativa !== undefined) {
    d.iniciativa = String(changes.iniciativa);
  }
  if (changes.fadiga !== undefined) {
    setFadigaInState(d, changes.fadiga);
  }
  if (changes.damageCount !== undefined) {
    var wounds = Math.max(0, Math.min(maxChambers, parseInt(changes.damageCount, 10) || 0));
    d.damagedChambers = Array.from({ length: wounds }, function (_, i) { return i; });
  }
  if (changes.toggleChamber !== undefined) {
    var chIdx = parseInt(String(changes.toggleChamber), 10);
    if (!isNaN(chIdx) && chIdx >= 0 && chIdx < maxChambers) {
      if (!Array.isArray(d.usedChambers)) d.usedChambers = [];
      var pos = d.usedChambers.indexOf(chIdx);
      if (pos >= 0) d.usedChambers.splice(pos, 1);
      else d.usedChambers.push(chIdx);
    }
  }
  if (changes.addCondition) {
    if (!Array.isArray(d.activeConditions)) d.activeConditions = [];
    var condName = String(changes.addCondition).trim();
    if (condName) {
      var exists = d.activeConditions.some(function (c) {
        var n = typeof c === "string" ? c : c && (c.nome || c.name || c.id);
        return String(n || "").toLowerCase() === condName.toLowerCase();
      });
      if (!exists) {
        d.activeConditions.push({ id: generateUid("cond"), nome: condName });
      }
    }
  }
  if (changes.removeConditionIndex !== undefined) {
    if (Array.isArray(d.activeConditions)) {
      d.activeConditions.splice(changes.removeConditionIndex, 1);
    }
  }

  if (st.combateAtivo && st.combateAtivo.ativo) {
    if (changes.iniciativa !== undefined && OS.recordNextRoundInitiative) {
      OS.recordNextRoundInitiative(fichaRow.id, d.iniciativa);
    }
    if (
      (changes.addCondition !== undefined || changes.removeConditionIndex !== undefined) &&
      OS.recalculateCombatantTurnBudget
    ) {
      OS.recalculateCombatantTurnBudget(fichaRow.id);
    }
  }

  // Se o próprio jogador estiver com sua ficha ativa
  if (st.playerFichaId && String(st.playerFichaId) === String(fichaRow.id)) {
    OS.activeCharacterState = d;
    if (OS.applyState && typeof document !== "undefined" && OS.$("ficha")) {
      OS.applyState(d, { readOnlyMode: false });
    }
    if (OS.saveCharacter) OS.saveCharacter();
  }

  // Persiste no Supabase
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (client && fichaRow.id) {
    client.from("fichas").update({
      dados: d,
      updated_at: new Date().toISOString()
    }).eq("id", fichaRow.id).then(function (res) {
      if (res && res.error) {
        console.warn("[mesaScreen] Falha ao atualizar dados da ficha:", res.error);
      }
    });
  }

  if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
  if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  return fichaRow;
};

OS.rollPlayerPopup6B = function (fichaId) {
  var st = OS.activeMesaState;
  if (!st) return null;
  var fichaRow = resolvePlayerFichaRow(fichaId);
  if (!fichaRow || !fichaRow.dados) return null;

  var d = fichaRow.dados;
  if (d.freeEdit === undefined) d.freeEdit = false;

  var rolledViaCylinder = false;
  if (
    st.playerFichaId &&
    String(st.playerFichaId) === String(fichaId) &&
    typeof OS.rollCylinderDice === "function" &&
    typeof document !== "undefined" &&
    document.querySelectorAll(".chamber-input").length > 0 &&
    (!OS.isCylinderEmpty || OS.isCylinderEmpty())
  ) {
    OS.rollCylinderDice();
    if (typeof OS.collectState === "function") {
      var collected = OS.collectState();
      Object.assign(d, collected);
      OS.activeCharacterState = d;
    }
    rolledViaCylinder = true;
  }

  if (!rolledViaCylinder) {
    var info6B = OS.getCreature6BDisplayInfo(d, { isPlayer: true });
    var diceList = info6B.diceList;
    var rawRolls = [];
    for (var c = 0; c < diceList.length; c++) {
      var dieStr = diceList[c] || "d6";
      var rolled = OS.generateDiceResult
        ? OS.generateDiceResult(dieStr)
        : Math.floor(Math.random() * (parseInt(dieStr.slice(1), 10) || 6)) + 1;
      rawRolls.push(parseInt(rolled, 10) || 0);
    }
    var fatigueLevel = countFadigaFromState(d);
    var fatigueRes = applyFatigueTo6BValues(rawRolls, fatigueLevel);
    var afterFatigue = fatigueRes.values || rawRolls;

    d.originalChambers = rawRolls.map(function (v) { return String(v); });
    for (var i = 0; i < diceList.length; i++) {
      d["chamber-" + i] = String(afterFatigue[i] !== undefined ? afterFatigue[i] : rawRolls[i]);
    }
    d.usedChambers = [];
    d.markedChambers = [];
    d.hasPerformedInitialReload = true;
  }

  OS.updatePlayerSheetStats(fichaId, {});
  return fichaRow;
};

OS.rollPlayerPopupAttack = function (fichaId, attackSpec, optSelectedChambers) {
  var st = OS.activeMesaState;
  if (!st) return null;
  var fichaRow = resolvePlayerFichaRow(fichaId);
  if (!fichaRow || !fichaRow.dados) return null;
  OS.getCreature6BDisplayInfo(fichaRow.dados, { isPlayer: true });
  var pseudoEntity = {
    id: fichaRow.id,
    name: fichaRow.dados.nome || fichaRow.nome_personagem || "Jogador",
    data: fichaRow.dados
  };
  return rollCreatureEntityAttack(
    pseudoEntity,
    attackSpec,
    optSelectedChambers,
    function () {
      OS.rollPlayerPopup6B(fichaId);
    },
    function () {
      OS.updatePlayerSheetStats(fichaId, {});
    }
  );
};

/**
 * Constrói o corpo de combate compartilhado entre .scene-creature-card (Em Cena)
 * e .mesa-floating-popup (ficha flutuante de criatura).
 * Lê e grava diretamente sobre a mesma referência de dados (target.data).
 */
OS.buildCreatureCombatCardBody = function (target, callbacks) {
  callbacks = callbacks || {};
  var d = (target && target.data) || {};
  OS.sanitizeCreature6BData(d);
  var info6B = OS.resolveCreature6BInfo(d);
  var chamberCount = info6B.count;
  var cfg6bText = info6B.cfgText;

  var fadigaCount = countFadigaFromState(d);
  var usedChambers = Array.isArray(d.usedChambers) ? d.usedChambers : [];
  var activeConds = Array.isArray(d.activeConditions) ? d.activeConditions : [];

  var chambersHtml = "";
  var compactChambersVals = [];
  for (var ci = 0; ci < chamberCount; ci++) {
    var cVal =
      d["chamber-" + ci] !== undefined && d["chamber-" + ci] !== ""
        ? d["chamber-" + ci]
        : "0";
    var isUsed = usedChambers.indexOf(ci) >= 0;
    if (!isUsed && String(cVal) !== "0" && !(OS.getRealDamagedChambers && OS.getRealDamagedChambers(d, chamberCount).includes(ci))) {
      compactChambersVals.push(String(cVal));
    }
    chambersHtml +=
      '<button type="button" class="scene-chamber-pill' +
      (isUsed ? " is-used" : "") +
      '" data-action="toggle-chamber" data-chamber="' +
      ci +
      '" title="Clique para marcar/desmarcar câmara ' +
      (ci + 1) +
      '">' +
      escHtml(cVal) +
      "</button>";
  }
  var compact6bSummary = compactChambersVals.length
    ? compactChambersVals.join(",")
    : cfg6bText;

  var condsHtml = "";
  if (!activeConds.length) {
    condsHtml = '<span class="scene-cond-empty">Sem condições</span>';
  } else {
    activeConds.forEach(function (c, cIdx) {
      var cLabel =
        typeof c === "string"
          ? c
          : (c && (c.nome || c.name || c.id)) || "Condição";
      var cDeg =
        typeof c === "object" && c && c.grau !== undefined && c.grau !== null
          ? " " + c.grau
          : "";
      condsHtml +=
        '<span class="scene-cond-tag" data-cond-index="' +
        cIdx +
        '">' +
        escHtml(cLabel + cDeg) +
        ' <button type="button" class="scene-cond-remove" data-action="remove-cond" data-cond-index="' +
        cIdx +
        '" aria-label="Remover condição">×</button></span>';
    });
  }

  var sceneAttacks = OS.getSceneCreatureAttacks(target);
  var ataquesHtml = sceneAttacks.length
    ? sceneAttacks
        .map(function (atk, atkIdx) {
          var rollBadgeHtml = atk.lastRollText
            ? '<span class="weapon-roll-result rolled" data-attack-key="' +
              escHtml(atk.key) +
              '">' +
              escHtml(atk.lastRollText) +
              "</span>"
            : '<span class="weapon-roll-result" data-attack-key="' +
              escHtml(atk.key) +
              '" hidden></span>';
          return (
            '<div class="scene-attack-line" data-attack-index="' +
            atkIdx +
            '" data-attack-key="' +
            escHtml(atk.key) +
            '">' +
            '  <div class="scene-attack-main">' +
            '    <span class="scene-attack-label">' +
            escHtml(atk.rawLine || atk.name) +
            "</span>" +
            '    <button type="button" class="btn btn-secondary btn-small scene-attack-roll-btn" data-action="roll-attack" data-attack-index="' +
            atkIdx +
            '" data-attack-key="' +
            escHtml(atk.key) +
            '" title="Rolar ' +
            escHtml(atk.name) +
            '">🎲 Rolar</button>' +
            "  </div>" +
            rollBadgeHtml +
            "</div>"
          );
        })
        .join("")
    : '<div class="scene-attack-empty">Sem ataques listados</div>';

  var bodyEl = document.createElement("div");
  bodyEl.className = "creature-combat-card-body";
  bodyEl.innerHTML =
    '<div class="scene-card-compact-summary">' +
    '  <span>Def: <strong>' +
    escHtml(d.defesa || "0") +
    "</strong></span>" +
    '  <span>Inic: <strong>' +
    escHtml(d.iniciativa || "0") +
    "</strong></span>" +
    '  <span>Fadiga: <strong>' +
    fadigaCount +
    "</strong></span>" +
    '  <span>6B: <strong>' +
    escHtml(compact6bSummary) +
    "</strong></span>" +
    "</div>" +
    '<div class="scene-card-stats-row">' +
    '  <label class="scene-stat-field">' +
    "    <span>Defesa</span>" +
    '    <input type="number" class="field-line scene-defesa-input" value="' +
    escHtml(d.defesa || "0") +
    '">' +
    "  </label>" +
    '  <label class="scene-stat-field">' +
    "    <span>Iniciativa</span>" +
    '    <input type="number" class="field-line scene-init-input" value="' +
    escHtml(d.iniciativa || "0") +
    '">' +
    "  </label>" +
    '  <div class="scene-stat-field">' +
    "    <span>Fadiga</span>" +
    '    <div class="scene-fadiga-controls">' +
    '      <button type="button" class="btn btn-secondary btn-small" data-action="fadiga-minus">-</button>' +
    '      <strong class="scene-fadiga-val">' +
    fadigaCount +
    "</strong>" +
    '      <button type="button" class="btn btn-secondary btn-small" data-action="fadiga-plus">+</button>' +
    "    </div>" +
    "  </div>" +
    "</div>" +
    '<div class="scene-card-6b-block">' +
    '  <div class="scene-card-6b-top">' +
    '    <span class="field-label">6B (' +
    escHtml(cfg6bText) +
    ")</span>" +
    '    <button type="button" class="btn btn-secondary btn-small" data-action="roll-6b">🎲 Rolar 6B</button>' +
    "  </div>" +
    '  <label class="field-label">Configuração 6B <input type="text" class="field-line scene-config-6b-input" aria-label="Configuração 6B" value="' + escHtml(cfg6bText) + '" placeholder="2d6" pattern="[1-9][0-9]*[dD](4|6|8|10|12)(\\s*\\+\\s*[1-9][0-9]*[dD](4|6|8|10|12))*" required></label>' +
    '  <button type="button" class="btn btn-secondary btn-small" data-action="save-6b-config">Salvar 6B</button>' +
    '  <div class="scene-chambers-row" data-chamber-count="' +
    chamberCount +
    '">' +
    chambersHtml +
    "</div>" +
    "</div>" +
    '<label class="field-label">Dano real (câmaras bloqueadas) <input type="number" class="field-line scene-damage-count" min="0" max="' + chamberCount + '" value="' + (OS.getRealDamagedChambers ? OS.getRealDamagedChambers(d, chamberCount).length : 0) + '"></label>' +
    '<button type="button" class="btn btn-secondary btn-small" data-action="save-damage">Aplicar dano / cura</button>' +
    '<div class="scene-card-conds-block">' +
    '  <div class="scene-conds-list">' +
    condsHtml +
    "</div>" +
    '  <div class="scene-cond-add-row">' +
    '    <input type="text" class="field-line scene-cond-input" placeholder="Adicionar condição (ex: Sangrando)">' +
    '    <button type="button" class="btn btn-secondary btn-small" data-action="add-cond">+</button>' +
    "  </div>" +
    "</div>" +
    '<div class="scene-card-attacks">' +
    ataquesHtml +
    "</div>" +
    (d.notas
      ? '<div class="scene-card-notes">' + escHtml(d.notas) + "</div>"
      : "") +
    '<footer class="scene-card-footer">' +
    '  <button type="button" class="btn btn-secondary btn-small btn-scene-open-sheet" data-action="open-sheet">Editar Ficha Completa</button>' +
    "</footer>";

  var defInp = bodyEl.querySelector(".scene-defesa-input");
  if (defInp && typeof callbacks.onUpdateStats === "function") {
    defInp.addEventListener("change", function () {
      callbacks.onUpdateStats({ defesa: defInp.value });
    });
  }
  var initInp = bodyEl.querySelector(".scene-init-input");
  if (initInp && typeof callbacks.onUpdateStats === "function") {
    initInp.addEventListener("change", function () {
      callbacks.onUpdateStats({ iniciativa: initInp.value });
    });
  }

  bodyEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var act = btn.getAttribute("data-action");
    if (act === "save-damage") {
      var damageInput = bodyEl.querySelector(".scene-damage-count");
      if (damageInput && damageInput.reportValidity() && callbacks.onUpdateStats) callbacks.onUpdateStats({ damageCount: damageInput.value });
    } else if (act === "save-6b-config") {
      var configInput = bodyEl.querySelector(".scene-config-6b-input");
      if (configInput && configInput.reportValidity() && typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ config6BText: configInput.value });
      }
    } else if (act === "fadiga-minus") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ fadiga: Math.max(0, fadigaCount - 1) });
      }
    } else if (act === "fadiga-plus") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ fadiga: Math.min(40, fadigaCount + 1) });
      }
    } else if (act === "roll-6b") {
      if (typeof callbacks.onRoll6B === "function") {
        callbacks.onRoll6B();
      }
    } else if (act === "toggle-chamber") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({
          toggleChamber: btn.getAttribute("data-chamber")
        });
      }
    } else if (act === "add-cond") {
      var cInp = bodyEl.querySelector(".scene-cond-input");
      if (cInp && cInp.value.trim() && typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({ addCondition: cInp.value.trim() });
      }
    } else if (act === "remove-cond") {
      if (typeof callbacks.onUpdateStats === "function") {
        callbacks.onUpdateStats({
          removeConditionIndex: parseInt(btn.getAttribute("data-cond-index"), 10)
        });
      }
    } else if (act === "roll-attack") {
      var atkIdx = parseInt(btn.getAttribute("data-attack-index"), 10);
      var atkKey = btn.getAttribute("data-attack-key");
      if (typeof callbacks.onRollAttack === "function") {
        callbacks.onRollAttack(!isNaN(atkIdx) ? atkIdx : atkKey);
      }
    } else if (act === "open-sheet") {
      if (typeof callbacks.onOpenSheet === "function") {
        callbacks.onOpenSheet();
      }
    }
  });

  return bodyEl;
};

function getCombatantModeBadgeMeta(opInfo) {
  if (!opInfo) return { cls: "is-unset", label: "Modo não definido" };
  if (opInfo.operationalMode === "creature_mode") {
    return { cls: "is-creature-mode", label: "Modo Criatura" };
  }
  if (opInfo.operationalMode === "full_sheet") {
    return { cls: "is-full-sheet", label: "Ficha Completa" };
  }
  return { cls: "is-unset", label: "Modo não definido" };
}

OS.renderMesaSceneCards = function () {
  var grid = OS.$("mesa-em-cena-list");
  if (!OS.activeMesaState || !OS.activeMesaState.isMestre) {
    if (grid) grid.innerHTML = "";
    return;
  }
  var badge = OS.$("mesa-em-cena-count-badge");
  var st = OS.activeMesaState;
  var creatures = (st && Array.isArray(st.sceneCreatures)) ? st.sceneCreatures : [];
  var allTokens = (st && Array.isArray(st.mesaTokens)) ? st.mesaTokens : [];
  if (st.activeMapId) {
    creatures = creatures.filter(function (c) {
      return allTokens.some(function (t) {
        return t.owner_type === "creature" && t.owner_ref === c.instanceId && t.mapa_id === st.activeMapId;
      });
    });
  }
  var playerTokens = allTokens.filter(function (t) {
    return t && t.owner_type === "player";
  });
  var totalCount = playerTokens.length + creatures.length;

  if (badge) {
    badge.textContent = totalCount + " em cena";
  }

  var toggleAllBtn = OS.$("btn-toggle-all-scene-cards");
  if (toggleAllBtn) {
    toggleAllBtn.setAttribute("hidden", "");
    toggleAllBtn.hidden = true;
  }

  if (!grid) return;

  grid.innerHTML = "";
  if (totalCount === 0) {
    grid.classList.add("is-empty");
    grid.innerHTML =
      '<p class="mesa-dropzone-placeholder">Nenhuma ficha ou criatura em cena. Use "Colocar em Cena" nas listas abaixo.</p>';
    return;
  }

  grid.classList.remove("is-empty");

  // 1) Jogadores em cena: tira compacta (.mesa-scene-card.mesa-compact-row.is-player-entity)
  playerTokens.forEach(function (pToken) {
    var fichaRow = (st.playerSheets || []).find(function (r) {
      return r && String(r.id) === String(pToken.owner_ref);
    });
    var d =
      fichaRow && fichaRow.dados && typeof fichaRow.dados === "object"
        ? fichaRow.dados
        : {};

    var charName =
      d.nome ||
      (fichaRow && fichaRow.nome_personagem) ||
      pToken.display_name ||
      "Personagem";
    var defesaVal =
      d.defesa !== undefined && d.defesa !== "" ? String(d.defesa) : "10";
    var initVal =
      d.iniciativa !== undefined && d.iniciativa !== ""
        ? String(d.iniciativa)
        : "0";
    var fadigaVal = fichaRow ? countFadigaFromState(d) : 0;
    var portraitUrl = d.retrato_url
      ? String(d.retrato_url).trim()
      : pToken.image_url
      ? String(pToken.image_url).trim()
      : "";

    var playerInfo6B = OS.getCreature6BDisplayInfo(d, { isPlayer: true });
    var vidaText = playerInfo6B.vidaText;
    var activeConds = Array.isArray(d.activeConditions) ? d.activeConditions : [];

    var pCard = document.createElement("article");
    pCard.className = "mesa-scene-card mesa-compact-row is-player-entity";
    pCard.dataset.fichaId = pToken.owner_ref;
    pCard.dataset.tokenId = pToken.id || "";

    var avatarHtml = portraitUrl
      ? '<div class="mesa-compact-avatar is-circular"><img src="' +
        escHtml(portraitUrl) +
        '" alt="Retrato de ' +
        escHtml(charName) +
        '"></div>'
      : '<div class="mesa-compact-avatar is-circular">🤠</div>';

    pCard.innerHTML =
      '<div class="mesa-compact-row-main">' +
      avatarHtml +
      '  <div class="mesa-compact-info">' +
      '    <div class="mesa-scene-title-row">' +
      '      <strong class="mesa-compact-title scene-player-name" title="' + escHtml(charName) + '">' +
      escHtml(charName) +
      '      </strong>' +
      '      <span class="mesa-entity-badge type-player">Jogador</span>' +
      '    </div>' +
      '    <div class="mesa-scene-badges-row">' +
      '      <span class="scene-badge badge-init" title="Iniciativa">⚡ ' + escHtml(initVal) + '</span>' +
      '      <span class="scene-badge badge-def" title="Defesa">🛡️ ' + escHtml(defesaVal) + '</span>' +
      '      <span class="scene-badge badge-health" title="Câmaras / Vida">❤️ ' + vidaText + '</span>' +
      (fadigaVal > 0 ? '      <span class="scene-badge badge-fadiga" title="Fadiga">💤 ' + fadigaVal + '</span>' : '') +
      (activeConds.length > 0 ? '      <span class="scene-badge badge-conds" title="Condições Ativas: ' + escHtml(activeConds.map(function(c){return typeof c === "string" ? c : c.nome;}).join(", ")) + '">⚠️ ' + activeConds.length + '</span>' : '') +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="mesa-compact-actions">' +
      '  <button type="button" class="btn btn-secondary btn-small btn-scene-open-sheet" data-action="open-popup" title="Abrir ficha flutuante (Popup)">⧉ Ficha</button>' +
      '  <button type="button" class="btn btn-secondary btn-small scene-player-remove-btn" data-action="remove-player-scene" title="Remover jogador de Em Cena">×</button>' +
      '</div>';

    var viewBtn = pCard.querySelector(".btn-scene-open-sheet");
    if (viewBtn) {
      viewBtn.addEventListener("click", function () {
        OS.openOrFocusPlayerPopup(pToken.owner_ref);
      });
    }
    var remBtn = pCard.querySelector(".scene-player-remove-btn");
    if (remBtn) {
      remBtn.addEventListener("click", function () {
        OS.removePlayerFromScene(pToken.owner_ref);
      });
    }

    var actionsEl = pCard.querySelector(".mesa-compact-actions");
    OS.appendTokenVisibilityButton(actionsEl, pToken);
    if (OS.appendCombatJoinButton) OS.appendCombatJoinButton(actionsEl, pToken);
    grid.appendChild(pCard);
  });

  // 2) Criaturas / NPCs em cena: tira compacta (.mesa-scene-card.mesa-compact-row.is-creature-entity)
  creatures.forEach(function (inst) {
    var d = inst.data || {};
    var norm = OS.normalizeLegacyNpcDataReadOnly ? OS.normalizeLegacyNpcDataReadOnly(inst) : null;
    var opInfo = norm ? norm.operationalInfo : OS.resolveCombatantOperationalInfo(inst);
    var modeMeta = getCombatantModeBadgeMeta(opInfo);
    var charName = inst.name || d.nome || "Criatura";
    var tipoEfetivo = norm ? norm.tipoFichaEfetivo : (d.tipo_ficha || "criatura");
    var tipoLabel = tipoEfetivo === "monstro" ? "Monstro" : (tipoEfetivo === "npc" ? "NPC" : "Criatura");
    var badgeClass = tipoEfetivo === "npc" ? "type-npc" : "type-creature";
    var defesaVal = d.defesa !== undefined && d.defesa !== "" ? String(d.defesa) : "10";
    var initVal = d.iniciativa !== undefined && d.iniciativa !== "" ? String(d.iniciativa) : "0";
    var fadigaVal = countFadigaFromState(norm ? norm.data : d);
    var portraitUrl = d.retrato_url ? String(d.retrato_url).trim() : "";

    var info6B = norm ? norm.sixBInfo : OS.getCreature6BDisplayInfo(d);
    var chamberCount = info6B.count;
    var damagedChambers = info6B.damagedChambers;
    var vidaText = info6B.vidaText;
    var activeConds = Array.isArray(d.condicoes) ? d.condicoes : (Array.isArray(d.activeConditions) ? d.activeConditions : []);

    var card = document.createElement("article");
    card.className = "mesa-scene-card scene-creature-card mesa-compact-row is-creature-entity";
    card.dataset.instanceId = inst.instanceId;
    card.dataset.operationalMode = opInfo.operationalMode || "unset";

    var avatarHtml = portraitUrl
      ? '<div class="mesa-compact-avatar is-circular"><img src="' +
        escHtml(portraitUrl) +
        '" alt="Retrato de ' +
        escHtml(charName) +
        '"></div>'
      : '<div class="mesa-compact-avatar is-circular">' + (tipoEfetivo === "npc" ? '👤' : '💀') + '</div>';

    card.innerHTML =
      '<div class="mesa-compact-row-main">' +
      avatarHtml +
      '  <div class="mesa-compact-info">' +
      '    <div class="mesa-scene-title-row">' +
      '      <strong class="mesa-compact-title scene-creature-name" title="' + escHtml(charName) + '">' +
      escHtml(charName) +
      '      </strong>' +
      '      <span class="mesa-entity-badge ' + badgeClass + '">' + escHtml(tipoLabel) + '</span>' +
      '      <span class="mesa-mode-badge ' + modeMeta.cls + '" title="Modalidade operacional em combate">' + escHtml(modeMeta.label) + '</span>' +
      '    </div>' +
      '    <div class="mesa-scene-badges-row">' +
      '      <span class="scene-badge badge-init" title="Iniciativa">⚡ ' + escHtml(initVal) + '</span>' +
      '      <span class="scene-badge badge-def" title="Defesa">🛡️ ' + escHtml(defesaVal) + '</span>' +
      '      <span class="scene-badge badge-health" title="Câmaras / Vida">❤️ ' + vidaText + '</span>' +
      (fadigaVal > 0 ? '      <span class="scene-badge badge-fadiga" title="Fadiga">💤 ' + fadigaVal + '</span>' : '') +
      (activeConds.length > 0 ? '      <span class="scene-badge badge-conds" title="Condições Ativas: ' + escHtml(activeConds.map(function(c){return typeof c === "string" ? c : (c.nome || c.name);}).join(", ")) + '">⚠️ ' + activeConds.length + '</span>' : '') +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="mesa-compact-actions">' +
      '  <button type="button" class="btn btn-secondary btn-small btn-scene-open-sheet" data-action="open-popup" title="Abrir ficha flutuante (Popup)">⧉ Ficha</button>' +
      '  <button type="button" class="btn btn-secondary btn-small scene-card-remove-btn" data-action="remove-scene" title="Remover da cena">×</button>' +
      '</div>';

    var cActionsEl = card.querySelector(".mesa-compact-actions");
    card.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var act = btn.getAttribute("data-action");
      if (act === "open-popup") {
        OS.openOrFocusCreaturePopup({
          from: "scene",
          instanceId: inst.instanceId
        });
      } else if (act === "remove-scene") {
        OS.removeCreatureFromScene(inst.instanceId);
      }
    });

    OS.appendTokenVisibilityButton(cActionsEl, OS.getSceneToken(inst.instanceId));
    if (OS.appendCombatJoinButton) OS.appendCombatJoinButton(cActionsEl, OS.getSceneToken(inst.instanceId));

    grid.appendChild(card);
  });
};

OS.toggleAllSceneCreatureCards = function () {
  var list = (OS.activeMesaState && OS.activeMesaState.sceneCreatures) || [];
  if (!list.length) return;
  var allCollapsed = list.every(function (c) {
    return c && c.collapsed === true;
  });
  var nextState = !allCollapsed;
  var nowIso = new Date().toISOString();
  list.forEach(function (c) {
    if (c) {
      c.collapsed = nextState;
      c.updatedAt = nowIso;
    }
  });
  OS.renderMesaSceneCards();
  OS.scheduleMesaSceneSave();
};

/* ─── 4d. Jogadores da Mesa (Visualização Somente Leitura pelo Mestre) ─── */

OS.loadMesaPlayersSheets = async function (mesaIdArg) {
  var mesaId =
    mesaIdArg || (OS.activeMesaState && OS.activeMesaState.mesaId);
  if (!mesaId) return [];

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) {
    OS.activeMesaState.playerSheets = [];
    OS.renderMesaPlayersCards();
    return [];
  }

  try {
    var res = await client
      .from("fichas")
      .select("*")
      .eq("mesa_id", mesaId)
      .order("updated_at", { ascending: false });

    var rows = (res && Array.isArray(res.data)) ? res.data : [];
    var filtered = rows.filter(function (row) {
      var d = row.dados && typeof row.dados === "object" ? row.dados : {};
      return !(
        d.isBestiaryCustom === true ||
        d.tipo_ficha === "npc" ||
        d.tipo_ficha === "monstro" ||
        row.classe === "npc" ||
        row.classe === "monstro"
      );
    });

    OS.activeMesaState.playerSheets = filtered;
    OS.renderMesaPlayersCards();
    if (OS.activeMesaState.isMestre && OS.renderMesaSceneCards) {
      OS.renderMesaSceneCards();
    }
    return filtered;
  } catch (err) {
    console.warn("[mesaScreen] Erro ao carregar fichas dos jogadores da mesa:", err);
    OS.activeMesaState.playerSheets = [];
    OS.renderMesaPlayersCards();
    return [];
  }
};

OS.renderMesaEmCenaPlaceholder = function () {
  var listEl = OS.$("mesa-em-cena-list");
  var badgeEl = OS.$("mesa-em-cena-count-badge");
  var toggleAllBtn = OS.$("btn-toggle-all-scene-cards");
  if (badgeEl) badgeEl.textContent = "0 em cena";
  if (toggleAllBtn) {
    toggleAllBtn.setAttribute("hidden", "");
    toggleAllBtn.hidden = true;
  }
  if (listEl) {
    listEl.classList.add("is-empty");
    listEl.innerHTML =
      '<p class="mesa-dropzone-placeholder">Nenhuma ficha ou criatura em cena. Use "Colocar em Cena" nas listas abaixo.</p>';
  }
};

OS.renderMesaPlayersCards = function () {
  var grid = OS.$("mesa-players-grid");
  var badge = OS.$("mesa-players-count-badge");
  var list = (OS.activeMesaState && OS.activeMesaState.playerSheets) || [];
  var tokens = (OS.activeMesaState && OS.activeMesaState.mesaTokens) || [];
  var inScenePlayerRefs = {};
  tokens.forEach(function (t) {
    if (t && t.owner_type === "player" && t.owner_ref) {
      inScenePlayerRefs[String(t.owner_ref)] = true;
    }
  });

  if (badge) {
    badge.textContent = list.length + " na mesa";
  }
  if (!grid) return;

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML =
      '<p class="mesa-compact-empty">Nenhuma ficha de jogador vinculada a esta mesa no momento.</p>';
    return;
  }

  list.forEach(function (row) {
    var d = row.dados && typeof row.dados === "object" ? row.dados : {};
    var isInScene = !!inScenePlayerRefs[String(row.id)];
    var card = document.createElement("article");
    card.className =
      "mesa-compact-row mesa-player-card" + (isInScene ? " is-in-scene" : "");
    card.dataset.fichaId = row.id;

    var charName =
      d.nome || row.nome_personagem || "Personagem sem nome";
    var charClass =
      row.classe || d.antecedente || d.alcunha || "Forasteiro";
    var charLevel =
      row.nivel !== undefined && row.nivel !== null
        ? row.nivel
        : d.nivel || 1;
    var defesaVal = d.defesa || "10";
    var initVal = d.iniciativa || "0";
    var portraitUrl = d.retrato_url ? String(d.retrato_url).trim() : "";

    var avatarHtml = portraitUrl
      ? '<div class="mesa-compact-avatar"><img src="' +
        escHtml(portraitUrl) +
        '" alt="Retrato de ' +
        escHtml(charName) +
        '"></div>'
      : '<div class="mesa-compact-avatar">🤠</div>';

    card.innerHTML =
      '<div class="mesa-compact-row-main">' +
      avatarHtml +
      '  <div class="mesa-compact-info">' +
      '    <strong class="mesa-compact-title mesa-player-name">' +
      escHtml(charName) +
      (isInScene
        ? ' <span class="mesa-in-scene-pill" title="Já está em cena">Em Cena</span>'
        : "") +
      "</strong>" +
      '    <span class="mesa-compact-meta mesa-player-sub">Nv ' +
      escHtml(charLevel) +
      " • " +
      escHtml(charClass) +
      " • Def " +
      escHtml(defesaVal) +
      " • Inic " +
      escHtml(initVal) +
      "</span>" +
      "  </div>" +
      "</div>" +
      '<div class="mesa-compact-actions mesa-player-actions">' +
      '  <button type="button" class="btn btn-secondary btn-small btn-player-scene-toggle" data-ficha-id="' +
      escHtml(row.id) +
      '">' +
      (isInScene ? "Remover de Cena" : "Colocar em Cena") +
      "</button>" +
      '  <button type="button" class="btn btn-secondary btn-small btn-view-player-sheet" data-ficha-id="' +
      escHtml(row.id) +
      '">Visualizar Ficha</button>' +
      "</div>";

    var sceneToggleBtn = card.querySelector(".btn-player-scene-toggle");
    if (sceneToggleBtn) {
      sceneToggleBtn.addEventListener("click", function () {
        if (isInScene) {
          OS.removePlayerFromScene(row.id);
        } else {
          OS.addPlayerToScene(row.id);
        }
      });
    }

    var viewBtn = card.querySelector(".btn-view-player-sheet");
    if (viewBtn) {
      viewBtn.addEventListener("click", function () {
        OS.openOrFocusPlayerPopup(row.id);
      });
    }

    grid.appendChild(card);
  });
};

/* ─── Lista 3 do Mestre: NPCs/Monstros na Mesa (mesas.npcs_mesa) ─── */

OS.saveMesaNpcsRemote = async function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) return false;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return false;
  var payload = deepClone(st.npcsMesa || []);
  if (st.mesa) st.mesa.npcs_mesa = payload;
  var res = await client
    .from("mesas")
    .update({ npcs_mesa: payload })
    .eq("id", st.mesaId);
  if (res && res.error) {
    console.error("[saveMesaNpcsRemote] Erro ao salvar npcs_mesa:", res.error);
    return false;
  }
  return true;
};

OS.getMesaNpcById = function (mesaNpcId) {
  var list = (OS.activeMesaState && OS.activeMesaState.npcsMesa) || [];
  return (
    list.find(function (item) {
      return item && item.mesaNpcId === mesaNpcId;
    }) || null
  );
};

OS.addBestiarioEntryToMesa = async function (sourceEntry) {
  if (!sourceEntry || !sourceEntry.data) return null;
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) return null;
  if (!Array.isArray(st.npcsMesa)) {
    st.npcsMesa = [];
  }

  var clonedData = deepClone(sourceEntry.data);
  clonedData.freeEdit = true;
  var wrapperModeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(sourceEntry)
    : null;
  if (
    wrapperModeChoice !== null &&
    OS.extractCreatureModeChoice &&
    OS.extractCreatureModeChoice(clonedData) === null
  ) {
    clonedData.isCriatura = wrapperModeChoice;
    clonedData["is-criatura"] = wrapperModeChoice;
    clonedData.operationalMode = wrapperModeChoice ? "creature_mode" : "full_sheet";
  }
  if (!Array.isArray(clonedData.usedChambers)) clonedData.usedChambers = [];
  if (!Array.isArray(clonedData.activeConditions)) clonedData.activeConditions = [];
  OS.sanitizeCreature6BData(clonedData);

  var baseName = String(clonedData.nome || sourceEntry.name || "Criatura")
    .replace(/\s+#\d+$/, "")
    .trim();

  var sameBase = st.npcsMesa.filter(function (c) {
    var cBase = String((c && (c.baseName || c.name)) || "")
      .replace(/\s+#\d+$/, "")
      .trim();
    return cBase.toLowerCase() === baseName.toLowerCase();
  });

  var displayName = baseName;
  if (sameBase.length >= 1) {
    if (sameBase.length === 1 && !/#\d+$/.test(sameBase[0].name)) {
      sameBase[0].name = baseName + " #1";
      if (sameBase[0].data) sameBase[0].data.nome = sameBase[0].name;
      sameBase[0].updatedAt = new Date().toISOString();
    }
    var maxNum = 0;
    sameBase.forEach(function (inst, idx) {
      var m = String(inst.name || "").match(/#(\d+)$/);
      var n = m ? parseInt(m[1], 10) : idx + 1;
      if (n > maxNum) maxNum = n;
    });
    displayName = baseName + " #" + (maxNum + 1);
  }

  clonedData.nome = displayName;
  var nowIso = new Date().toISOString();
  var npcModeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(clonedData)
    : null;
  var npcItem = {
    mesaNpcId: generateUid("mnpc"),
    baseName: baseName,
    name: displayName,
    sourceType: sourceEntry.sourceType || "oficial",
    sourceCategory: sourceEntry.sourceCategory || sourceEntry.category || null,
    sourceId: sourceEntry.id || null,
    isCriatura: npcModeChoice,
    operationalMode:
      npcModeChoice === true
        ? "creature_mode"
        : npcModeChoice === false
        ? "full_sheet"
        : null,
    updatedAt: nowIso,
    data: clonedData
  };

  st.npcsMesa.push(npcItem);
  OS.renderMesaNpcsList();
  await OS.saveMesaNpcsRemote();
  OS.closeBestiarioModal();
  if (st.activeSidebarTab !== "fichas") {
    OS.switchMesaSidebarTab("fichas");
  }
  return npcItem;
};

OS.removeMesaNpc = async function (mesaNpcId) {
  var st = OS.activeMesaState;
  if (!st || !st.isMestre || !Array.isArray(st.npcsMesa)) return;
  st.npcsMesa = st.npcsMesa.filter(function (item) {
    return item && item.mesaNpcId !== mesaNpcId;
  });
  if (Array.isArray(st.gmPopups) && st.gmPopups.length > 0) {
    var beforeLen = st.gmPopups.length;
    st.gmPopups = st.gmPopups.filter(function (p) {
      return !(
        p &&
        p.targetType === "mesa-npc" &&
        String(p.targetId) === String(mesaNpcId)
      );
    });
    if (st.gmPopups.length !== beforeLen && OS.saveGmPopupsStateLocal) {
      OS.saveGmPopupsStateLocal();
    }
  }
  OS.renderMesaNpcsList();
  if (OS.renderMesaFloatingPopups) {
    OS.renderMesaFloatingPopups();
  }
  await OS.saveMesaNpcsRemote();
};

OS.openMesaNpcFullSheet = function (mesaNpcId) {
  var item = OS.getMesaNpcById(mesaNpcId);
  if (!item || !item.data) return;
  OS.openSheetInGmWorkspace(item.data, {
    mode: "mesa-npc",
    mesaNpcId: item.mesaNpcId,
    tipoFicha: item.data.tipo_ficha || null,
    title: "Editando NPC/Monstro da Mesa: " + (item.name || "Criatura")
  });
};

OS.renderMesaNpcsList = function () {
  var listEl = OS.$("mesa-npcs-mesa-list");
  var badgeEl = OS.$("mesa-npcs-count-badge");
  var list = (OS.activeMesaState && OS.activeMesaState.npcsMesa) || [];

  if (badgeEl) {
    badgeEl.textContent = list.length + " na mesa";
  }
  if (!listEl) return;

  listEl.innerHTML = "";
  if (!list.length) {
    listEl.innerHTML =
      '<p class="mesa-compact-empty">Nenhum NPC ou monstro na mesa. Clique em "+" para adicionar.</p>';
    return;
  }

  list.forEach(function (item) {
    var d = (item && item.data) || {};
    var norm = OS.normalizeLegacyNpcDataReadOnly ? OS.normalizeLegacyNpcDataReadOnly(item) : null;
    var opInfo = norm ? norm.operationalInfo : OS.resolveCombatantOperationalInfo(item);
    var modeMeta = getCombatantModeBadgeMeta(opInfo);
    var info6B = norm ? norm.sixBInfo : OS.resolveCreature6BInfo(d);
    var row = document.createElement("article");
    row.className = "mesa-compact-row mesa-npc-row";
    row.dataset.mesaNpcId = item.mesaNpcId;
    row.dataset.operationalMode = opInfo.operationalMode || "unset";

    var npcName = item.name || d.nome || "Criatura";
    var defVal = d.defesa || "0";
    var initVal = d.iniciativa || "0";
    var cfg6b = info6B.cfgText;
    var portraitUrl = d.retrato_url ? String(d.retrato_url).trim() : "";

    var avatarHtml = portraitUrl
      ? '<div class="mesa-compact-avatar"><img src="' +
        escHtml(portraitUrl) +
        '" alt="Token de ' +
        escHtml(npcName) +
        '"></div>'
      : '<div class="mesa-compact-avatar">💀</div>';

    row.innerHTML =
      '<div class="mesa-compact-row-main">' +
      avatarHtml +
      '  <div class="mesa-compact-info">' +
      '    <strong class="mesa-compact-title">' +
      escHtml(npcName) +
      '      <span class="mesa-mode-badge ' + modeMeta.cls + '" title="Modalidade operacional em combate">' + escHtml(modeMeta.label) + '</span>' +
      "    </strong>" +
      '    <span class="mesa-compact-meta">Def ' +
      escHtml(defVal) +
      " • Inic " +
      escHtml(initVal) +
      " • 6B " +
      escHtml(cfg6b) +
      "</span>" +
      "  </div>" +
      "</div>" +
      '<div class="mesa-compact-actions">' +
      '  <button type="button" class="btn btn-secondary btn-small btn-npc-put-in-scene" data-mesa-npc-id="' +
      escHtml(item.mesaNpcId) +
      '">Colocar em Cena</button>' +
      '  <button type="button" class="btn btn-secondary btn-small btn-npc-create-popup" data-mesa-npc-id="' +
      escHtml(item.mesaNpcId) +
      '">Criar Popup</button>' +
      '  <button type="button" class="btn btn-secondary btn-small btn-edit-mesa-npc" data-mesa-npc-id="' +
      escHtml(item.mesaNpcId) +
      '">Editar Ficha</button>' +
      '  <button type="button" class="btn btn-secondary btn-small btn-remove-mesa-npc" data-mesa-npc-id="' +
      escHtml(item.mesaNpcId) +
      '" title="Remover da mesa">×</button>' +
      "</div>";

    var putSceneBtn = row.querySelector(".btn-npc-put-in-scene");
    if (putSceneBtn) {
      putSceneBtn.addEventListener("click", function () {
        OS.addNpcMesaToScene(item.mesaNpcId);
      });
    }
    var createPopupBtn = row.querySelector(".btn-npc-create-popup");
    if (createPopupBtn) {
      createPopupBtn.addEventListener("click", function () {
        OS.openOrFocusCreaturePopup({
          from: "mesa-npc",
          mesaNpcId: item.mesaNpcId
        });
      });
    }
    var editBtn = row.querySelector(".btn-edit-mesa-npc");
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        OS.openMesaNpcFullSheet(item.mesaNpcId);
      });
    }
    var delBtn = row.querySelector(".btn-remove-mesa-npc");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        OS.removeMesaNpc(item.mesaNpcId);
      });
    }

    listEl.appendChild(row);
  });
};

/* ─── Fichas Flutuantes de Criaturas (Popups) + Hub (#mesa-popups-hub) ─── */

OS.getGmPopupsStorageKey = function (userIdArg, mesaIdArg) {
  var st = OS.activeMesaState;
  var uid = userIdArg || (st && st.currentUserId) || "anon";
  var mid = mesaIdArg || (st && st.mesaId) || "none";
  return GM_POPUPS_LS_PREFIX + String(uid) + "_" + String(mid);
};

OS.clampPopupCoords = function (x, y, isMinimized) {
  var vw = Math.max(360, window.innerWidth || 1280);
  var vh = Math.max(300, window.innerHeight || 720);
  var boxW = isMinimized ? 230 : 340;
  var boxH = isMinimized ? 44 : 80;
  var minX = 8;
  var minY = 52;
  var maxX = Math.max(minX, vw - boxW - 8);
  var maxY = Math.max(minY, vh - boxH - 8);
  var nx = isNaN(Number(x)) ? 48 : Number(x);
  var ny = isNaN(Number(y)) ? 84 : Number(y);
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, nx))),
    y: Math.round(Math.max(minY, Math.min(maxY, ny)))
  };
};

function normalizeGmPopupsZOrder(popups) {
  if (!Array.isArray(popups) || !popups.length) return;
  var sorted = popups.slice().sort(function (a, b) {
    return (Number(a.zIndexOrder) || 0) - (Number(b.zIndexOrder) || 0);
  });
  sorted.forEach(function (p, idx) {
    // Mantém estritamente no intervalo 120..248 (abaixo do Hub em 250 e modais em 1000)
    p.zIndexOrder = Math.min(248, 120 + idx);
  });
}

OS.loadGmPopupsStateLocal = function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) {
    if (st) st.gmPopups = [];
    return [];
  }
  var key = OS.getGmPopupsStorageKey(st.currentUserId, st.mesaId);
  var loaded = [];
  try {
    var raw = localStorage.getItem(key);
    if (raw) {
      var parsed = JSON.parse(raw);
      var arr = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.popups)
        ? parsed.popups
        : [];
      arr.forEach(function (item, idx) {
        if (!item || !item.targetType || !item.targetId) return;
        var clamped = OS.clampPopupCoords(item.x, item.y, !!item.minimized);
        loaded.push({
          popupId: item.popupId || generateUid("gmpop"),
          targetType: item.targetType === "scene" ? "scene" : "mesa-npc",
          targetId: String(item.targetId),
          x: clamped.x,
          y: clamped.y,
          minimized: !!item.minimized,
          inHub: !!item.inHub,
          zIndexOrder: Number(item.zIndexOrder) || 120 + idx
        });
      });
    }
  } catch (e) {
    console.warn("[mesaScreen] Falha ao carregar gmPopups do localStorage:", e);
  }
  normalizeGmPopupsZOrder(loaded);
  st.gmPopups = loaded;
  return loaded;
};

OS.saveGmPopupsStateLocal = function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) return;
  var key = OS.getGmPopupsStorageKey(st.currentUserId, st.mesaId);
  var list = Array.isArray(st.gmPopups) ? st.gmPopups : [];
  normalizeGmPopupsZOrder(list);
  var serialized = list.map(function (p) {
    return {
      popupId: p.popupId,
      targetType: p.targetType,
      targetId: String(p.targetId),
      x: Math.round(Number(p.x) || 48),
      y: Math.round(Number(p.y) || 84),
      minimized: !!p.minimized,
      inHub: !!p.inHub,
      zIndexOrder: Number(p.zIndexOrder) || 120
    };
  });
  try {
    localStorage.setItem(key, JSON.stringify(serialized));
  } catch (e) {
    console.warn("[mesaScreen] Falha ao salvar gmPopups no localStorage:", e);
  }
};

OS.resolveGmPopupTarget = function (popupEntry) {
  if (!popupEntry || !popupEntry.targetType || !popupEntry.targetId) return null;
  var st = OS.activeMesaState;
  if (!st) return null;

  if (popupEntry.targetType === "player") {
    var fichaRow = resolvePlayerFichaRow(popupEntry.targetId);
    if (!fichaRow) return null;
    var d = fichaRow.dados && typeof fichaRow.dados === "object" ? fichaRow.dados : {};
    return {
      targetType: "player",
      targetId: String(fichaRow.id),
      entity: fichaRow,
      name: d.nome || fichaRow.nome_personagem || "Jogador",
      subtitle: "Jogador" + (d.classe ? " • " + d.classe : "") + (d.nivel ? " (Nv " + d.nivel + ")" : "")
    };
  }

  if (popupEntry.targetType === "scene") {
    var inst = OS.getSceneCreatureById(popupEntry.targetId);
    if (!inst || !inst.data) return null;
    return {
      targetType: "scene",
      targetId: inst.instanceId,
      entity: inst,
      name: inst.name || inst.data.nome || "Criatura",
      subtitle: inst.data.alcunha || ""
    };
  }

  if (popupEntry.targetType === "mesa-npc") {
    var npcItem = OS.getMesaNpcById(popupEntry.targetId);
    if (!npcItem || !npcItem.data) return null;
    return {
      targetType: "mesa-npc",
      targetId: npcItem.mesaNpcId,
      entity: npcItem,
      name: npcItem.name || npcItem.data.nome || "Criatura",
      subtitle: npcItem.data.alcunha || ""
    };
  }

  return null;
};

OS.bringGmPopupToFront = function (popupId) {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  var target = st.gmPopups.find(function (p) {
    return p && p.popupId === popupId;
  });
  if (!target) return;
  var maxZ = 120;
  st.gmPopups.forEach(function (p) {
    var z = Number(p && p.zIndexOrder) || 120;
    if (z > maxZ) maxZ = z;
  });
  target.zIndexOrder = maxZ + 1;
  normalizeGmPopupsZOrder(st.gmPopups);
  OS.saveGmPopupsStateLocal();

  var layer = OS.$("mesa-floating-popups-layer");
  if (layer) {
    st.gmPopups.forEach(function (p) {
      var domEl = layer.querySelector(
        '.mesa-floating-popup[data-popup-id="' + p.popupId + '"]'
      );
      if (domEl) {
        domEl.style.zIndex = String(p.zIndexOrder || 120);
      }
    });
  }
};

OS.openOrFocusCreaturePopup = function (spec) {
  spec = spec || {};
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return null;
  var isPlayerTarget = (spec.from === "player" || spec.targetType === "player");
  if (!st.isMestre && !isPlayerTarget) return null;
  if (!Array.isArray(st.gmPopups)) st.gmPopups = [];

  var resolvedType = null;
  var resolvedId = null;

  if (spec.from === "player" || spec.targetType === "player") {
    var fId = spec.fichaId || spec.targetId;
    if (!fId) return null;
    resolvedType = "player";
    resolvedId = String(fId);
  } else if (spec.from === "scene" || spec.targetType === "scene") {
    var instId = spec.instanceId || spec.targetId;
    var sceneInst = OS.getSceneCreatureById(instId);
    if (!sceneInst) return null;
    resolvedType = "scene";
    resolvedId = String(sceneInst.instanceId);
  } else if (spec.from === "mesa-npc" || spec.targetType === "mesa-npc") {
    var mId = spec.mesaNpcId || spec.targetId;
    var npcObj = OS.getMesaNpcById(mId);
    if (!npcObj) return null;

    var sceneMatches = (st.sceneCreatures || []).filter(function (c) {
      return c && String(c.sourceId) === String(mId);
    });

    if (sceneMatches.length === 1) {
      resolvedType = "scene";
      resolvedId = String(sceneMatches[0].instanceId);
      // Se já existia um popup "mesa-npc" para este mId, promove-o para a instância em cena
      var preNpcPopup = st.gmPopups.find(function (p) {
        return (
          p &&
          p.targetType === "mesa-npc" &&
          String(p.targetId) === String(mId)
        );
      });
      var alreadyScenePopup = st.gmPopups.find(function (p) {
        return (
          p &&
          p.targetType === "scene" &&
          String(p.targetId) === resolvedId
        );
      });
      if (preNpcPopup && !alreadyScenePopup) {
        preNpcPopup.targetType = "scene";
        preNpcPopup.targetId = resolvedId;
      }
    } else if (sceneMatches.length === 0) {
      resolvedType = "mesa-npc";
      resolvedId = String(npcObj.mesaNpcId);
    } else {
      // Múltiplas instâncias em cena (#1, #2...): foca/abre a primeira instância em cena
      resolvedType = "scene";
      resolvedId = String(sceneMatches[0].instanceId);
    }
  } else {
    return null;
  }

  var existing = st.gmPopups.find(function (p) {
    return (
      p &&
      p.targetType === resolvedType &&
      String(p.targetId) === String(resolvedId)
    );
  });

  if (existing) {
    existing.inHub = false;
    existing.minimized = false;
    var clampedEx = OS.clampPopupCoords(existing.x, existing.y, false);
    existing.x = clampedEx.x;
    existing.y = clampedEx.y;
    OS.bringGmPopupToFront(existing.popupId);
    OS.saveGmPopupsStateLocal();
    OS.renderMesaFloatingPopups();
    return existing;
  }

  var count = st.gmPopups.length;
  var baseLeft = 40 + (count % 5) * 32;
  var baseTop = 78 + (count % 5) * 28;
  var clampedNew = OS.clampPopupCoords(baseLeft, baseTop, false);

  var maxZ = 120;
  st.gmPopups.forEach(function (p) {
    var z = Number(p && p.zIndexOrder) || 120;
    if (z > maxZ) maxZ = z;
  });

  var created = {
    popupId: generateUid("gmpop"),
    targetType: resolvedType,
    targetId: resolvedId,
    x: clampedNew.x,
    y: clampedNew.y,
    minimized: false,
    inHub: false,
    zIndexOrder: Math.min(248, maxZ + 1)
  };

  st.gmPopups.push(created);
  normalizeGmPopupsZOrder(st.gmPopups);
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
  return created;
};

OS.openOrFocusPlayerPopup = function (fichaId) {
  return OS.openOrFocusCreaturePopup({ from: "player", fichaId: fichaId });
};

OS.closeGmPopup = function (popupId) {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  st.gmPopups = st.gmPopups.filter(function (p) {
    return p && p.popupId !== popupId;
  });
  if (!st.gmPopups.length) {
    st.gmPopupsHubExpanded = false;
  }
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.toggleMinimizeGmPopup = function (popupId) {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  var p = st.gmPopups.find(function (item) {
    return item && item.popupId === popupId;
  });
  if (!p) return;
  p.minimized = !p.minimized;
  var clamped = OS.clampPopupCoords(p.x, p.y, p.minimized);
  p.x = clamped.x;
  p.y = clamped.y;
  OS.bringGmPopupToFront(p.popupId);
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.sendGmPopupToHub = function (popupId) {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  var p = st.gmPopups.find(function (item) {
    return item && item.popupId === popupId;
  });
  if (!p) return;
  p.inHub = true;
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.toggleGmPopupFromHub = function (popupId) {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  var p = st.gmPopups.find(function (item) {
    return item && item.popupId === popupId;
  });
  if (!p) return;
  if (p.inHub) {
    p.inHub = false;
    p.minimized = false;
    var clamped = OS.clampPopupCoords(p.x, p.y, false);
    p.x = clamped.x;
    p.y = clamped.y;
    OS.bringGmPopupToFront(p.popupId);
  } else {
    p.inHub = true;
  }
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.collectAllGmPopupsToHub = function () {
  var st = OS.activeMesaState;
  if (!st || !Array.isArray(st.gmPopups)) return;
  st.gmPopups.forEach(function (p) {
    if (p) p.inHub = true;
  });
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.closeAllGmPopups = function () {
  var st = OS.activeMesaState;
  if (!st) return;
  st.gmPopups = [];
  st.gmPopupsHubExpanded = false;
  OS.saveGmPopupsStateLocal();
  OS.renderMesaFloatingPopups();
};

OS.clampAllGmPopupsToViewport = function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || (!st.isMestre && (!st.gmPopups || !st.gmPopups.length)) || !Array.isArray(st.gmPopups) || !st.gmPopups.length) {
    return;
  }
  var changed = false;
  var layer = OS.$("mesa-floating-popups-layer");
  st.gmPopups.forEach(function (p) {
    if (!p) return;
    var clamped = OS.clampPopupCoords(p.x, p.y, p.minimized);
    if (clamped.x !== p.x || clamped.y !== p.y) {
      p.x = clamped.x;
      p.y = clamped.y;
      changed = true;
      if (layer) {
        var el = layer.querySelector(
          '.mesa-floating-popup[data-popup-id="' + p.popupId + '"]'
        );
        if (el) {
          el.style.left = p.x + "px";
          el.style.top = p.y + "px";
        }
      }
    }
  });
  if (changed) {
    OS.saveGmPopupsStateLocal();
  }
};

function bindGmPopupHeaderDrag(popupEl, headerEl, popupState) {
  if (!popupEl || !headerEl || !popupState) return;
  var dragCtx = null;

  headerEl.addEventListener("pointerdown", function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (ev.target && ev.target.closest("button")) return;

    OS.bringGmPopupToFront(popupState.popupId);
    ev.preventDefault();

    dragCtx = {
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origX: Number(popupState.x) || 48,
      origY: Number(popupState.y) || 84
    };
    popupEl.classList.add("is-dragging-popup");
    if (headerEl.setPointerCapture) {
      try {
        headerEl.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
  });

  headerEl.addEventListener("pointermove", function (ev) {
    if (!dragCtx || ev.pointerId !== dragCtx.pointerId) return;
    ev.preventDefault();
    var dx = ev.clientX - dragCtx.startClientX;
    var dy = ev.clientY - dragCtx.startClientY;
    var clamped = OS.clampPopupCoords(
      dragCtx.origX + dx,
      dragCtx.origY + dy,
      popupState.minimized
    );
    popupState.x = clamped.x;
    popupState.y = clamped.y;
    popupEl.style.left = clamped.x + "px";
    popupEl.style.top = clamped.y + "px";
  });

  function finishDrag(ev) {
    if (!dragCtx || (ev && ev.pointerId !== dragCtx.pointerId)) return;
    if (headerEl.releasePointerCapture && dragCtx.pointerId !== undefined) {
      try {
        headerEl.releasePointerCapture(dragCtx.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    dragCtx = null;
    popupEl.classList.remove("is-dragging-popup");
    OS.saveGmPopupsStateLocal();
  }

  headerEl.addEventListener("pointerup", finishDrag);
  headerEl.addEventListener("pointercancel", finishDrag);
}

OS.renderMesaFloatingPopups = function () {
  var layer = OS.$("mesa-floating-popups-layer");
  var st = OS.activeMesaState;
  if (!layer) return;

  if (!st || !st.mesaId || (!st.isMestre && (!st.gmPopups || !st.gmPopups.length))) {
    layer.innerHTML = "";
    layer.setAttribute("hidden", "");
    layer.hidden = true;
    OS.renderMesaPopupsHub();
    return;
  }

  if (!Array.isArray(st.gmPopups)) {
    st.gmPopups = [];
  }

  // Filtra popups órfãos cujas criaturas não existem mais
  var validPopups = [];
  var pruned = false;
  st.gmPopups.forEach(function (p) {
    var resolved = OS.resolveGmPopupTarget(p);
    if (resolved) {
      validPopups.push(p);
    } else {
      pruned = true;
    }
  });
  if (pruned) {
    st.gmPopups = validPopups;
    OS.saveGmPopupsStateLocal();
  }

  normalizeGmPopupsZOrder(st.gmPopups);

  var visibleOnScreen = st.gmPopups.filter(function (p) {
    return p && !p.inHub;
  });

  layer.innerHTML = "";
  if (!visibleOnScreen.length) {
    layer.setAttribute("hidden", "");
    layer.hidden = true;
  } else {
    layer.removeAttribute("hidden");
    layer.hidden = false;
  }

  visibleOnScreen.forEach(function (p) {
    var resolved = OS.resolveGmPopupTarget(p);
    if (!resolved) return;

    var clamped = OS.clampPopupCoords(p.x, p.y, p.minimized);
    p.x = clamped.x;
    p.y = clamped.y;

    var popupEl = document.createElement("section");
    popupEl.className =
      "mesa-floating-popup" + (p.minimized ? " is-minimized" : "");
    popupEl.dataset.popupId = p.popupId;
    popupEl.dataset.targetType = p.targetType;
    popupEl.dataset.targetId = p.targetId;
    popupEl.style.left = p.x + "px";
    popupEl.style.top = p.y + "px";
    popupEl.style.zIndex = String(p.zIndexOrder || 120);

    popupEl.addEventListener("pointerdown", function () {
      OS.bringGmPopupToFront(p.popupId);
    });

    var headerEl = document.createElement("header");
    headerEl.className = "mesa-floating-popup-header";
    var badgeLabel =
      p.targetType === "scene" ? "Em Cena" : (p.targetType === "player" ? "Jogador" : "NPC da Mesa");
    headerEl.innerHTML =
      '<div class="mesa-floating-popup-title-wrap">' +
      '  <strong class="mesa-floating-popup-title" title="' +
      escHtml(resolved.name) +
      '">' +
      escHtml(resolved.name) +
      "</strong>" +
      '  <span class="mesa-floating-popup-badge">' +
      escHtml(badgeLabel) +
      "</span>" +
      "</div>" +
      '<div class="mesa-floating-popup-controls">' +
      '  <button type="button" class="btn btn-secondary btn-small popup-ctrl-btn" data-popup-action="minimize" title="' +
      (p.minimized ? "Restaurar popup" : "Minimizar popup") +
      '">' +
      (p.minimized ? "▢" : "—") +
      "</button>" +
      '  <button type="button" class="btn btn-secondary btn-small popup-ctrl-btn" data-popup-action="to-hub" title="Recolher para o Hub">📥</button>' +
      '  <button type="button" class="btn btn-secondary btn-small popup-ctrl-btn popup-close-btn" data-popup-action="close" title="Fechar popup">×</button>' +
      "</div>";

    headerEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-popup-action]");
      if (!btn) return;
      ev.stopPropagation();
      var act = btn.getAttribute("data-popup-action");
      if (act === "minimize") {
        OS.toggleMinimizeGmPopup(p.popupId);
      } else if (act === "to-hub") {
        OS.sendGmPopupToHub(p.popupId);
      } else if (act === "close") {
        OS.closeGmPopup(p.popupId);
      }
    });

    var sceneToken = p.targetType === "scene"
      ? OS.getSceneToken(p.targetId)
      : (p.targetType === "player" ? OS.getPlayerSceneToken(p.targetId) : null);
    OS.appendTokenVisibilityButton(headerEl.querySelector(".mesa-floating-popup-controls"), sceneToken);
    bindGmPopupHeaderDrag(popupEl, headerEl, p);
    popupEl.appendChild(headerEl);

    if (!p.minimized) {
      var contentWrap = document.createElement("div");
      contentWrap.className = "mesa-floating-popup-body";

      var bodyEl;
      if (p.targetType === "player") {
        bodyEl = OS.buildPlayerCombatCardBody(resolved.entity, {
          onUpdateStats: function (changes) {
            OS.updatePlayerSheetStats(p.targetId, changes);
          },
          onRoll6B: function () {
            OS.rollPlayerPopup6B(p.targetId);
          },
          onRollAttack: function (atkSpec) {
            OS.rollPlayerPopupAttack(p.targetId, atkSpec);
          },
          onOpenFullSheet: function () {
            if (st.isMestre) {
              OS.openPlayerSheetReadOnlyForGm(resolved.entity);
            } else if (st.playerFichaId && String(st.playerFichaId) === String(p.targetId)) {
              OS.switchMesaSidebarTab("fichas");
            }
          }
        });
      } else {
        bodyEl = OS.buildCreatureCombatCardBody(resolved.entity, {
          onUpdateStats: function (changes) {
            if (p.targetType === "scene") {
              OS.updateSceneCreatureStats(p.targetId, changes);
            } else {
              OS.updateMesaNpcStats(p.targetId, changes);
            }
          },
          onRoll6B: function () {
            if (p.targetType === "scene") {
              OS.rollSceneCreature6B(p.targetId);
            } else {
              OS.rollMesaNpc6B(p.targetId);
            }
          },
          onRollAttack: function (atkSpec) {
            if (p.targetType === "scene") {
              OS.rollSceneCreatureAttack(p.targetId, atkSpec);
            } else {
              OS.rollMesaNpcAttack(p.targetId, atkSpec);
            }
          },
          onOpenSheet: function () {
            if (p.targetType === "scene") {
              OS.openSceneCreatureFullSheet(p.targetId);
            } else {
              OS.openMesaNpcFullSheet(p.targetId);
            }
          }
        });
      }

      contentWrap.appendChild(bodyEl);
      popupEl.appendChild(contentWrap);
    }

    layer.appendChild(popupEl);
  });

  OS.renderMesaPopupsHub();
};

OS.renderMesaPopupsHub = function () {
  var hubEl = OS.$("mesa-popups-hub");
  var st = OS.activeMesaState;
  if (!hubEl) return;

  if (
    !st ||
    !st.mesaId ||
    (!st.isMestre && (!st.gmPopups || !st.gmPopups.length)) ||
    !Array.isArray(st.gmPopups) ||
    st.gmPopups.length === 0
  ) {
    hubEl.innerHTML = "";
    hubEl.setAttribute("hidden", "");
    hubEl.hidden = true;
    return;
  }

  hubEl.removeAttribute("hidden");
  hubEl.hidden = false;

  var totalCount = st.gmPopups.length;
  var isExpanded = !!st.gmPopupsHubExpanded;

  var itemsHtml = st.gmPopups
    .map(function (p) {
      var resolved = OS.resolveGmPopupTarget(p);
      var title = resolved ? resolved.name : "Criatura";
      var stateText = p.inHub
        ? "No Hub"
        : p.minimized
        ? "Minimizado"
        : "Na Tela";
      var stateClass = p.inHub
        ? "is-in-hub"
        : p.minimized
        ? "is-minimized"
        : "is-open";
      return (
        '<div class="mesa-popups-hub-item ' +
        stateClass +
        '" data-popup-id="' +
        escHtml(p.popupId) +
        '">' +
        '  <button type="button" class="mesa-popups-hub-item-main" data-hub-action="toggle-item" data-popup-id="' +
        escHtml(p.popupId) +
        '" title="Clique para abrir/trazer para frente ou recolher para o Hub">' +
        '    <span class="mesa-popups-hub-item-name">' +
        escHtml(title) +
        "</span>" +
        '    <span class="mesa-popups-hub-item-state">' +
        escHtml(stateText) +
        "</span>" +
        "  </button>" +
        '  <button type="button" class="btn btn-secondary btn-small mesa-popups-hub-item-close" data-hub-action="close-item" data-popup-id="' +
        escHtml(p.popupId) +
        '" title="Fechar este popup">×</button>' +
        "</div>"
      );
    })
    .join("");

  hubEl.innerHTML =
    (isExpanded
      ? '<div class="mesa-popups-hub-panel">' +
        '  <div class="mesa-popups-hub-panel-header">' +
        "    <strong>Popups da Mesa (" +
        totalCount +
        ")</strong>" +
        '    <div class="mesa-popups-hub-bulk-actions">' +
        '      <button type="button" class="btn btn-secondary btn-small" data-hub-action="collect-all">Recolher Todos</button>' +
        '      <button type="button" class="btn btn-secondary btn-small" data-hub-action="close-all">Fechar Todos</button>' +
        "    </div>" +
        "  </div>" +
        '  <div class="mesa-popups-hub-list">' +
        itemsHtml +
        "  </div>" +
        "</div>"
      : "") +
    '<button type="button" class="btn btn-secondary mesa-popups-hub-trigger" data-hub-action="toggle-hub">' +
    "  🗂 Popups (" +
    totalCount +
    ")" +
    "</button>";

  hubEl.onclick = function (ev) {
    var btn = ev.target.closest("[data-hub-action]");
    if (!btn) return;
    ev.stopPropagation();
    var act = btn.getAttribute("data-hub-action");
    var pid = btn.getAttribute("data-popup-id");
    if (act === "toggle-hub") {
      st.gmPopupsHubExpanded = !st.gmPopupsHubExpanded;
      OS.renderMesaPopupsHub();
    } else if (act === "toggle-item" && pid) {
      OS.toggleGmPopupFromHub(pid);
    } else if (act === "close-item" && pid) {
      OS.closeGmPopup(pid);
    } else if (act === "collect-all") {
      OS.collectAllGmPopupsToHub();
    } else if (act === "close-all") {
      OS.closeAllGmPopups();
    }
  };
};

OS.openPlayerSheetReadOnlyForGm = function (fichaRow) {
  if (!fichaRow) return;
  var d =
    fichaRow.dados && typeof fichaRow.dados === "object"
      ? deepClone(fichaRow.dados)
      : {};
  var charName = d.nome || fichaRow.nome_personagem || "Jogador";

  OS.activeMesaState.gmEditingSheet = {
    mode: "player-readonly",
    fichaId: fichaRow.id,
    title: "Visualizando Ficha (Somente Leitura): " + charName
  };

  OS.activeCharacterFilename = null;
  OS.activeCharacterName = null;
  if (OS.setFreeEditMode) OS.setFreeEditMode(false);
  OS.clearForm({ freeEdit: false });

  d.freeEdit = false;
  OS.applyState(d, { readOnlyMode: true });
  if (fichaRow.nome_personagem && !d.nome) {
    var nEl = OS.$("nome");
    if (nEl) nEl.value = fichaRow.nome_personagem;
  }
  OS.initCylinder();
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(true);

  OS.switchMesaSidebarTab("fichas");

  var gmListsView = OS.$("mesa-gm-lists-view");
  var sheetSlot = OS.$("mesa-sheet-slot");
  var gmSheetBar = OS.$("mesa-gm-sheet-bar");
  var gmPortraitWrap = OS.$("gm-bar-portrait-wrap");
  var ctxLabel = OS.$("mesa-gm-sheet-context-label");
  var btnFechar = OS.$("btn-mesa-fechar-ficha");

  if (gmListsView) {
    gmListsView.setAttribute("hidden", "");
    gmListsView.hidden = true;
  }
  if (gmPortraitWrap) {
    gmPortraitWrap.setAttribute("hidden", "");
    gmPortraitWrap.hidden = true;
  }
  if (sheetSlot) {
    sheetSlot.removeAttribute("hidden");
    sheetSlot.hidden = false;
  }
  if (gmSheetBar) {
    gmSheetBar.removeAttribute("hidden");
    gmSheetBar.hidden = false;
  }
  if (ctxLabel) {
    ctxLabel.textContent = OS.activeMesaState.gmEditingSheet.title;
  }
  if (btnFechar) {
    btnFechar.textContent = "← Voltar às Listas";
  }

  moveFichaIntoMesaSlot();
  OS.showSheetScreen({ insideMesa: true, readOnlyMode: true });
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(true);
};

/* ─── Reaproveitamento do <article id="ficha"> em Modo FreeEdit pelo Mestre ─── */

OS.openSheetInGmWorkspace = function (stateData, contextMeta) {
  contextMeta = contextMeta || {};
  if (OS.activeMesaState && OS.activeMesaState.mesaId && !OS.activeMesaState.isMestre) {
    return null;
  }
  OS.closeBestiarioModal();
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);

  var isInsideMesa = !!(
    OS.activeMesaState &&
    OS.activeMesaState.mesaId &&
    OS.activeMesaState.isMestre
  );
  var freshSuffix =
    "npc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  OS.activeMesaState.gmEditingSheet = {
    mode: contextMeta.mode || "custom", // "custom" | "mesa-npc" | "scene"
    customId: contextMeta.customId || null,
    mesaNpcId: contextMeta.mesaNpcId || null,
    instanceId: contextMeta.instanceId || null,
    _uploadSuffix: freshSuffix,
    isNewCustomNpc: !!contextMeta.isNewCustomNpc,
    tipoFicha: contextMeta.tipoFicha !== undefined ? contextMeta.tipoFicha : null,
    title: contextMeta.title || "Modo Edição Livre — Criatura / NPC"
  };

  OS.activeCharacterFilename = null;
  OS.activeCharacterName = null;
  OS.clearForm({ freeEdit: true });
  OS._freeEditUploadSuffix = freshSuffix;
  OS.setFreeEditMode(true);
  OS.activeSheetTipo =
    stateData && Object.keys(stateData).length > 0
      ? stateData.tipo_ficha || contextMeta.tipoFicha || null
      : contextMeta.tipoFicha || "npc";
  OS.isBestiaryCustom = contextMeta.mode === "custom" || !contextMeta.mode;

  if (stateData && Object.keys(stateData).length > 0) {
    var cloned = deepClone(stateData);
    cloned.freeEdit = true;
    OS.sanitizeCreature6BData(cloned);
    OS.applyState(cloned, { readOnlyMode: false });
    OS.setFreeEditMode(true);
  } else {
    OS._loadedHasTipoFicha = !!OS.activeSheetTipo;
    var initMode =
      contextMeta.initialCriaturaMode !== undefined
        ? contextMeta.initialCriaturaMode
        : false;
    if (OS.setCriaturaMode) {
      OS.setCriaturaMode(initMode, true);
    } else {
      OS.isCriatura = initMode;
    }
  }
  if (OS.renderPortraitPreview) {
    OS.renderPortraitPreview(OS.characterPortraitUrl || "");
  }

  if (isInsideMesa) {
    OS.switchMesaSidebarTab("fichas");
    var gmListsView = OS.$("mesa-gm-lists-view");
    var sheetSlot = OS.$("mesa-sheet-slot");
    var gmSheetBar = OS.$("mesa-gm-sheet-bar");
    var gmPortraitWrap = OS.$("gm-bar-portrait-wrap");
    var ctxLabel = OS.$("mesa-gm-sheet-context-label");
    var btnFechar = OS.$("btn-mesa-fechar-ficha");
    if (gmListsView) {
      gmListsView.setAttribute("hidden", "");
      gmListsView.hidden = true;
    }
    if (gmPortraitWrap) {
      gmPortraitWrap.removeAttribute("hidden");
      gmPortraitWrap.hidden = false;
    }
    if (sheetSlot) {
      sheetSlot.removeAttribute("hidden");
      sheetSlot.hidden = false;
    }
    if (gmSheetBar) {
      gmSheetBar.removeAttribute("hidden");
      gmSheetBar.hidden = false;
    }
    if (ctxLabel) {
      ctxLabel.textContent = OS.activeMesaState.gmEditingSheet.title;
    }
    if (btnFechar) {
      btnFechar.textContent = "← Salvar e Voltar às Listas";
    }
    moveFichaIntoMesaSlot();
    OS.showSheetScreen({ insideMesa: true, readOnlyMode: false });
  } else {
    OS.showSheetScreen({ insideMesa: false, readOnlyMode: false });
  }
};

/**
 * Abre #ficha em branco com freeEdit=true para criar um NPC/Monstro do zero (Item 1.1 e Item 5).
 * Não chama openInitialSkillsModal, não força nível 1 nem dinheiro $10.
 */
OS.startCreateCustomNpc = function () {
  OS.openSheetInGmWorkspace(
    {},
    {
      mode: "custom",
      customId: null,
      isNewCustomNpc: true,
      initialCriaturaMode: false,
      tipoFicha: "npc",
      title: "Criar Novo NPC / Monstro (Edição Livre)"
    }
  );
};

OS.openSceneCreatureFullSheet = function (instanceId) {
  var inst = OS.getSceneCreatureById(instanceId);
  if (!inst) return;
  OS.openSheetInGmWorkspace(inst.data, {
    mode: "scene",
    instanceId: inst.instanceId,
    tipoFicha: inst.data.tipo_ficha || null,
    title: "Editando Criatura em Cena: " + (inst.name || "Criatura")
  });
};

var gmSheetSaveChain = Promise.resolve();

OS.saveActiveGmEditedSheet = function (stateArg) {
  var editCtx = OS.activeMesaState && OS.activeMesaState.gmEditingSheet;
  if (!editCtx || editCtx.mode === "player-readonly" || OS.isReadOnlySheet) {
    return Promise.resolve(null);
  }
  if (OS.activeMesaState && OS.activeMesaState.mesaId && !OS.activeMesaState.isMestre) {
    return Promise.resolve(null);
  }
  var capturedState = stateArg ? deepClone(stateArg) : OS.collectState();

  gmSheetSaveChain = gmSheetSaveChain
    .catch(function () {})
    .then(async function () {
      var state = deepClone(capturedState);
      state.freeEdit = true;
      OS.sanitizeCreature6BData(state);
      var editedModeChoice = OS.extractCreatureModeChoice
        ? OS.extractCreatureModeChoice(state)
        : null;

      if (editCtx.mode === "mesa-npc" && editCtx.mesaNpcId) {
        var npcItem = OS.getMesaNpcById(editCtx.mesaNpcId);
        if (npcItem) {
          npcItem.data = deepClone(state);
          npcItem.isCriatura = editedModeChoice;
          npcItem.operationalMode =
            editedModeChoice === true
              ? "creature_mode"
              : editedModeChoice === false
              ? "full_sheet"
              : null;
          if (state.nome) npcItem.name = state.nome;
          npcItem.updatedAt = new Date().toISOString();
          OS.renderMesaNpcsList();
          if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
          await OS.saveMesaNpcsRemote();
          return npcItem;
        }
        return null;
      }

      if (editCtx.mode === "scene" && editCtx.instanceId) {
        var inst = OS.getSceneCreatureById(editCtx.instanceId);
        if (inst) {
          var prevSceneRolls =
            inst.data &&
            inst.data.sceneAttackRolls &&
            typeof inst.data.sceneAttackRolls === "object"
              ? deepClone(inst.data.sceneAttackRolls)
              : {};
          inst.data = deepClone(state);
          inst.isCriatura = editedModeChoice;
          inst.operationalMode =
            editedModeChoice === true
              ? "creature_mode"
              : editedModeChoice === false
              ? "full_sheet"
              : null;
          if (state.skillRollResults && typeof state.skillRollResults === "object") {
            Object.keys(state.skillRollResults).forEach(function (rk) {
              if (rk.indexOf("natural-") === 0) {
                prevSceneRolls[rk] = state.skillRollResults[rk];
              }
            });
          }
          inst.data.sceneAttackRolls = prevSceneRolls;
          if (state.nome) inst.name = state.nome;
          inst.updatedAt = new Date().toISOString();

          await OS.syncSceneTokenInitiative(inst);

          // Sincroniza nome/imagem no token correspondente em mesa_tokens, se houver
          var stMesa = OS.activeMesaState;
          if (stMesa && stMesa.mesaId && Array.isArray(stMesa.mesaTokens)) {
            var cTok = stMesa.mesaTokens.find(function (t) {
              return (
                t &&
                t.owner_type === "creature" &&
                String(t.owner_ref) === String(inst.instanceId)
              );
            });
            if (cTok) {
              var nextDisp = String(inst.name || state.nome || "Criatura").slice(0, 100);
              var nextImg = state.retrato_url
                ? String(state.retrato_url).trim()
                : null;
              if (cTok.display_name !== nextDisp || (cTok.image_url || null) !== nextImg) {
                cTok.display_name = nextDisp;
                cTok.image_url = nextImg;
                var clientTok = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
                if (clientTok) {
                  await clientTok
                    .from("mesa_tokens")
                    .update({
                      display_name: nextDisp,
                      image_url: nextImg,
                      updated_at: new Date().toISOString()
                    })
                    .eq("id", cTok.id)
                    .eq("mesa_id", stMesa.mesaId);
                }
                OS.renderMesaMapTokens();
              }
            }
          }

          OS.renderMesaSceneCards();
          if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
          OS.scheduleMesaSceneSave();
          return inst;
        }
        return null;
      }

      // mode === "custom"
      state.isBestiaryCustom = true;
      var targetTipo = state.tipo_ficha || editCtx.tipoFicha || null;
      if (targetTipo && !state.tipo_ficha) {
        state.tipo_ficha = targetTipo;
      }
      var savedRow = await OS.saveCustomNpcToSupabase(
        state,
        editCtx.customId,
        targetTipo
      );
      if (savedRow && savedRow.id) {
        editCtx.customId = savedRow.id;
      }
      return savedRow;
    });

  return gmSheetSaveChain;
};

OS.closeMesaSheetEditor = async function () {
  var editCtx = OS.activeMesaState && OS.activeMesaState.gmEditingSheet;
  if (editCtx && editCtx.mode !== "player-readonly" && !OS.isReadOnlySheet) {
    await OS.saveActiveGmEditedSheet();
  }
  OS.activeMesaState.gmEditingSheet = null;
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
  OS.setFreeEditMode(false);

  var btnFechar = OS.$("btn-mesa-fechar-ficha");
  if (btnFechar) {
    btnFechar.textContent = "← Salvar e Voltar às Listas";
  }

  var fichaEl = OS.$("ficha");
  var toolbarEl = document.querySelector(".toolbar");
  if (fichaEl) fichaEl.style.display = "none";
  if (toolbarEl) toolbarEl.style.display = "none";

  var gmListsView = OS.$("mesa-gm-lists-view");
  var sheetSlot = OS.$("mesa-sheet-slot");
  var gmSheetBar = OS.$("mesa-gm-sheet-bar");
  if (sheetSlot) {
    sheetSlot.setAttribute("hidden", "");
    sheetSlot.hidden = true;
  }
  if (gmSheetBar) {
    gmSheetBar.setAttribute("hidden", "");
    gmSheetBar.hidden = true;
  }
  if (gmListsView) {
    gmListsView.removeAttribute("hidden");
    gmListsView.hidden = false;
  }

  OS.renderMesaNpcsList();
  OS.renderMesaPlayersCards();
};

OS.onStandaloneFreeEditClosed = async function () {
  if (OS.activeMesaState && OS.activeMesaState.gmEditingSheet) {
    if (
      OS.activeMesaState.gmEditingSheet.mode !== "player-readonly" &&
      !OS.isReadOnlySheet
    ) {
      await OS.saveActiveGmEditedSheet();
    }
    OS.activeMesaState.gmEditingSheet = null;
  }
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
};

// Hook chamado automaticamente em OS.saveToStorage()
OS.onSheetSavedHook = async function (state) {
  if (OS.isReadOnlySheet) return;
  if (OS.activeMesaState && OS.activeMesaState.gmEditingSheet) {
    if (OS.activeMesaState.gmEditingSheet.mode !== "player-readonly") {
      await OS.saveActiveGmEditedSheet(state);
    }
  } else if (
    OS.activeMesaState &&
    OS.activeMesaState.mesaId &&
    !OS.activeMesaState.isMestre &&
    (OS.activeMesaState.playerFichaId || OS.activeMesaState._pendingPlayerSheetUpsert)
  ) {
    await OS.saveActivePlayerMesaSheet(state);
  } else if (state && !state.freeEdit && state.nome) {
    // Quando o jogador salva sua ficha na Home (ex: após upload de retrato),
    // sincroniza também com a linha correspondente em public.fichas (se houver)
    var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
    var uid = await OS.getCurrentUserId();
    if (client && uid) {
      try {
        var q = client
          .from("fichas")
          .select("id, mesa_id")
          .eq("usuario_id", uid)
          .eq("nome_personagem", state.nome)
          .limit(1);
        var res = await q;
        if (res && Array.isArray(res.data) && res.data.length) {
          var row = res.data[0];
          var copyState = deepClone(state);
          if (row.mesa_id) copyState.mesa_id = row.mesa_id;
          await client
            .from("fichas")
            .update({
              nome_personagem: copyState.nome || "Personagem",
              nivel: parseInt(String(copyState.nivel || 1), 10) || 1,
              dados: copyState,
              updated_at: new Date().toISOString()
            })
            .eq("id", row.id);
        }
      } catch (e) {
        /* ignore background sync error */
      }
    }
  }
};

/* ─── 5. Modal de Bestiário & Meus NPCs (#bestiario-modal) ───── */

function getActiveBestiarioEntries() {
  var source =
    bestiarioModalState.activeTab === "custom"
      ? OS.bestiaryCatalog.custom || []
      : OS.bestiaryCatalog.official || [];
  var q = normalizeSearch(bestiarioModalState.searchQuery).trim();
  if (!q) return source;
  return source.filter(function (entry) {
    var d = entry.data || {};
    var hay = normalizeSearch(
      [
        entry.name,
        d.nome,
        d.alcunha,
        d.equipamentos,
        d.notas,
        entry.category
      ].join(" ")
    );
    return hay.indexOf(q) !== -1;
  });
}

function getSelectedBestiarioEntry() {
  var list = getActiveBestiarioEntries();
  return (
    list.find(function (e) {
      return e.key === bestiarioModalState.selectedKey;
    }) || null
  );
}

OS.openBestiarioModal = async function (options) {
  options = options || {};
  var modal = OS.$("bestiario-modal");
  if (!modal) return;

  if (options.tab === "custom" || options.tab === "oficial") {
    bestiarioModalState.activeTab = options.tab;
  }
  bestiarioModalState.searchQuery = "";
  bestiarioModalState.selectedKey = null;

  var searchEl = OS.$("bestiario-search");
  if (searchEl) searchEl.value = "";
  var hintEl = OS.$("bestiario-modal-hint");
  if (hintEl) hintEl.textContent = "";

  await Promise.all([OS.loadOfficialBestiary(), OS.loadCustomNpcs()]);

  OS.renderBestiarioModal();
  modal.classList.add("open");
};

OS.closeBestiarioModal = function () {
  var modal = OS.$("bestiario-modal");
  if (modal) modal.classList.remove("open");
};

OS.switchBestiarioTab = async function (tabName) {
  bestiarioModalState.activeTab = tabName === "custom" ? "custom" : "oficial";
  bestiarioModalState.selectedKey = null;
  if (bestiarioModalState.activeTab === "custom") {
    await OS.loadCustomNpcs();
  } else {
    await OS.loadOfficialBestiary();
  }
  OS.renderBestiarioModal();
};

OS.duplicateOfficialToCustomNpcs = async function (entryArg) {
  var entry = entryArg || getSelectedBestiarioEntry();
  if (!entry || !entry.data) return null;

  var clonedData = deepClone(entry.data);
  clonedData.freeEdit = true;
  clonedData.isBestiaryCustom = true;
  clonedData.tipo_ficha = "npc";

  var saved = await OS.saveCustomNpcToSupabase(clonedData, null, "npc");
  await OS.loadCustomNpcs();

  bestiarioModalState.activeTab = "custom";
  if (saved && saved.id) {
    bestiarioModalState.selectedKey = "custom:" + saved.id;
  } else if (OS.bestiaryCatalog.custom.length) {
    bestiarioModalState.selectedKey = OS.bestiaryCatalog.custom[0].key;
  }

  OS.renderBestiarioModal();
  var hintEl = OS.$("bestiario-modal-hint");
  if (hintEl) {
    hintEl.textContent =
      '✓ Cópia editável de "' +
      (entry.name || clonedData.nome) +
      '" criada em Meus NPCs & Monstros.';
  }
  return saved;
};

OS.editSelectedBestiarioEntry = async function (entryArg) {
  var entry = entryArg || getSelectedBestiarioEntry();
  if (!entry || !entry.data) return;

  if (entry.sourceType === "oficial") {
    // Entradas oficiais nunca são alteradas diretamente: cria/abre cópia editável em freeEdit
    var dup = await OS.duplicateOfficialToCustomNpcs(entry);
    var customId = dup && dup.id ? dup.id : null;
    OS.openSheetInGmWorkspace(deepClone(entry.data), {
      mode: "custom",
      customId: customId,
      tipoFicha: "npc",
      title: "Editando Cópia de Bestiário: " + (entry.name || "Criatura")
    });
  } else {
    OS.openSheetInGmWorkspace(deepClone(entry.data), {
      mode: "custom",
      customId: entry.id,
      tipoFicha: entry.data.tipo_ficha || null,
      title: "Editando NPC Customizado: " + (entry.name || "NPC")
    });
  }
};

OS.renderBestiarioModal = function () {
  var tabs = document.querySelectorAll("#bestiario-tabs .catalog-tab-btn");
  tabs.forEach(function (btn) {
    var active =
      btn.getAttribute("data-bestiario-tab") === bestiarioModalState.activeTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  var listEl = OS.$("bestiario-list");
  var detailEl = OS.$("bestiario-detail");
  var btnDuplicar = OS.$("btn-bestiario-duplicar");
  var btnEditar = OS.$("btn-bestiario-editar");
  var btnColocar = OS.$("btn-bestiario-colocar-cena");

  var entries = getActiveBestiarioEntries();
  if (
    !bestiarioModalState.selectedKey &&
    entries.length > 0
  ) {
    bestiarioModalState.selectedKey = entries[0].key;
  }

  if (listEl) {
    listEl.innerHTML = "";
    if (!entries.length) {
      listEl.innerHTML =
        '<p class="catalog-detail-empty">' +
        (bestiarioModalState.activeTab === "custom"
          ? 'Nenhum NPC ou monstro customizado salvo. Clique em "Criar" abaixo.'
          : "Nenhuma criatura encontrada.") +
        "</p>";
    } else {
      entries.forEach(function (entry) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "catalog-item-btn" +
          (entry.key === bestiarioModalState.selectedKey ? " active" : "");
        btn.dataset.entryKey = entry.key;

        var d = entry.data || {};
        var defVal = d.defesa || "0";
        var cfgVal = d["config-6b"] || "1d6";

        btn.innerHTML =
          '<span class="catalog-item-name">' +
          escHtml(entry.name || d.nome || "Sem nome") +
          "</span>" +
          '<span class="catalog-item-price">Def ' +
          escHtml(defVal) +
          " • " +
          escHtml(cfgVal) +
          "</span>";

        btn.addEventListener("click", function () {
          bestiarioModalState.selectedKey = entry.key;
          OS.renderBestiarioModal();
        });
        listEl.appendChild(btn);
      });
    }
  }

  var selected = getSelectedBestiarioEntry();
  var canAddToMesa = !!(
    selected &&
    OS.activeMesaState &&
    OS.activeMesaState.mesaId &&
    OS.activeMesaState.isMestre
  );
  if (btnEditar) btnEditar.disabled = !selected;
  if (btnColocar) btnColocar.disabled = !canAddToMesa;
  if (btnDuplicar) {
    if (selected && selected.sourceType === "oficial") {
      btnDuplicar.removeAttribute("hidden");
      btnDuplicar.hidden = false;
      btnDuplicar.disabled = false;
    } else {
      btnDuplicar.setAttribute("hidden", "");
      btnDuplicar.hidden = true;
      btnDuplicar.disabled = true;
    }
  }

  if (!detailEl) return;
  if (!selected) {
    detailEl.innerHTML =
      '<p class="catalog-detail-empty">Selecione uma criatura ou NPC para ver os atributos e ações.</p>';
    return;
  }

  var sd = selected.data || {};
  var trainedSkills = [];
  if (Array.isArray(OS.SKILLS)) {
    OS.SKILLS.forEach(function (sk) {
      var dice = [];
      ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
        if (sd["pericia-" + sk.id + "-" + die]) dice.push(die);
      });
      if (dice.length) {
        trainedSkills.push(sk.name + " (" + dice.join(", ") + ")");
      }
    });
  }
  if (Array.isArray(OS.COMBAT_SKILLS)) {
    OS.COMBAT_SKILLS.forEach(function (sk) {
      var dice = [];
      ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
        if (sd["combate-" + sk.id + "-" + die]) dice.push(die);
      });
      if (dice.length) {
        trainedSkills.push(sk.name + " (" + dice.join(", ") + ")");
      }
    });
  }

  var portraitUrl = sd.retrato_url ? String(sd.retrato_url).trim() : "";
  var portraitSectionHtml = "";
  if (selected.sourceType === "custom") {
    portraitSectionHtml =
      '<div class="bestiario-detail-portrait-box">' +
      '  <div class="bestiario-detail-portrait-frame">' +
      (portraitUrl
        ? '<img class="bestiario-detail-portrait-img" src="' +
          escHtml(portraitUrl) +
          '" alt="Retrato de ' +
          escHtml(selected.name || sd.nome || "NPC") +
          '">'
        : '<span class="bestiario-detail-portrait-empty">Sem imagem</span>') +
      "  </div>" +
      '  <div class="bestiario-detail-portrait-actions">' +
      '    <input type="file" class="bestiario-detail-portrait-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
      '    <button type="button" class="btn btn-secondary btn-small btn-bestiario-trocar-imagem">Trocar Imagem</button>' +
      '    <span class="bestiario-detail-portrait-feedback" aria-live="polite" hidden></span>' +
      "  </div>" +
      "</div>";
  } else if (portraitUrl) {
    portraitSectionHtml =
      '<div class="bestiario-detail-portrait-box">' +
      '  <div class="bestiario-detail-portrait-frame">' +
      '    <img class="bestiario-detail-portrait-img" src="' +
      escHtml(portraitUrl) +
      '" alt="Retrato de ' +
      escHtml(selected.name || sd.nome || "Criatura") +
      '">' +
      "  </div>" +
      "</div>";
  }

  var opInfo = OS.resolveCombatantOperationalInfo
    ? OS.resolveCombatantOperationalInfo(selected)
    : null;
  var modeMeta = getCombatantModeBadgeMeta(opInfo);

  detailEl.innerHTML =
    portraitSectionHtml +
    '<h4 class="catalog-detail-title">' +
    escHtml(selected.name || sd.nome) +
    "</h4>" +
    (sd.alcunha
      ? '<p class="modal-sub" style="margin-bottom:8px;">' +
        escHtml(sd.alcunha) +
        "</p>"
      : "") +
    '<div class="catalog-attr"><span class="catalog-attr-label">Origem</span> <span class="catalog-attr-val">' +
    (selected.sourceType === "oficial"
      ? "Bestiário Oficial (Somente Leitura)"
      : "Meus NPCs & Monstros (Customizado)") +
    "</span></div>" +
    '<div class="catalog-attr"><span class="catalog-attr-label">Modalidade</span> <span class="catalog-attr-val"><span class="mesa-mode-badge ' +
    modeMeta.cls +
    '">' +
    escHtml((opInfo && opInfo.statusLabel) || modeMeta.label) +
    "</span></span></div>" +
    '<div class="catalog-attr"><span class="catalog-attr-label">Defesa</span> <span class="catalog-attr-val">' +
    escHtml(sd.defesa || "0") +
    "</span></div>" +
    '<div class="catalog-attr"><span class="catalog-attr-label">Iniciativa</span> <span class="catalog-attr-val">' +
    escHtml(sd.iniciativa || "0") +
    "</span></div>" +
    '<div class="catalog-attr"><span class="catalog-attr-label">Dados 6B</span> <span class="catalog-attr-val">' +
    escHtml(sd["config-6b"] || "1d6") +
    "</span></div>" +
    '<div class="catalog-attr"><span class="catalog-attr-label">REM</span> <span class="catalog-attr-val">' +
    escHtml((sd["rem-atual"] || "0") + " / " + (sd["rem-total"] || "0")) +
    "</span></div>" +
    (trainedSkills.length
      ? '<div class="catalog-attr"><span class="catalog-attr-label">Perícias &amp; Combate</span> <span class="catalog-attr-val">' +
        escHtml(trainedSkills.join(" • ")) +
        "</span></div>"
      : "") +
    (sd.equipamentos
      ? '<div class="catalog-attr"><span class="catalog-attr-label">Ataques / Equipamentos</span> <span class="catalog-attr-val" style="white-space:pre-line;">' +
        escHtml(sd.equipamentos) +
        "</span></div>"
      : "") +
    (sd.notas
      ? '<div class="catalog-attr"><span class="catalog-attr-label">Notas &amp; Habilidades</span> <span class="catalog-attr-val" style="white-space:pre-line;">' +
        escHtml(sd.notas) +
        "</span></div>"
      : "") +
    '<div class="bestiario-detail-actions" style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">' +
    '  <button type="button" class="btn btn-danger btn-small btn-detail-colocar-cena"' +
    (!canAddToMesa ? " disabled" : "") +
    ">Adicionar à Mesa</button>" +
    '  <button type="button" class="btn btn-secondary btn-small btn-detail-editar-ficha">Editar Ficha Completa</button>' +
    (selected.sourceType === "oficial"
      ? '  <button type="button" class="btn btn-secondary btn-small btn-detail-duplicar-npc">Duplicar para Meus NPCs</button>'
      : "") +
    "</div>";

  var dBtnTrocarImg = detailEl.querySelector(".btn-bestiario-trocar-imagem");
  var dInputImg = detailEl.querySelector(".bestiario-detail-portrait-input");
  var dFbImg = detailEl.querySelector(".bestiario-detail-portrait-feedback");
  if (dBtnTrocarImg && dInputImg && selected.sourceType === "custom") {
    dBtnTrocarImg.addEventListener("click", function () {
      dInputImg.click();
    });
    dInputImg.addEventListener("change", async function () {
      var file = dInputImg.files && dInputImg.files[0];
      if (!file) return;
      dBtnTrocarImg.disabled = true;
      try {
        var uploadFn = OS.uploadCharacterPortrait || OS.uploadCharacterPortraitFile;
        var uploadedUrl = uploadFn
          ? await uploadFn(file, {
              customNpcId: selected.id,
              npcName: selected.name || sd.nome || "npc",
              skipSheetApply: true,
              onFeedback: function (msg, isErr) {
                if (!dFbImg) return;
                if (!msg) {
                  dFbImg.textContent = "";
                  dFbImg.hidden = true;
                  dFbImg.setAttribute("hidden", "");
                  return;
                }
                dFbImg.textContent = msg;
                dFbImg.className =
                  "bestiario-detail-portrait-feedback " +
                  (isErr ? "is-error" : "is-success");
                dFbImg.hidden = false;
                dFbImg.removeAttribute("hidden");
              }
            })
          : null;

        if (uploadedUrl) {
          selected.data.retrato_url = uploadedUrl;
          await OS.saveCustomNpcToSupabase(
            selected.data,
            selected.id,
            selected.data.tipo_ficha || "npc"
          );
          if (
            OS.activeMesaState &&
            Array.isArray(OS.activeMesaState.npcsMesa)
          ) {
            var updatedInMesa = false;
            OS.activeMesaState.npcsMesa.forEach(function (mItem) {
              if (
                mItem &&
                mItem.sourceType === "custom" &&
                mItem.sourceId === selected.id &&
                mItem.data
              ) {
                mItem.data.retrato_url = uploadedUrl;
                updatedInMesa = true;
              }
            });
            if (updatedInMesa) {
              OS.renderMesaNpcsList();
              await OS.saveMesaNpcsRemote();
            }
          }
          OS.renderBestiarioModal();
        }
      } finally {
        dBtnTrocarImg.disabled = false;
        dInputImg.value = "";
      }
    });
  }

  var dBtnColocar = detailEl.querySelector(".btn-detail-colocar-cena");
  if (dBtnColocar) {
    dBtnColocar.addEventListener("click", function () {
      OS.addBestiarioEntryToMesa(selected);
    });
  }
  var dBtnEditar = detailEl.querySelector(".btn-detail-editar-ficha");
  if (dBtnEditar) {
    dBtnEditar.addEventListener("click", function () {
      OS.editSelectedBestiarioEntry(selected);
    });
  }
  var dBtnDup = detailEl.querySelector(".btn-detail-duplicar-npc");
  if (dBtnDup) {
    dBtnDup.addEventListener("click", function () {
      OS.duplicateOfficialToCustomNpcs(selected);
    });
  }
};

/* ─── 7. Modal de Resumo de Regras (#regras-modal) ────────────── */

function formatRuleKeyLabel(rawKey) {
  return String(rawKey || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

function renderJsonNodeToHtml(node, depth) {
  depth = depth || 0;
  if (node === null || node === undefined) return "";
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    return '<p class="regras-paragraph">' + escHtml(String(node)) + "</p>";
  }
  if (Array.isArray(node)) {
    if (!node.length) return "";
    var allPrimitives = node.every(function (item) {
      return item === null || typeof item !== "object";
    });
    if (allPrimitives) {
      return (
        '<ul class="regras-list">' +
        node
          .map(function (item) {
            return "<li>" + escHtml(String(item)) + "</li>";
          })
          .join("") +
        "</ul>"
      );
    }
    return node
      .map(function (item) {
        return (
          '<div class="regras-card-item">' +
          renderJsonNodeToHtml(item, depth + 1) +
          "</div>"
        );
      })
      .join("");
  }
  if (typeof node === "object") {
    var html = "";
    Object.keys(node).forEach(function (k) {
      var val = node[k];
      if (val === null || val === undefined || val === "") return;
      var label = formatRuleKeyLabel(k);
      if (typeof val === "object") {
        html +=
          '<div class="regras-subsection">' +
          '<h5 class="regras-subtitle">' +
          escHtml(label) +
          "</h5>" +
          renderJsonNodeToHtml(val, depth + 1) +
          "</div>";
      } else {
        html +=
          '<div class="catalog-attr"><span class="catalog-attr-label">' +
          escHtml(label) +
          '</span> <span class="catalog-attr-val">' +
          escHtml(String(val)) +
          "</span></div>";
      }
    });
    return html;
  }
  return "";
}

OS.openRegrasModal = async function (initialRuleKey) {
  var modal = OS.$("regras-modal");
  if (!modal) return;
  if (OS.loadGameData) {
    await OS.loadGameData();
  }
  if (initialRuleKey) {
    regrasModalState.activeKey = initialRuleKey;
  }
  regrasModalState.selectedSectionKey = null;
  regrasModalState.searchQuery = "";
  var searchEl = OS.$("regras-search");
  if (searchEl) searchEl.value = "";

  OS.renderRegrasModal();
  modal.classList.add("open");
};

OS.closeRegrasModal = function () {
  var modal = OS.$("regras-modal");
  if (modal) modal.classList.remove("open");
};

OS.renderRegrasModal = function () {
  var tabsEl = OS.$("regras-tabs");
  var listEl = OS.$("regras-sections-list");
  var detailEl = OS.$("regras-detail");
  if (!tabsEl || !listEl || !detailEl) return;

  tabsEl.innerHTML = "";
  RULES_TABS_DEF.forEach(function (tabDef) {
    var btn = document.createElement("button");
    btn.type = "button";
    var isActive = tabDef.key === regrasModalState.activeKey;
    btn.className = "catalog-tab-btn" + (isActive ? " active" : "");
    btn.dataset.ruleKey = tabDef.key;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.textContent = tabDef.label;
    btn.addEventListener("click", function () {
      regrasModalState.activeKey = tabDef.key;
      regrasModalState.selectedSectionKey = null;
      OS.renderRegrasModal();
    });
    tabsEl.appendChild(btn);
  });

  var ruleObj =
    (OS.getGameData && OS.getGameData(regrasModalState.activeKey)) || {};
  var allSectionKeys = Object.keys(ruleObj);
  var q = normalizeSearch(regrasModalState.searchQuery).trim();

  var filteredSectionKeys = allSectionKeys.filter(function (secKey) {
    if (!q) return true;
    var secText = normalizeSearch(
      formatRuleKeyLabel(secKey) + " " + JSON.stringify(ruleObj[secKey])
    );
    return secText.indexOf(q) !== -1;
  });

  if (
    !regrasModalState.selectedSectionKey ||
    (regrasModalState.selectedSectionKey !== "__all__" &&
      filteredSectionKeys.indexOf(regrasModalState.selectedSectionKey) === -1)
  ) {
    regrasModalState.selectedSectionKey =
      filteredSectionKeys.length > 0 ? "__all__" : null;
  }

  listEl.innerHTML = "";
  if (!filteredSectionKeys.length) {
    listEl.innerHTML =
      '<p class="catalog-detail-empty">Nenhum tópico encontrado para a busca.</p>';
    detailEl.innerHTML =
      '<p class="catalog-detail-empty">Nenhum resultado encontrado para "' +
      escHtml(regrasModalState.searchQuery) +
      '".</p>';
    return;
  }

  // Botão "Ver Tudo" no topo da lista de seções
  var allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className =
    "catalog-item-btn" +
    (regrasModalState.selectedSectionKey === "__all__" ? " active" : "");
  allBtn.dataset.sectionKey = "__all__";
  allBtn.innerHTML =
    '<span class="catalog-item-name">Visão Completa (' +
    filteredSectionKeys.length +
    " tópicos)</span>";
  allBtn.addEventListener("click", function () {
    regrasModalState.selectedSectionKey = "__all__";
    OS.renderRegrasModal();
  });
  listEl.appendChild(allBtn);

  filteredSectionKeys.forEach(function (secKey) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "catalog-item-btn" +
      (secKey === regrasModalState.selectedSectionKey ? " active" : "");
    btn.dataset.sectionKey = secKey;
    btn.innerHTML =
      '<span class="catalog-item-name">' +
      escHtml(formatRuleKeyLabel(secKey)) +
      "</span>";
    btn.addEventListener("click", function () {
      regrasModalState.selectedSectionKey = secKey;
      OS.renderRegrasModal();
    });
    listEl.appendChild(btn);
  });

  var activeTabMeta =
    RULES_TABS_DEF.find(function (t) {
      return t.key === regrasModalState.activeKey;
    }) || RULES_TABS_DEF[0];

  if (regrasModalState.selectedSectionKey === "__all__" || q) {
    var combinedObj = {};
    filteredSectionKeys.forEach(function (k) {
      combinedObj[k] = ruleObj[k];
    });
    detailEl.innerHTML =
      '<h4 class="catalog-detail-title">' +
      escHtml(activeTabMeta.label) +
      "</h4>" +
      renderJsonNodeToHtml(combinedObj, 0);
  } else {
    var secKey = regrasModalState.selectedSectionKey;
    detailEl.innerHTML =
      '<h4 class="catalog-detail-title">' +
      escHtml(formatRuleKeyLabel(secKey)) +
      "</h4>" +
      renderJsonNodeToHtml(ruleObj[secKey], 0);
  }
};

/* ─── Feed Lateral (#mesa-sidebar-feed / public.eventos_mesa) ─── */

OS.loadMesaFeedEvents = async function (mesaIdArg) {
  var mesaId =
    mesaIdArg || (OS.activeMesaState && OS.activeMesaState.mesaId);
  var feedListEl = OS.$("mesa-feed-list");
  if (!mesaId || !feedListEl) return [];

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) return [];

  var res = await client
    .from("eventos_mesa")
    .select("*")
    .eq("mesa_id", mesaId)
    .order("created_at", { ascending: true })
    .limit(100);

  var isMestre = !!(OS.activeMesaState && OS.activeMesaState.isMestre);
  var rawEvents = (res && Array.isArray(res.data)) ? res.data : [];

  // Respeitar visivel_para ('todos' vs 'mestre' — só renderizado se isMestre=true)
  var visibleEvents = rawEvents.filter(function (ev) {
    if (ev.visivel_para === "mestre" && !isMestre) return false;
    return true;
  });

  OS.activeMesaState.feedEvents = visibleEvents;
  OS.renderMesaFeedEvents(visibleEvents);
  return visibleEvents;
};

function buildMesaFeedItemDom(ev) {
  var item = document.createElement("div");
  var isSecret = ev.visivel_para === "mestre";
  item.className =
    "mesa-feed-item" + (isSecret ? " mesa-feed-item-secret" : "");
  item.dataset.eventId = ev.id;
  item.dataset.visivelPara = ev.visivel_para || "todos";

  var c = ev.conteudo && typeof ev.conteudo === "object" ? ev.conteudo : {};
  var autor = c.autor || "Participante";
  var texto = c.texto || c.resumo || JSON.stringify(c);
  var timeStr = "";
  if (ev.created_at) {
    var d = new Date(ev.created_at);
    if (!isNaN(d.getTime())) {
      timeStr = d.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
  }

  item.innerHTML =
    '<div class="mesa-feed-item-top">' +
    '  <strong class="mesa-feed-author">' +
    escHtml(autor) +
    "</strong>" +
    (isSecret
      ? '<span class="mesa-feed-secret-badge">Somente Mestre</span>'
      : "") +
    '  <span class="mesa-feed-time">' +
    escHtml(timeStr) +
    "</span>" +
    "</div>" +
    '<div class="mesa-feed-item-body">' +
    escHtml(texto) +
    "</div>";

  return item;
}

OS.appendMesaFeedEventIfNew = function (ev) {
  if (!ev || !ev.id) return false;
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return false;
  if (ev.visivel_para === "mestre" && !st.isMestre) return false;

  if (!Array.isArray(st.feedEvents)) {
    st.feedEvents = [];
  }
  var existsInState = st.feedEvents.some(function (x) {
    return x && String(x.id) === String(ev.id);
  });

  var feedListEl = OS.$("mesa-feed-list");
  var existsInDom = !!(
    feedListEl &&
    feedListEl.querySelector(
      '.mesa-feed-item[data-event-id="' + String(ev.id) + '"]'
    )
  );

  if (existsInState && existsInDom) {
    return false;
  }

  if (!existsInState) {
    st.feedEvents.push(ev);
  }

  if (feedListEl && !existsInDom) {
    var emptyPlaceholder = feedListEl.querySelector(".characters-empty");
    if (emptyPlaceholder && emptyPlaceholder.parentNode) {
      emptyPlaceholder.parentNode.removeChild(emptyPlaceholder);
    }
    feedListEl.appendChild(buildMesaFeedItemDom(ev));
    feedListEl.scrollTop = feedListEl.scrollHeight;
  }

  return true;
};

OS.renderMesaFeedEvents = function (events) {
  var feedListEl = OS.$("mesa-feed-list");
  if (!feedListEl) return;

  var list = Array.isArray(events)
    ? events
    : (OS.activeMesaState && OS.activeMesaState.feedEvents) || [];

  if (!list.length) {
    feedListEl.innerHTML =
      '<p class="characters-empty">Nenhum evento registrado ainda nesta mesa.</p>';
    return;
  }

  feedListEl.innerHTML = "";
  list.forEach(function (ev) {
    if (!ev) return;
    feedListEl.appendChild(buildMesaFeedItemDom(ev));
  });

  feedListEl.scrollTop = feedListEl.scrollHeight;
};

OS.sendMesaFeedEvent = async function (texto, visivelPara, tipo) {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId) return null;
  var msg = String(texto || "").trim();
  if (!msg) return null;

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  var uid = await OS.getCurrentUserId();
  if (!client || !uid) return null;

  var vis =
    st.isMestre && visivelPara === "mestre" ? "mestre" : "todos";
  var autor =
    (OS.authSession && (OS.authSession.username || OS.authSession.email)) ||
    (st.isMestre ? "Mestre" : "Jogador");

  var ins = await client
    .from("eventos_mesa")
    .insert({
      mesa_id: st.mesaId,
      usuario_id: uid,
      tipo: tipo || "mensagem",
      visivel_para: vis,
      conteudo: {
        autor: autor,
        papel: st.isMestre ? "mestre" : "jogador",
        texto: msg
      }
    })
    .select("*")
    .single();

  if (ins && ins.data && ins.data.id) {
    OS.appendMesaFeedEventIfNew(ins.data);
  } else {
    await OS.loadMesaFeedEvents(st.mesaId);
  }
  return ins ? ins.data : null;
};

OS.handleGmNovaSessaoMesa = async function () {
  var st = OS.activeMesaState;
  if (!st || !st.mesaId || !st.isMestre) {
    if (typeof OS.showToast === "function") {
      OS.showToast("Apenas o Mestre pode iniciar uma nova sessão.", "error");
    }
    return;
  }

  var confirmed = window.confirm(
    "Deseja iniciar uma Nova Sessão para todos os participantes? Isso irá sortear novas Fichas do Destino e preparar o 6B de todas as fichas vinculadas a esta mesa."
  );
  if (!confirmed) return;

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client) {
    if (typeof OS.showToast === "function") {
      OS.showToast("Erro: Cliente Supabase não disponível.", "error");
    }
    return;
  }

  var btn = OS.$("btn-mesa-nova-sessao");
  if (btn) btn.disabled = true;

  try {
    var res = await client.rpc("iniciar_nova_sessao_mesa", {
      p_mesa_id: st.mesaId
    });

    if (res && res.error) {
      console.error("[mesaScreen] Erro ao iniciar nova sessão:", res.error);
      if (typeof OS.showToast === "function") {
        OS.showToast("Erro ao iniciar Nova Sessão: " + (res.error.message || res.error), "error");
      }
      return;
    }

    if (typeof OS.showToast === "function") {
      OS.showToast("Nova Sessão iniciada com sucesso para todas as fichas da mesa!", "success");
    }

    await OS.loadMesaPlayersSheets();
    if (OS.renderMesaSceneCards) OS.renderMesaSceneCards();
    if (OS.renderMesaFloatingPopups) OS.renderMesaFloatingPopups();
  } catch (err) {
    console.error("[mesaScreen] Falha ao executar RPC iniciar_nova_sessao_mesa:", err);
    if (typeof OS.showToast === "function") {
      OS.showToast("Falha inesperada ao iniciar Nova Sessão.", "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

/* ─── Bind de Eventos da Tela de Mesa e Modais ───────────────── */

OS.bindMesaScreenEvents = function () {
  if (OS.bindMesaMapEvents) OS.bindMesaMapEvents();
  OS.bindMapCameraEvents();
  var btnCriarMesa = OS.$("btn-criar-mesa");
  if (btnCriarMesa && !btnCriarMesa._mesaBound) {
    btnCriarMesa._mesaBound = true;
    btnCriarMesa.addEventListener("click", function () {
      OS.createMesa();
    });
  }

  var btnEntrarMesa = OS.$("btn-entrar-mesa");
  if (btnEntrarMesa && !btnEntrarMesa._mesaBound) {
    btnEntrarMesa._mesaBound = true;
    btnEntrarMesa.addEventListener("click", function () {
      OS.joinMesaByCode();
    });
  }

  var btnMesaVoltar = OS.$("btn-mesa-voltar");
  if (btnMesaVoltar && !btnMesaVoltar._mesaBound) {
    btnMesaVoltar._mesaBound = true;
    btnMesaVoltar.addEventListener("click", function () {
      OS.leaveMesaScreen();
    });
  }

  // Alternância da Lateral Direita: 💬 Chat | 👤 Fichas
  var btnTabChat = OS.$("btn-mesa-tab-chat");
  if (btnTabChat && !btnTabChat._mesaBound) {
    btnTabChat._mesaBound = true;
    btnTabChat.addEventListener("click", function () {
      OS.switchMesaSidebarTab("chat");
    });
  }

  var btnTabFichas = OS.$("btn-mesa-tab-fichas");
  if (btnTabFichas && !btnTabFichas._mesaBound) {
    btnTabFichas._mesaBound = true;
    btnTabFichas.addEventListener("click", function () {
      OS.switchMesaSidebarTab("fichas");
    });
  }

  // Upload de Mapa e Controles +/- da Grade (#mesa-map-stage)
  var mapFileInput = OS.$("mesa-map-file-input");
  var btnMapUpload = OS.$("btn-mesa-map-upload");
  var btnMapEmptyUpload = OS.$("btn-mesa-map-empty-upload");

  if (btnMapUpload && !btnMapUpload._mesaBound) {
    btnMapUpload._mesaBound = true;
    btnMapUpload.addEventListener("click", function () {
      if (mapFileInput) mapFileInput.click();
    });
  }

  if (btnMapEmptyUpload && !btnMapEmptyUpload._mesaBound) {
    btnMapEmptyUpload._mesaBound = true;
    btnMapEmptyUpload.addEventListener("click", function () {
      if (mapFileInput) mapFileInput.click();
    });
  }

  if (mapFileInput && !mapFileInput._mesaBound) {
    mapFileInput._mesaBound = true;
    mapFileInput.addEventListener("change", async function () {
      var file = mapFileInput.files && mapFileInput.files[0];
      if (!file) return;
      try {
        await OS.uploadMesaMapFile(file);
      } finally {
        mapFileInput.value = "";
      }
    });
  }

  var btnGridMinus = OS.$("btn-mesa-grid-minus");
  if (btnGridMinus && !btnGridMinus._mesaBound) {
    btnGridMinus._mesaBound = true;
    btnGridMinus.addEventListener("click", function () {
      OS.adjustMesaGridCols(-1);
    });
  }

  var btnGridPlus = OS.$("btn-mesa-grid-plus");
  if (btnGridPlus && !btnGridPlus._mesaBound) {
    btnGridPlus._mesaBound = true;
    btnGridPlus.addEventListener("click", function () {
      OS.adjustMesaGridCols(1);
    });
  }

  var mapImgEl = OS.$("mesa-map-image");
  if (mapImgEl && !mapImgEl._mesaBound) {
    mapImgEl._mesaBound = true;
    mapImgEl.addEventListener("load", function () {
      OS.syncMesaGridOverlay();
    });
  }

  var mapCanvasEl = OS.$("mesa-map-canvas");
  if (
    mapCanvasEl &&
    !mapCanvasEl._resizeObserved &&
    typeof ResizeObserver === "function"
  ) {
    mapCanvasEl._resizeObserved = true;
    var ro = new ResizeObserver(function () {
      OS.syncMesaGridOverlay();
    });
    ro.observe(mapCanvasEl);
  }

  if (!window._mesaGridResizeBound) {
    window._mesaGridResizeBound = true;
    window.addEventListener("resize", function () {
      if (OS.activeMesaState && OS.activeMesaState.mesaId) {
        OS.syncMesaGridOverlay();
        if (OS.clampAllGmPopupsToViewport) {
          OS.clampAllGmPopupsToViewport();
        }
      }
    });
  }

  // Botão "+" na lista NPCs/Monstros
  var btnMesaAddNpc = OS.$("btn-mesa-add-npc");
  if (btnMesaAddNpc && !btnMesaAddNpc._mesaBound) {
    btnMesaAddNpc._mesaBound = true;
    btnMesaAddNpc.addEventListener("click", function () {
      OS.openBestiarioModal({ tab: "oficial" });
    });
  }

  var btnMesaMagias = OS.$("btn-mesa-magias");
  if (btnMesaMagias && !btnMesaMagias._mesaBound) {
    btnMesaMagias._mesaBound = true;
    btnMesaMagias.addEventListener("click", function () {
      if (OS.openMagiasCatalogModal) {
        OS.openMagiasCatalogModal({ readOnly: true });
      }
    });
  }

  var btnMesaRegras = OS.$("btn-mesa-regras");
  var btnMesaEquip = OS.$("btn-mesa-equipamentos");
  if (btnMesaEquip) btnMesaEquip.addEventListener("click", async function () {
    if (!OS.activeMesaState.isMestre) return;
    await OS.loadMesaPlayersSheets(OS.activeMesaState.mesaId);
    OS.openCatalogModal("gm");
  });
  if (btnMesaRegras && !btnMesaRegras._mesaBound) {
    btnMesaRegras._mesaBound = true;
    btnMesaRegras.addEventListener("click", function () {
      OS.openRegrasModal();
    });
  }

  var btnMesaNovaSessao = OS.$("btn-mesa-nova-sessao");
  if (btnMesaNovaSessao && !btnMesaNovaSessao._mesaBound) {
    btnMesaNovaSessao._mesaBound = true;
    btnMesaNovaSessao.addEventListener("click", function () {
      OS.handleGmNovaSessaoMesa();
    });
  }

  var btnFecharFicha = OS.$("btn-mesa-fechar-ficha");
  if (btnFecharFicha && !btnFecharFicha._mesaBound) {
    btnFecharFicha._mesaBound = true;
    btnFecharFicha.addEventListener("click", function () {
      OS.closeMesaSheetEditor();
    });
  }

  var btnPlayersRefresh = OS.$("btn-mesa-players-refresh");
  if (btnPlayersRefresh && !btnPlayersRefresh._mesaBound) {
    btnPlayersRefresh._mesaBound = true;
    btnPlayersRefresh.addEventListener("click", function () {
      OS.loadMesaPlayersSheets();
      OS.loadMesaTokens();
    });
  }

  var btnTokensRefresh = OS.$("btn-mesa-tokens-refresh");
  if (btnTokensRefresh && !btnTokensRefresh._mesaBound) {
    btnTokensRefresh._mesaBound = true;
    btnTokensRefresh.addEventListener("click", function () {
      OS.refreshMesaStageAndTokens();
    });
  }

  var btnSceneRefresh = OS.$("btn-mesa-scene-refresh");
  if (btnSceneRefresh && !btnSceneRefresh._mesaBound) {
    btnSceneRefresh._mesaBound = true;
    btnSceneRefresh.addEventListener("click", function () {
      OS.refreshMesaStageAndTokens();
    });
  }

  var btnToggleAllScene = OS.$("btn-toggle-all-scene-cards");
  if (btnToggleAllScene && !btnToggleAllScene._mesaBound) {
    btnToggleAllScene._mesaBound = true;
    btnToggleAllScene.addEventListener("click", function () {
      OS.toggleAllSceneCreatureCards();
    });
  }

  var terrorInp = OS.$("mesa-terror-input");
  if (terrorInp && !terrorInp._mesaBound) {
    terrorInp._mesaBound = true;
    terrorInp.addEventListener("change", function () {
      var val = Math.max(0, Math.min(6, parseInt(terrorInp.value, 10) || 0));
      terrorInp.value = String(val);
      OS.sceneTerrorLevel = val;
      var sSlider = OS.$("scene-terror-slider");
      var sInp = OS.$("scene-terror-input");
      if (sSlider) sSlider.value = String(val);
      if (sInp) sInp.value = String(val);
      OS.scheduleMesaSceneSave();
    });
  }

  // Modal Bestiário
  var bestiarioTabs = document.querySelectorAll(
    "#bestiario-tabs .catalog-tab-btn"
  );
  bestiarioTabs.forEach(function (tabBtn) {
    if (tabBtn._mesaBound) return;
    tabBtn._mesaBound = true;
    tabBtn.addEventListener("click", function () {
      OS.switchBestiarioTab(tabBtn.getAttribute("data-bestiario-tab"));
    });
  });

  var bestiarioSearch = OS.$("bestiario-search");
  if (bestiarioSearch && !bestiarioSearch._mesaBound) {
    bestiarioSearch._mesaBound = true;
    bestiarioSearch.addEventListener("input", function () {
      bestiarioModalState.searchQuery = bestiarioSearch.value;
      bestiarioModalState.selectedKey = null;
      OS.renderBestiarioModal();
    });
  }

  var btnBestiarioCriar = OS.$("btn-bestiario-criar");
  if (btnBestiarioCriar && !btnBestiarioCriar._mesaBound) {
    btnBestiarioCriar._mesaBound = true;
    btnBestiarioCriar.addEventListener("click", function () {
      OS.startCreateCustomNpc();
    });
  }

  var btnBestiarioClose = OS.$("bestiario-modal-close");
  if (btnBestiarioClose && !btnBestiarioClose._mesaBound) {
    btnBestiarioClose._mesaBound = true;
    btnBestiarioClose.addEventListener("click", OS.closeBestiarioModal);
  }

  var bestiarioOverlay = OS.$("bestiario-modal");
  if (bestiarioOverlay && !bestiarioOverlay._mesaBound) {
    bestiarioOverlay._mesaBound = true;
    bestiarioOverlay.addEventListener("click", function (e) {
      if (e.target === bestiarioOverlay) OS.closeBestiarioModal();
    });
  }

  var btnBestiarioColocar = OS.$("btn-bestiario-colocar-cena");
  if (btnBestiarioColocar && !btnBestiarioColocar._mesaBound) {
    btnBestiarioColocar._mesaBound = true;
    btnBestiarioColocar.addEventListener("click", function () {
      var sel = getSelectedBestiarioEntry();
      if (!sel) return;
      OS.addBestiarioEntryToMesa(sel);
    });
  }

  var btnBestiarioEditar = OS.$("btn-bestiario-editar");
  if (btnBestiarioEditar && !btnBestiarioEditar._mesaBound) {
    btnBestiarioEditar._mesaBound = true;
    btnBestiarioEditar.addEventListener("click", function () {
      OS.editSelectedBestiarioEntry();
    });
  }

  var btnBestiarioDuplicar = OS.$("btn-bestiario-duplicar");
  if (btnBestiarioDuplicar && !btnBestiarioDuplicar._mesaBound) {
    btnBestiarioDuplicar._mesaBound = true;
    btnBestiarioDuplicar.addEventListener("click", function () {
      OS.duplicateOfficialToCustomNpcs();
    });
  }

  // Modal Regras
  var regrasSearch = OS.$("regras-search");
  if (regrasSearch && !regrasSearch._mesaBound) {
    regrasSearch._mesaBound = true;
    regrasSearch.addEventListener("input", function () {
      regrasModalState.searchQuery = regrasSearch.value;
      OS.renderRegrasModal();
    });
  }

  var btnRegrasClose = OS.$("regras-modal-close");
  if (btnRegrasClose && !btnRegrasClose._mesaBound) {
    btnRegrasClose._mesaBound = true;
    btnRegrasClose.addEventListener("click", OS.closeRegrasModal);
  }

  var regrasOverlay = OS.$("regras-modal");
  if (regrasOverlay && !regrasOverlay._mesaBound) {
    regrasOverlay._mesaBound = true;
    regrasOverlay.addEventListener("click", function (e) {
      if (e.target === regrasOverlay) OS.closeRegrasModal();
    });
  }

  // Feed da Mesa
  var feedForm = OS.$("mesa-feed-form");
  if (feedForm && !feedForm._mesaBound) {
    feedForm._mesaBound = true;
    feedForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = OS.$("mesa-feed-input");
      var visSel = OS.$("mesa-feed-visibilidade");
      if (!inp || !inp.value.trim()) return;
      var txt = inp.value.trim();
      inp.value = "";
      OS.sendMesaFeedEvent(
        txt,
        visSel ? visSel.value : "todos",
        "mensagem"
      );
    });
  }

  var btnFeedRefresh = OS.$("btn-mesa-feed-refresh");
  if (btnFeedRefresh && !btnFeedRefresh._mesaBound) {
    btnFeedRefresh._mesaBound = true;
    btnFeedRefresh.addEventListener("click", function () {
      OS.loadMesaFeedEvents();
    });
  }

  // Reconexão automática em queda/retorno de rede (offline / online)
  if (!window._mesaRealtimeNetworkBound) {
    window._mesaRealtimeNetworkBound = true;
    window.addEventListener("offline", function () {
      if (OS.activeMesaState && OS.activeMesaState.mesaId) {
        OS.activeMesaState._needsResyncOnSubscribe = true;
        OS.setMesaRealtimeStatusUi("reconnecting");
      }
    });
    window.addEventListener("online", function () {
      if (OS.activeMesaState && OS.activeMesaState.mesaId) {
        OS.reconnectMesaRealtimeNow(OS.activeMesaState.mesaId);
      }
    });
  }

  // Flush da cena ao fechar a janela/aba
  if (!window._mesaBeforeUnloadBound) {
    window._mesaBeforeUnloadBound = true;
    window.addEventListener("beforeunload", function () {
      if (
        OS.activeMesaState &&
        OS.activeMesaState.mesaId &&
        OS.activeMesaState.isMestre
      ) {
        OS.persistMesaSceneImmediateLocal();
        OS.flushMesaSceneRemoteSave();
      }
    });
  }
};
