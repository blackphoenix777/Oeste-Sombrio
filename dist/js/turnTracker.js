import { OS } from "./app.js";

// Estado de apresentação é local; ordem e mutações autoritativas pertencem ao servidor.
var COMBAT_CANONICAL_LS_PREFIX = "oesteSombrioCombatCanonical_";
function createEmptyRoundState() {
  return {
    combatId: null,
    mapaId: null,
    round: 0,
    serverVersion: 0,
    byTokenId: {},
    orderIds: [],
    opportunities: [],
    requests: [],
    emittedEventKeys: [],
    eventHistory: [],
    lastTurnIdx: -1,
    lastTurnTokenId: null
  };
}
var tracker = {
  mesaId: null,
  revision: -1,
  request: 0,
  minimized: false,
  busy: false,
  position: null,
  error: "",
  selectedTokenId: null,
  selectedActionType: "atacar",
  actionBarBusy: false,
  actionBarFeedback: "",
  gmOppDraft: {
    actionType: "ataque_oportunidade",
    targetTokenId: "",
    triggerLabel: "",
    rangeConfirmed: false,
    passiveConfirmed: false,
    open: false
  },
  roundState: createEmptyRoundState()
};
var turnEventListeners = [];
var actionControllerChain = Promise.resolve();
var $combat = function (id) { return OS.$(id); };
var combatEscape = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
}); };
function closeCombatDialog(id) { var el = $combat(id); if (el && el.open) el.close(); }
function deepCloneSafe(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
function normTrackerInit(v) {
  if (OS.normalizeMesaInitiative) return OS.normalizeMesaInitiative(v);
  var n = parseInt(String(v == null ? 0 : v), 10);
  return isNaN(n) ? 0 : n;
}
function resolveCacheUserId() {
  var st = OS.activeMesaState;
  if (OS.authSession && OS.authSession.userId) return String(OS.authSession.userId);
  if (st && st.currentUserId) return String(st.currentUserId);
  return null;
}
function legacyUnscopedStorageKey(mesaId) {
  return mesaId ? COMBAT_CANONICAL_LS_PREFIX + String(mesaId) : null;
}
function canonicalStorageKey(mesaId) {
  var uid = resolveCacheUserId();
  if (!mesaId || !uid) return null;
  return COMBAT_CANONICAL_LS_PREFIX + uid + "_" + String(mesaId);
}
function cleanupLegacyCombatStorage(mesaId) {
  if (typeof localStorage === "undefined" || !mesaId) return;
  try {
    var legacyKey = legacyUnscopedStorageKey(mesaId);
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch (e) {
    /* ignore */
  }
}
function isTokenOwnedByCurrentUser(tokenObj, itemObj, st, uid) {
  if (!uid) return false;
  if (tokenObj && tokenObj.owner_user_id && String(tokenObj.owner_user_id) === String(uid)) return true;
  if (st && st.playerFichaId && itemObj && itemObj.owner_ref && String(itemObj.owner_ref) === String(st.playerFichaId)) {
    return true;
  }
  return false;
}
function sanitizeCanonicalCacheForStorage(mesaId, rs) {
  var st = OS.activeMesaState || {};
  var uid = resolveCacheUserId();
  var isGm = !!st.isMestre;
  var tokens = Array.isArray(st.mesaTokens) ? st.mesaTokens : [];
  var activeOrdem = st.combateAtivo && Array.isArray(st.combateAtivo.ordem) ? st.combateAtivo.ordem : [];
  var itemById = {};
  activeOrdem.forEach(function (it) {
    if (it && it.token_id) itemById[String(it.token_id)] = it;
  });
  var tokenById = {};
  tokens.forEach(function (t) {
    if (t && t.id) tokenById[String(t.id)] = t;
  });

  var safeByToken = {};
  var safeOrder = [];
  var orderList = Array.isArray(rs.orderIds) ? rs.orderIds : Object.keys(rs.byTokenId || {});
  orderList.forEach(function (tidRaw) {
    var tid = String(tidRaw || "");
    var rawEntry = rs.byTokenId && rs.byTokenId[tid];
    if (!tid || !rawEntry) return;
    var tok = tokenById[tid] || null;
    var item = itemById[tid] || null;
    var owned = isTokenOwnedByCurrentUser(tok, item, st, uid);
    var visible = tok ? tok.visible_to_players !== false : (item ? item.visible_to_players !== false : true);
    if (!isGm && !visible && !owned) return;
    safeOrder.push(tid);
    var entryCopy = {
      tokenId: tid,
      currentInitiative: rawEntry.currentInitiative,
      nextRoundInitiative: isGm || owned ? rawEntry.nextRoundInitiative : null,
      initiativeSource: rawEntry.initiativeSource || "ficha",
      turnEnded: !!rawEntry.turnEnded,
      budget: isGm || owned ? deepCloneSafe(rawEntry.budget || null) : null,
      actionState:
        (isGm || owned) && rawEntry.actionState && rawEntry.actionState.persistedOnServer === true
          ? deepCloneSafe(rawEntry.actionState)
          : null
    };
    safeByToken[tid] = entryCopy;
  });

  var rawEvents = Array.isArray(rs.eventHistory) ? rs.eventHistory.slice(-100) : [];
  var safeEvents = isGm
    ? deepCloneSafe(rawEvents)
    : rawEvents.map(function (ev) {
        var copy = deepCloneSafe(ev);
        if (copy && copy.hiddenTurn) {
          copy.combatantId = null;
          copy.ownerRef = null;
        }
        return copy;
      });

  var safeOpps = (Array.isArray(rs.opportunities) ? rs.opportunities : []).filter(function (o) {
    if (!o || !o.combatantId) return false;
    if (isGm) return true;
    var tid = String(o.combatantId);
    return isTokenOwnedByCurrentUser(tokenById[tid] || null, itemById[tid] || null, st, uid);
  });
  var safeReqs = (Array.isArray(rs.requests) ? rs.requests : []).filter(function (r) {
    if (!r || !r.combatantId) return false;
    if (isGm) return true;
    var tid = String(r.combatantId);
    return isTokenOwnedByCurrentUser(tokenById[tid] || null, itemById[tid] || null, st, uid);
  });

  return {
    userId: uid,
    mesaId: String(mesaId),
    combatId: rs.combatId,
    mapaId: rs.mapaId || null,
    round: rs.round,
    serverVersion: rs.serverVersion,
    orderIds: safeOrder,
    byTokenId: safeByToken,
    opportunities: deepCloneSafe(safeOpps),
    requests: deepCloneSafe(safeReqs),
    emittedEventKeys: Array.isArray(rs.emittedEventKeys) ? rs.emittedEventKeys.slice(-200) : [],
    eventHistory: safeEvents,
    lastTurnIdx: typeof rs.lastTurnIdx === "number" ? rs.lastTurnIdx : -1,
    lastTurnTokenId: rs.lastTurnTokenId || null
  };
}
function loadPersistedCanonicalState(mesaId, combatId) {
  if (!mesaId || typeof localStorage === "undefined") return null;
  cleanupLegacyCombatStorage(mesaId);
  var key = canonicalStorageKey(mesaId);
  var uid = resolveCacheUserId();
  if (!key || !uid) return null;
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (String(parsed.userId || "") !== String(uid)) return null;
    if (String(parsed.mesaId || "") !== String(mesaId)) return null;
    if (combatId && String(parsed.combatId || "") !== String(combatId)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}
function savePersistedCanonicalState(mesaId) {
  if (!mesaId || typeof localStorage === "undefined") return;
  cleanupLegacyCombatStorage(mesaId);
  var key = canonicalStorageKey(mesaId);
  var rs = tracker.roundState;
  if (!key || !rs || !rs.combatId) return;
  try {
    localStorage.setItem(key, JSON.stringify(sanitizeCanonicalCacheForStorage(mesaId, rs)));
  } catch (e) {
    /* ignore storage quota */
  }
}
OS.clearCanonicalCombatPersistence = function (mesaId) {
  var id = mesaId || (OS.activeMesaState && OS.activeMesaState.mesaId) || tracker.mesaId;
  if (!id || typeof localStorage === "undefined") return;
  try {
    cleanupLegacyCombatStorage(id);
    var key = canonicalStorageKey(id);
    if (key) localStorage.removeItem(key);
  } catch (e) {
    /* ignore */
  }
};
function computeBudgetForCombatItem(item, roundNum, currentInit) {
  if (typeof OS.computeCombatantTurnBudget === "function") {
    return OS.computeCombatantTurnBudget(item, roundNum, { currentInitiative: currentInit });
  }
  return null;
}
function createActionStateForItem(item, roundNum, combatObj, budget, existingState) {
  var st = OS.activeMesaState || {};
  var mesaId = st.mesaId || tracker.mesaId || null;
  var combateId = (combatObj && combatObj.id) || (tracker.roundState && tracker.roundState.combatId) || null;
  var mapaId = (combatObj && combatObj.mapa_id) || st.activeMapId || null;
  var serverAction = item && item.action_state && typeof item.action_state === "object" ? item.action_state : null;
  if (serverAction && Number(serverAction.round) === Number(roundNum)) {
    if (
      !existingState ||
      !existingState.persistedOnServer ||
      Number(existingState.round) !== Number(roundNum) ||
      Number(serverAction.version || 0) >= Number(existingState.version || 0)
    ) {
      var clonedServer = deepCloneSafe(serverAction);
      clonedServer.persistedOnServer = true;
      return clonedServer;
    }
  }
  if (
    existingState &&
    typeof existingState === "object" &&
    existingState.persistedOnServer === true &&
    Number(existingState.round) === Number(roundNum)
  ) {
    if (budget && typeof budget === "object") {
      existingState.budgetDefined = !!budget.budgetDefined;
      existingState.pendingReason = budget.pendingReason || null;
      existingState.initialBudget = budget.budgetDefined ? budget.initialBudget : null;
      existingState.currentInitiative = budget.currentInitiative;
    }
    return existingState;
  }
  if (typeof OS.createCombatantActionState === "function") {
    return OS.createCombatantActionState({
      mesaId: mesaId,
      combateId: combateId,
      mapaId: mapaId,
      round: roundNum,
      combatantId: String(item.token_id || ""),
      instanceId: item.owner_ref ? String(item.owner_ref) : null,
      precomputedBudget: budget,
      kind: budget ? budget.kind : (item.owner_type === "player" ? "player" : "npc_human"),
      operationalMode: budget ? budget.operationalMode : null,
      currentInitiative: normTrackerInit(item.currentInitiative !== undefined ? item.currentInitiative : item.iniciativa)
    });
  }
  return {
    mesaId: mesaId ? String(mesaId) : null,
    combateId: combateId ? String(combateId) : null,
    mapaId: mapaId ? String(mapaId) : null,
    round: roundNum,
    combatantId: String(item.token_id || ""),
    instanceId: item.owner_ref ? String(item.owner_ref) : null,
    kind: budget ? budget.kind : (item.owner_type === "player" ? "player" : "npc_human"),
    operationalMode: budget ? budget.operationalMode : null,
    currentInitiative: normTrackerInit(item.currentInitiative !== undefined ? item.currentInitiative : item.iniciativa),
    budgetDefined: !!(budget && budget.budgetDefined),
    pendingReason: budget ? budget.pendingReason || null : "action_budget_unavailable",
    initialBudget: budget && budget.budgetDefined ? budget.initialBudget : null,
    spentActions: 0,
    reservedActions: 0,
    turnEnded: false,
    version: 1,
    persistedOnServer: false,
    ledger: [],
    auditLog: [],
    opResults: {}
  };
}
function hasPendingReservationInRoundState(rs) {
  if (!rs || !rs.byTokenId) return false;
  var tids = Object.keys(rs.byTokenId);
  for (var i = 0; i < tids.length; i++) {
    var entry = rs.byTokenId[tids[i]];
    var actionState = entry && entry.actionState;
    if (!actionState) continue;
    if (typeof OS.hasPendingActionReservations === "function") {
      if (OS.hasPendingActionReservations(actionState)) return true;
    } else if (Array.isArray(actionState.ledger)) {
      if (actionState.ledger.some(function (l) { return l && l.status === "reserved"; })) return true;
    }
  }
  return false;
}
function emitTrackerLifecycleEvent(eventKey, evtPayload) {
  var rs = tracker.roundState;
  if (!rs) return null;
  if (!Array.isArray(rs.emittedEventKeys)) rs.emittedEventKeys = [];
  if (!Array.isArray(rs.eventHistory)) rs.eventHistory = [];
  if (rs.emittedEventKeys.indexOf(eventKey) >= 0) return null;
  rs.emittedEventKeys.push(eventKey);

  var evt = Object.assign(
    {
      eventId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "evt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      eventKey: eventKey,
      authoritativeSource: "server_combate_ativo",
      persistedOnServer: true,
      serverVersion: Number(evtPayload && evtPayload.version !== undefined ? evtPayload.version : (rs.serverVersion || 0)),
      timestamp: new Date().toISOString()
    },
    evtPayload
  );
  rs.eventHistory.push(deepCloneSafe(evt));

  turnEventListeners.slice().forEach(function (fn) {
    try {
      fn(deepCloneSafe(evt));
    } catch (err) {
      console.error("[TurnTrackerEvent]", err);
    }
  });
  return evt;
}
OS.onTurnTrackerEvent = function (listener) {
  if (typeof listener !== "function") return function () {};
  turnEventListeners.push(listener);
  return function () {
    var idx = turnEventListeners.indexOf(listener);
    if (idx >= 0) turnEventListeners.splice(idx, 1);
  };
};
OS.getTurnTrackerEventHistory = function (combateId) {
  var hist = (tracker.roundState && tracker.roundState.eventHistory) || [];
  if (!combateId) return deepCloneSafe(hist);
  return deepCloneSafe(hist.filter(function (e) { return e && String(e.combateId) === String(combateId); }));
};
OS.clearTurnTrackerEventHistory = function () {
  if (tracker.roundState) {
    tracker.roundState.eventHistory = [];
    tracker.roundState.emittedEventKeys = [];
  }
};
function sortCombatOrderByRoundTurn(list) {
  return list.slice().sort(function (a, b) {
    var af = a.iniciativa_fonte === "fixa" ? 1 : 0;
    var bf = b.iniciativa_fonte === "fixa" ? 1 : 0;
    if (af !== bf) return af - bf;
    if (b.iniciativa !== a.iniciativa) return b.iniciativa - a.iniciativa;
    var na = String(a.name || "");
    var nb = String(b.name || "");
    if (na !== nb) return na < nb ? -1 : 1;
    var ta = String(a.token_id || "");
    var tb = String(b.token_id || "");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}
function reconcileCombatRoundState(mesaId, beforeCombat, next) {
  if (!next || !next.ativo) {
    if (beforeCombat && beforeCombat.ativo && beforeCombat.id) {
      var closedTurnIdx = Number(beforeCombat.turno_atual_idx);
      var closedItem = Array.isArray(beforeCombat.ordem) && closedTurnIdx >= 0 ? beforeCombat.ordem[closedTurnIdx] : null;
      var closedRound = Math.max(1, parseInt(String(beforeCombat.round || 1), 10) || 1);
      var closedTid = closedItem ? String(closedItem.token_id) : "hidden";
      emitTrackerLifecycleEvent(
        beforeCombat.id + ":TURN_ENDED:" + closedRound + ":" + closedTurnIdx + ":" + closedTid,
        {
          type: "TURN_ENDED",
          mesaId: mesaId,
          combateId: beforeCombat.id,
          mapaId: beforeCombat.mapa_id || null,
          round: closedRound,
          version: Number(beforeCombat.versao || 1),
          turnIndex: closedTurnIdx,
          combatantId: closedItem ? String(closedItem.token_id) : null,
          ownerRef: closedItem && closedItem.owner_ref ? String(closedItem.owner_ref) : null,
          hiddenTurn: !closedItem
        }
      );
      emitTrackerLifecycleEvent(beforeCombat.id + ":ROUND_ENDED:" + closedRound, {
        type: "ROUND_ENDED",
        mesaId: mesaId,
        combateId: beforeCombat.id,
        mapaId: beforeCombat.mapa_id || null,
        round: closedRound,
        version: Number(beforeCombat.versao || 1),
        combatantId: null
      });
    }
    tracker.roundState = createEmptyRoundState();
    OS.clearCanonicalCombatPersistence(mesaId);
    return { staleIgnored: false, combat: next };
  }

  var rs = tracker.roundState || (tracker.roundState = createEmptyRoundState());
  var nextId = next.id ? String(next.id) : null;
  var nextRound = Math.max(1, parseInt(String(next.round || 1), 10) || 1);
  var nextVersion = Number(next.versao || 1);
  var nextMapaId = next.mapa_id ? String(next.mapa_id) : (OS.activeMesaState && OS.activeMesaState.activeMapId) || null;
  var ordem = Array.isArray(next.ordem) ? next.ordem.slice() : [];

  // Rejeita eventos de rodada anterior ou versão obsoleta recebidos fora de ordem.
  if (rs.combatId && nextId && rs.combatId === nextId) {
    if (nextRound < rs.round) {
      return { staleIgnored: true, combat: beforeCombat };
    }
    if (nextRound === rs.round && nextVersion < rs.serverVersion) {
      return { staleIgnored: true, combat: beforeCombat };
    }
  }

  // Hidrata cache local não autoritativo após refresh apenas se coincidir com combate/rodada do servidor.
  // Dados locais nunca sobrescrevem estado mais recente no servidor nem ressuscitam reservas não confirmadas.
  var hydratedFromPersistence = false;
  if (!rs.combatId || (nextId && rs.combatId !== nextId)) {
    var persisted = loadPersistedCanonicalState(mesaId, nextId);
    if (
      persisted &&
      nextId &&
      String(persisted.combatId || "") === nextId &&
      Number(persisted.round || 0) === nextRound &&
      Number(persisted.serverVersion || 0) <= nextVersion
    ) {
      var persistedSameServerVersion = Number(persisted.serverVersion || 0) === nextVersion;
      var sanitizedByToken = {};
      Object.keys(persisted.byTokenId || {}).forEach(function (tid) {
        var rawE = persisted.byTokenId[tid];
        if (!rawE || typeof rawE !== "object") return;
        var cleanAction =
          persistedSameServerVersion &&
          rawE.actionState &&
          rawE.actionState.persistedOnServer === true &&
          String(rawE.actionState.combateId || "") === nextId &&
          Number(rawE.actionState.round) === nextRound
            ? deepCloneSafe(rawE.actionState)
            : null;
        sanitizedByToken[tid] = {
          tokenId: tid,
          currentInitiative: rawE.currentInitiative,
          nextRoundInitiative: rawE.nextRoundInitiative !== undefined ? rawE.nextRoundInitiative : null,
          initiativeSource: rawE.initiativeSource || "ficha",
          turnEnded: !!rawE.turnEnded,
          budget: deepCloneSafe(rawE.budget || null),
          actionState: cleanAction
        };
      });
      rs.combatId = nextId;
      rs.mapaId = persisted.mapaId || nextMapaId;
      rs.round = Number(persisted.round || nextRound);
      rs.serverVersion = Number(persisted.serverVersion || 0);
      rs.byTokenId = sanitizedByToken;
      rs.orderIds = Array.isArray(persisted.orderIds) ? persisted.orderIds.slice() : [];
      rs.opportunities = persistedSameServerVersion && Array.isArray(persisted.opportunities)
        ? deepCloneSafe(persisted.opportunities)
        : [];
      rs.requests = persistedSameServerVersion && Array.isArray(persisted.requests)
        ? deepCloneSafe(persisted.requests)
        : [];
      rs.emittedEventKeys = Array.isArray(persisted.emittedEventKeys) ? persisted.emittedEventKeys.slice() : [];
      rs.eventHistory = Array.isArray(persisted.eventHistory) ? persisted.eventHistory.slice() : [];
      rs.lastTurnIdx = typeof persisted.lastTurnIdx === "number" ? persisted.lastTurnIdx : -1;
      rs.lastTurnTokenId = persisted.lastTurnTokenId || null;
      hydratedFromPersistence = true;
    } else if (persisted) {
      OS.clearCanonicalCombatPersistence(mesaId);
    }
  }

  var isSameCombat = !!(rs.combatId && nextId && rs.combatId === nextId);

  if (!isSameCombat) {
    rs.combatId = nextId;
    rs.mapaId = nextMapaId;
    rs.round = nextRound;
    rs.serverVersion = nextVersion;
    rs.byTokenId = {};
    rs.orderIds = [];
    rs.opportunities = Array.isArray(next.oportunidades_reacao) ? deepCloneSafe(next.oportunidades_reacao) : [];
    rs.requests = Array.isArray(next.solicitacoes_reacao) ? deepCloneSafe(next.solicitacoes_reacao) : [];
    rs.emittedEventKeys = [];
    rs.eventHistory = [];
    rs.lastTurnIdx = -1;
    rs.lastTurnTokenId = null;

    ordem.forEach(function (item) {
      var tid = String(item.token_id || "");
      var srvCurr = item.current_initiative !== undefined ? item.current_initiative
        : item.currentInitiative !== undefined ? item.currentInitiative
        : item.iniciativa;
      var srvNext = item.next_round_initiative !== undefined ? item.next_round_initiative
        : item.nextRoundInitiative !== undefined ? item.nextRoundInitiative
        : null;
      var srvTurnEnded = !!(item.action_state && typeof item.action_state === "object" && item.action_state.turnEnded === true);
      var initVal = normTrackerInit(srvCurr);
      var entry = {
        tokenId: tid,
        currentInitiative: initVal,
        nextRoundInitiative: srvNext !== null ? normTrackerInit(srvNext) : null,
        initiativeSource: item.iniciativa_fonte || "ficha",
        turnEnded: srvTurnEnded,
        budget: null,
        actionState: null
      };
      item.currentInitiative = entry.currentInitiative;
      item.iniciativa = entry.currentInitiative;
      item.nextRoundInitiative = entry.nextRoundInitiative;
      entry.budget = computeBudgetForCombatItem(item, nextRound, entry.currentInitiative);
      entry.actionState = createActionStateForItem(item, nextRound, next, entry.budget, null);
      if (entry.actionState && item.action_state && typeof item.action_state === "object") {
        entry.turnEnded = !!entry.actionState.turnEnded;
      }
      item.actionBudget = entry.budget;
      item.actionState = entry.actionState;
      rs.byTokenId[tid] = entry;
      rs.orderIds.push(tid);
    });
    next.ordem = ordem;
    next.oportunidades_reacao = deepCloneSafe(rs.opportunities);
    next.solicitacoes_reacao = deepCloneSafe(rs.requests);

    var initIdx = Number(next.turno_atual_idx);
    var initTurnItem = initIdx >= 0 && initIdx < ordem.length ? ordem[initIdx] : null;
    emitTrackerLifecycleEvent(nextId + ":ROUND_STARTED:" + nextRound, {
      type: "ROUND_STARTED",
      mesaId: mesaId,
      combateId: nextId,
      mapaId: nextMapaId,
      round: nextRound,
      version: nextVersion,
      combatantId: null
    });
    if (initTurnItem || next.turno_oculto) {
      var initTurnKeyTid = initTurnItem ? String(initTurnItem.token_id) : "hidden";
      emitTrackerLifecycleEvent(nextId + ":TURN_STARTED:" + nextRound + ":" + initIdx + ":" + initTurnKeyTid, {
        type: "TURN_STARTED",
        mesaId: mesaId,
        combateId: nextId,
        mapaId: nextMapaId,
        round: nextRound,
        version: nextVersion,
        turnIndex: initIdx,
        combatantId: initTurnItem ? String(initTurnItem.token_id) : null,
        ownerRef: initTurnItem && initTurnItem.owner_ref ? String(initTurnItem.owner_ref) : null,
        hiddenTurn: !initTurnItem
      });
      rs.lastTurnIdx = initIdx;
      rs.lastTurnTokenId = initTurnItem ? String(initTurnItem.token_id) : null;
    }

    savePersistedCanonicalState(mesaId);
    return { staleIgnored: false, combat: next };
  }

  if (nextRound === rs.round) {
    var prevTurnIdx = rs.lastTurnIdx;
    var prevTurnTokenId = rs.lastTurnTokenId;
    var prevByToken = deepCloneSafe(rs.byTokenId || {});
    rs.serverVersion = Math.max(rs.serverVersion, nextVersion);
    if (nextMapaId) rs.mapaId = nextMapaId;

    var byIncomingId = {};
    ordem.forEach(function (item) {
      byIncomingId[String(item.token_id || "")] = item;
    });
    var preservedIds = [];
    rs.orderIds.forEach(function (tid) {
      if (byIncomingId[tid]) preservedIds.push(tid);
    });
    ordem.forEach(function (item) {
      var tid = String(item.token_id || "");
      if (preservedIds.indexOf(tid) < 0) preservedIds.push(tid);
    });

    var rebuiltOrdem = [];
    var nextMap = {};
    var activeCurrentTid =
      ordem[next.turno_atual_idx] && ordem[next.turno_atual_idx].token_id
        ? String(ordem[next.turno_atual_idx].token_id)
        : null;

    preservedIds.forEach(function (tid) {
      var item = byIncomingId[tid];
      if (!item) return;
      var prev = prevByToken[tid];
      var serverInit = normTrackerInit(item.iniciativa);
      var srvCurr = item.current_initiative !== undefined ? item.current_initiative
        : item.currentInitiative !== undefined ? item.currentInitiative
        : null;
      var srvNext = item.next_round_initiative !== undefined ? item.next_round_initiative
        : item.nextRoundInitiative !== undefined ? item.nextRoundInitiative
        : null;
      var hasServerTurnEnded = !!(item.action_state && typeof item.action_state === "object" && typeof item.action_state.turnEnded === "boolean");
      var entry;
      if (!prev) {
        entry = {
          tokenId: tid,
          currentInitiative: srvCurr !== null ? normTrackerInit(srvCurr) : serverInit,
          nextRoundInitiative: srvNext !== null ? normTrackerInit(srvNext) : null,
          initiativeSource: item.iniciativa_fonte || "fixa",
          turnEnded: hasServerTurnEnded ? !!item.action_state.turnEnded : false,
          budget: null,
          actionState: null
        };
      } else {
        var frozenCurr = srvCurr !== null ? normTrackerInit(srvCurr) : prev.currentInitiative;
        var nextRoundVal = srvNext !== null ? normTrackerInit(srvNext) : prev.nextRoundInitiative;
        if (item.iniciativa_fonte === "ficha") {
          if (serverInit !== frozenCurr) {
            nextRoundVal = serverInit;
          }
        }
        entry = {
          tokenId: tid,
          currentInitiative: frozenCurr,
          nextRoundInitiative: nextRoundVal,
          initiativeSource: item.iniciativa_fonte || prev.initiativeSource || "ficha",
          turnEnded: hasServerTurnEnded ? !!item.action_state.turnEnded : !!prev.turnEnded,
          budget: null,
          actionState: prev.actionState || null
        };
      }
      item.currentInitiative = entry.currentInitiative;
      item.iniciativa = entry.currentInitiative;
      item.nextRoundInitiative = entry.nextRoundInitiative;
      entry.budget = computeBudgetForCombatItem(item, rs.round, entry.currentInitiative);
      entry.actionState = createActionStateForItem(item, rs.round, next, entry.budget, entry.actionState);
      if (hasServerTurnEnded) {
        entry.turnEnded = !!item.action_state.turnEnded;
        entry.actionState.turnEnded = entry.turnEnded;
      } else {
        entry.actionState.turnEnded = !!entry.turnEnded;
      }
      item.actionBudget = entry.budget;
      item.actionState = entry.actionState;
      nextMap[tid] = entry;
      rebuiltOrdem.push(item);
    });

    rs.byTokenId = nextMap;
    rs.orderIds = preservedIds;
    if (Array.isArray(next.oportunidades_reacao)) {
      rs.opportunities = deepCloneSafe(next.oportunidades_reacao);
    } else if (!Array.isArray(rs.opportunities)) {
      rs.opportunities = [];
    }
    if (Array.isArray(next.solicitacoes_reacao)) {
      rs.requests = deepCloneSafe(next.solicitacoes_reacao);
    } else if (!Array.isArray(rs.requests)) {
      rs.requests = [];
    }
    next.ordem = rebuiltOrdem;
    next.oportunidades_reacao = deepCloneSafe(rs.opportunities);
    next.solicitacoes_reacao = deepCloneSafe(rs.requests);
    if (activeCurrentTid) {
      var newIdx = rebuiltOrdem.findIndex(function (c) { return String(c.token_id) === activeCurrentTid; });
      if (newIdx >= 0) next.turno_atual_idx = newIdx;
    }

    var newTurnIdx = Number(next.turno_atual_idx);
    var newTurnItem = newTurnIdx >= 0 && newTurnIdx < rebuiltOrdem.length ? rebuiltOrdem[newTurnIdx] : null;
    var newTurnTid = newTurnItem ? String(newTurnItem.token_id) : null;
    if (
      prevTurnIdx !== newTurnIdx ||
      (prevTurnTokenId || null) !== (newTurnTid || null)
    ) {
      if (prevTurnIdx >= 0 && (prevTurnTokenId || !hydratedFromPersistence)) {
        var prevTurnEntry = prevTurnTokenId ? rs.byTokenId[prevTurnTokenId] : null;
        if (prevTurnEntry) {
          prevTurnEntry.turnEnded = true;
          if (prevTurnEntry.actionState) prevTurnEntry.actionState.turnEnded = true;
        }
        emitTrackerLifecycleEvent(
          nextId + ":TURN_ENDED:" + rs.round + ":" + prevTurnIdx + ":" + (prevTurnTokenId || "hidden"),
          {
            type: "TURN_ENDED",
            mesaId: mesaId,
            combateId: nextId,
            mapaId: nextMapaId,
            round: rs.round,
            version: nextVersion,
            turnIndex: prevTurnIdx,
            combatantId: prevTurnTokenId,
            hiddenTurn: !prevTurnTokenId
          }
        );
      }
      if (newTurnItem || next.turno_oculto) {
        if (newTurnTid && rs.byTokenId[newTurnTid]) {
          rs.byTokenId[newTurnTid].turnEnded = false;
          if (rs.byTokenId[newTurnTid].actionState) rs.byTokenId[newTurnTid].actionState.turnEnded = false;
        }
        emitTrackerLifecycleEvent(
          nextId + ":TURN_STARTED:" + rs.round + ":" + newTurnIdx + ":" + (newTurnTid || "hidden"),
          {
            type: "TURN_STARTED",
            mesaId: mesaId,
            combateId: nextId,
            mapaId: nextMapaId,
            round: rs.round,
            version: nextVersion,
            turnIndex: newTurnIdx,
            combatantId: newTurnTid,
            ownerRef: newTurnItem && newTurnItem.owner_ref ? String(newTurnItem.owner_ref) : null,
            hiddenTurn: !newTurnItem
          }
        );
      }
      rs.lastTurnIdx = newTurnIdx;
      rs.lastTurnTokenId = newTurnTid;
    }

    savePersistedCanonicalState(mesaId);
    return { staleIgnored: false, combat: next };
  }

  // Virada válida de rodada (nextRound > rs.round): fecha turno e rodada anteriores e promove iniciativas.
  var prevEndedRound = rs.round;
  var prevEndedTurnIdx = rs.lastTurnIdx;
  var prevEndedTurnTid = rs.lastTurnTokenId;
  if (prevEndedRound > 0) {
    if (prevEndedTurnIdx >= 0) {
      emitTrackerLifecycleEvent(
        nextId + ":TURN_ENDED:" + prevEndedRound + ":" + prevEndedTurnIdx + ":" + (prevEndedTurnTid || "hidden"),
        {
          type: "TURN_ENDED",
          mesaId: mesaId,
          combateId: nextId,
          mapaId: nextMapaId,
          round: prevEndedRound,
          version: nextVersion,
          turnIndex: prevEndedTurnIdx,
          combatantId: prevEndedTurnTid,
          hiddenTurn: !prevEndedTurnTid
        }
      );
    }
    emitTrackerLifecycleEvent(nextId + ":ROUND_ENDED:" + prevEndedRound, {
      type: "ROUND_ENDED",
      mesaId: mesaId,
      combateId: nextId,
      mapaId: nextMapaId,
      round: prevEndedRound,
      version: nextVersion,
      combatantId: null
    });
  }

  rs.round = nextRound;
  rs.serverVersion = nextVersion;
  if (nextMapaId) rs.mapaId = nextMapaId;
  var promotedMap = {};
  var needsLocalResort = false;
  var turnTargetId =
    ordem[next.turno_atual_idx] && ordem[next.turno_atual_idx].token_id
      ? String(ordem[next.turno_atual_idx].token_id)
      : null;

  ordem.forEach(function (item) {
    var tid = String(item.token_id || "");
    var prev = rs.byTokenId[tid];
    var serverInit = normTrackerInit(item.iniciativa);
    var srvCurr = item.current_initiative !== undefined ? item.current_initiative
      : item.currentInitiative !== undefined ? item.currentInitiative
      : null;
    var promotedInit = srvCurr !== null ? normTrackerInit(srvCurr) : serverInit;
    if (srvCurr === null && item.iniciativa_fonte === "ficha" && prev) {
      if (serverInit !== prev.currentInitiative) {
        promotedInit = serverInit;
      } else if (prev.nextRoundInitiative !== null && prev.nextRoundInitiative !== undefined) {
        promotedInit = normTrackerInit(prev.nextRoundInitiative);
      }
      if (promotedInit !== serverInit) needsLocalResort = true;
    }
    var entry = {
      tokenId: tid,
      currentInitiative: promotedInit,
      nextRoundInitiative: null,
      initiativeSource: item.iniciativa_fonte || "ficha",
      turnEnded: false,
      budget: null,
      actionState: null
    };
    item.currentInitiative = entry.currentInitiative;
    item.iniciativa = entry.currentInitiative;
    item.nextRoundInitiative = null;
    entry.budget = computeBudgetForCombatItem(item, nextRound, entry.currentInitiative);
    // Novo round gera orçamento e actionState limpos sem transportar saldo nem reservas anteriores.
    entry.actionState = createActionStateForItem(item, nextRound, next, entry.budget, null);
    item.actionBudget = entry.budget;
    item.actionState = entry.actionState;
    promotedMap[tid] = entry;
  });

  if (needsLocalResort) {
    ordem = sortCombatOrderByRoundTurn(ordem);
    if (next.turno_atual_idx === 0 && turnTargetId && ordem.length > 0) {
      next.turno_atual_idx = 0;
    } else if (turnTargetId) {
      var sortedIdx = ordem.findIndex(function (c) { return String(c.token_id) === turnTargetId; });
      if (sortedIdx >= 0) next.turno_atual_idx = sortedIdx;
    }
  }

  rs.byTokenId = promotedMap;
  rs.orderIds = ordem.map(function (c) { return String(c.token_id || ""); });
  rs.opportunities = Array.isArray(next.oportunidades_reacao) ? deepCloneSafe(next.oportunidades_reacao) : [];
  rs.requests = Array.isArray(next.solicitacoes_reacao) ? deepCloneSafe(next.solicitacoes_reacao) : [];
  next.ordem = ordem;
  next.oportunidades_reacao = deepCloneSafe(rs.opportunities);
  next.solicitacoes_reacao = deepCloneSafe(rs.requests);

  var rTurnIdx = Number(next.turno_atual_idx);
  var rTurnItem = rTurnIdx >= 0 && rTurnIdx < ordem.length ? ordem[rTurnIdx] : null;
  var rTurnTid = rTurnItem ? String(rTurnItem.token_id) : null;
  emitTrackerLifecycleEvent(nextId + ":ROUND_STARTED:" + nextRound, {
    type: "ROUND_STARTED",
    mesaId: mesaId,
    combateId: nextId,
    mapaId: nextMapaId,
    round: nextRound,
    version: nextVersion,
    combatantId: null
  });
  if (rTurnItem || next.turno_oculto) {
    emitTrackerLifecycleEvent(
      nextId + ":TURN_STARTED:" + nextRound + ":" + rTurnIdx + ":" + (rTurnTid || "hidden"),
      {
        type: "TURN_STARTED",
        mesaId: mesaId,
        combateId: nextId,
        mapaId: nextMapaId,
        round: nextRound,
        version: nextVersion,
        turnIndex: rTurnIdx,
        combatantId: rTurnTid,
        ownerRef: rTurnItem && rTurnItem.owner_ref ? String(rTurnItem.owner_ref) : null,
        hiddenTurn: !rTurnItem
      }
    );
  }
  rs.lastTurnIdx = rTurnIdx;
  rs.lastTurnTokenId = rTurnTid;

  savePersistedCanonicalState(mesaId);
  return { staleIgnored: false, combat: next };
}

OS.resetMesaCombat = function (options) {
  options = options || {};
  var prevMesa = tracker.mesaId || (OS.activeMesaState && OS.activeMesaState.mesaId);
  if (options.clearPersisted && prevMesa) {
    OS.clearCanonicalCombatPersistence(prevMesa);
  }
  tracker.mesaId = null; tracker.revision = -1; tracker.request++;
  tracker.minimized = false; tracker.busy = false; tracker.position = null; tracker.error = "";
  tracker.selectedTokenId = null; tracker.actionBarBusy = false; tracker.actionBarFeedback = "";
  tracker.gmOppDraft.open = false;
  tracker.roundState = createEmptyRoundState();
  OS.activeMesaState.combateAtivo = null;
  closeCombatDialog("modal-setup-combate"); closeCombatDialog("modal-end-combate");
  OS.renderMesaCombat();
};

OS.acceptMesaCombatSnapshot = function (mesaId, snapshot) {
  var st = OS.activeMesaState;
  if (st.mesaId !== mesaId || !snapshot) return;
  if (Number(snapshot.revisao) < tracker.revision) return;
  var before = st.combateAtivo;
  var incomingCombat = snapshot.combate || null;
  if (tracker.mesaId !== mesaId) tracker.mesaId = mesaId;

  var rec = reconcileCombatRoundState(mesaId, before, incomingCombat);
  if (rec.staleIgnored) return;

  tracker.revision = Number(snapshot.revisao) || 0;
  var next = rec.combat;
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

function findActiveCombatItemAndEntry(tokenIdOrRef) {
  var st = OS.activeMesaState;
  var state = st && st.combateAtivo;
  if (!state || !state.ativo || !Array.isArray(state.ordem)) return null;
  var needle = String(tokenIdOrRef || "");
  if (!needle) return null;
  var itemIndex = state.ordem.findIndex(function (c) {
    return c && (String(c.token_id) === needle || String(c.owner_ref) === needle);
  });
  if (itemIndex < 0) return null;
  var item = state.ordem[itemIndex];
  var tid = String(item.token_id);
  var entry = tracker.roundState && tracker.roundState.byTokenId ? tracker.roundState.byTokenId[tid] : null;
  return { item: item, itemIndex: itemIndex, entry: entry, tokenId: tid, state: state };
}

OS.recordNextRoundInitiative = function (tokenIdOrRef, newInitiative) {
  var found = findActiveCombatItemAndEntry(tokenIdOrRef);
  if (!found || found.item.iniciativa_fonte !== "ficha") return null;
  var nextVal = normTrackerInit(newInitiative);
  if (found.entry) {
    found.entry.nextRoundInitiative = nextVal === found.entry.currentInitiative ? null : nextVal;
  }
  found.item.nextRoundInitiative =
    found.entry ? found.entry.nextRoundInitiative : nextVal === normTrackerInit(found.item.currentInitiative) ? null : nextVal;
  // Persiste para recuperação após refresh/reconexão sem alterar currentInitiative nem orçamento vigente.
  var st = OS.activeMesaState;
  savePersistedCanonicalState((st && st.mesaId) || tracker.mesaId);
  OS.renderMesaCombat();
  return found.item;
};

OS.getCombatantInitiativeState = function (tokenIdOrRef) {
  var found = findActiveCombatItemAndEntry(tokenIdOrRef);
  if (!found) return null;
  var curr = found.entry ? found.entry.currentInitiative : normTrackerInit(found.item.currentInitiative !== undefined ? found.item.currentInitiative : found.item.iniciativa);
  var nextVal = found.entry ? found.entry.nextRoundInitiative : (found.item.nextRoundInitiative !== undefined ? found.item.nextRoundInitiative : null);
  return {
    tokenId: found.tokenId,
    ownerRef: found.item.owner_ref || null,
    round: found.state.round || 1,
    currentInitiative: curr,
    nextRoundInitiative: nextVal,
    initiativeSource: found.item.iniciativa_fonte || "ficha",
    enteredMidRound: !!found.item.entrou_no_meio
  };
};

OS.getCombatantActionBudget = function (tokenIdOrRef) {
  var found = findActiveCombatItemAndEntry(tokenIdOrRef);
  if (!found) return null;
  return found.item.actionBudget || (found.entry && found.entry.budget) || null;
};

OS.recalculateCombatantTurnBudget = function (tokenIdOrRef) {
  var found = findActiveCombatItemAndEntry(tokenIdOrRef);
  if (!found) return null;
  var curr = found.entry ? found.entry.currentInitiative : normTrackerInit(found.item.currentInitiative !== undefined ? found.item.currentInitiative : found.item.iniciativa);
  var budget = computeBudgetForCombatItem(found.item, found.state.round || 1, curr);
  if (found.entry) {
    found.entry.budget = budget;
    if (found.entry.actionState) {
      found.entry.actionState = createActionStateForItem(found.item, found.state.round || 1, found.state, budget, found.entry.actionState);
      found.item.actionState = found.entry.actionState;
    }
  }
  found.item.actionBudget = budget;
  var st = OS.activeMesaState;
  savePersistedCanonicalState((st && st.mesaId) || tracker.mesaId);
  OS.renderMesaCombat();
  return budget;
};

function resolveActorUserIdSync() {
  var st = OS.activeMesaState;
  if (OS.authSession && OS.authSession.userId) return String(OS.authSession.userId);
  if (st && st.currentUserId) return String(st.currentUserId);
  return null;
}

async function resolveAuthenticatedActorUserId() {
  var syncId = resolveActorUserIdSync();
  if (syncId) return syncId;
  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (client && client.auth && typeof client.auth.getUser === "function") {
    try {
      var res = await client.auth.getUser();
      var uid = res && res.data && res.data.user && res.data.user.id;
      if (uid) return String(uid);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function isActorAuthorizedForCombatant(found, actorUserId) {
  var st = OS.activeMesaState || {};
  if (!actorUserId) return false;
  if (st.isMestre) return true;
  if (found.item.owner_type !== "player") return false;
  var tok = Array.isArray(st.mesaTokens)
    ? st.mesaTokens.find(function (t) { return t && String(t.id) === String(found.tokenId); })
    : null;
  if (tok && tok.owner_user_id && String(tok.owner_user_id) !== String(actorUserId)) {
    return false;
  }
  var sheet = Array.isArray(st.playerSheets)
    ? st.playerSheets.find(function (r) { return r && String(r.id) === String(found.item.owner_ref); })
    : null;
  if (sheet && sheet.usuario_id) {
    return String(sheet.usuario_id) === String(actorUserId);
  }
  if (tok && tok.owner_user_id) {
    return String(tok.owner_user_id) === String(actorUserId);
  }
  return !!(st.playerFichaId && String(found.item.owner_ref) === String(st.playerFichaId));
}

function getCanonicalActionStateForFound(found) {
  if (!found) return null;
  var rNum = found.state.round || 1;
  var currInit = found.entry ? found.entry.currentInitiative : normTrackerInit(found.item.currentInitiative !== undefined ? found.item.currentInitiative : found.item.iniciativa);
  if (found.entry && found.entry.actionState && Number(found.entry.actionState.round) === Number(rNum)) {
    return found.entry.actionState;
  }
  if (found.item.actionState && Number(found.item.actionState.round) === Number(rNum)) {
    return found.item.actionState;
  }
  var budget = found.item.actionBudget || computeBudgetForCombatItem(found.item, rNum, currInit);
  var created = createActionStateForItem(found.item, rNum, found.state, budget, null);
  if (found.entry) found.entry.actionState = created;
  found.item.actionState = created;
  return created;
}

function computeDerivedAvailable(actionState) {
  if (typeof OS.computeAvailableActionsFromState === "function") {
    return OS.computeAvailableActionsFromState(actionState);
  }
  if (!actionState || !actionState.budgetDefined || actionState.initialBudget === null) return null;
  var spent = 0, reserved = 0;
  (actionState.ledger || []).forEach(function (e) {
    if (!e) return;
    if (e.status === "committed") spent += Number(e.cost) || 0;
    else if (e.status === "reserved") reserved += Number(e.cost) || 0;
  });
  return Math.max(0, Number(actionState.initialBudget) - spent - reserved);
}

function executeActionControllerMutation(operation, req) {
  req = req || {};
  var job = actionControllerChain.catch(function () {}).then(async function () {
    var actorUserId = await resolveAuthenticatedActorUserId();
    if (!actorUserId) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "UNAUTHENTICATED_USER", sqlstate: "42501" };
    }
    var st = OS.activeMesaState;
    var state = st && st.combateAtivo;
    if (!st || !st.mesaId || !state || !state.ativo) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "NO_ACTIVE_COMBAT", sqlstate: "22023" };
    }

    if (req.combateId !== undefined && req.combateId !== null && state.id && String(req.combateId) !== String(state.id)) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "COMBAT_MISMATCH", sqlstate: "40001" };
    }
    var targetMapaId = req.mapaId !== undefined ? req.mapaId : st.activeMapId;
    if (state.mapa_id && targetMapaId && String(targetMapaId) !== String(state.mapa_id)) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "MAP_MISMATCH", sqlstate: "22023" };
    }
    if (req.round !== undefined && req.round !== null && Number(req.round) !== Number(state.round || 1)) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "ROUND_MISMATCH", sqlstate: "22023" };
    }

    var found = findActiveCombatItemAndEntry(req.combatantId);
    if (!found) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "COMBATANT_NOT_IN_COMBAT", sqlstate: "22023" };
    }
    if (!isActorAuthorizedForCombatant(found, actorUserId)) {
      return { ok: false, unavailable: false, persistedOnServer: false, idempotentReplay: false, errorCode: "UNAUTHORIZED_COMBATANT_ACCESS", sqlstate: "42501" };
    }

    var actionState = getCanonicalActionStateForFound(found);
    var opId = String(req.opId || "").trim();
    if (!opId) {
      return {
        ok: false,
        unavailable: false,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: "MISSING_OP_ID",
        sqlstate: "22023",
        state: deepCloneSafe(actionState)
      };
    }

    var opLower = String(operation || "").trim().toLowerCase();
    var actionKey = String(req.actionType || "").trim().toLowerCase();
    var reasonText = String(req.reason !== undefined ? req.reason : (req.justificativa || "")).trim();
    var isReaction = !!req.isReaction;

    if (opLower === "reserve" && actionKey === "custom") {
      if (st.isMestre !== true) {
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: "CUSTOM_ACTION_REQUIRES_GM",
          sqlstate: "42501",
          state: deepCloneSafe(actionState)
        };
      }
      var customCostNum = Number(req.cost);
      if (
        req.cost === undefined ||
        req.cost === null ||
        req.cost === "" ||
        typeof req.cost === "boolean" ||
        !Number.isFinite(customCostNum) ||
        Math.trunc(customCostNum) !== customCostNum ||
        customCostNum < 1 ||
        customCostNum > 10
      ) {
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: "INVALID_CUSTOM_ACTION_COST",
          sqlstate: "22023",
          state: deepCloneSafe(actionState)
        };
      }
      if (!reasonText) {
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: "CUSTOM_ACTION_REQUIRES_JUSTIFICATION",
          sqlstate: "22023",
          state: deepCloneSafe(actionState)
        };
      }
    }

    if (isReaction) {
      var allowedReactions =
        (Array.isArray(OS.ALLOWED_REACTION_ACTION_TYPES) && OS.ALLOWED_REACTION_ACTION_TYPES) ||
        ["ataque_oportunidade", "reacao", "custom"];
      if ((opLower === "reserve" || actionKey) && allowedReactions.indexOf(actionKey) < 0) {
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: "INVALID_REACTION_ACTION_TYPE",
          sqlstate: "22023",
          state: deepCloneSafe(actionState)
        };
      }
      if (st.isMestre !== true || req.gmAuthorizedReaction === false) {
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: "REACTION_REQUIRES_GM_AUTHORIZATION",
          sqlstate: "42501",
          state: deepCloneSafe(actionState)
        };
      }
    }

    // Reservas, confirmações e cancelamentos reais exigem RPC autoritativa confirmada no servidor.
    // Sem fallback local autoritativo: indisponibilidade retorna erro explícito sem mutar estado nem cache local.
    var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
    if (!client || typeof client.rpc !== "function" || req.localOnly) {
      return {
        ok: false,
        unavailable: true,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: "ACTION_CONTROLLER_RPC_UNAVAILABLE",
        sqlstate: "PGRST202",
        message: "RPC autoritativa gerenciar_acao_combate indisponível.",
        state: deepCloneSafe(actionState)
      };
    }

    try {
      var rpcRes = await client.rpc("gerenciar_acao_combate", {
        p_mesa_id: st.mesaId,
        p_combate_id: req.combateId !== undefined && req.combateId !== null ? req.combateId : state.id,
        p_token_id: found.tokenId,
        p_operacao: operation,
        p_op_id: opId,
        p_action_type: req.actionType || null,
        p_cost: req.cost !== undefined ? req.cost : null,
        p_reservation_id: req.reservationId || req.targetOpId || null,
        p_is_reaction: isReaction,
        p_result_revealed: req.resultRevealed !== undefined ? !!req.resultRevealed : null,
        p_mapa_id: targetMapaId || state.mapa_id || null,
        p_round: req.round !== undefined ? req.round : (state.round || 1),
        p_expected_version: req.expectedVersion !== undefined ? req.expectedVersion : null,
        p_justificativa: reasonText || null
      });
      var rpcErr = rpcRes && rpcRes.error;
      if (rpcErr) {
        var errCode = rpcErr.code || rpcErr.status || rpcErr.details || "RPC_ERROR";
        var errMsg = String(rpcErr.message || "");
        var rpcMissing =
          errCode === "PGRST202" ||
          errCode === "42883" ||
          errMsg.indexOf("Could not find the function") >= 0 ||
          (errMsg.indexOf("gerenciar_acao_combate") >= 0 && errMsg.indexOf("does not exist") >= 0);
        if (rpcMissing) {
          return {
            ok: false,
            unavailable: true,
            persistedOnServer: false,
            idempotentReplay: false,
            errorCode: "ACTION_CONTROLLER_RPC_UNAVAILABLE",
            sqlstate: String(errCode || "PGRST202"),
            message: errMsg || "Action Controller indisponível no servidor.",
            state: deepCloneSafe(actionState)
          };
        }
        if (String(errCode) === "40001" || String(errCode) === "P0409" || String(errCode) === "PT409" || String(errCode) === "409") {
          Promise.resolve(OS.loadMesaCombat()).catch(function () {});
        }
        return {
          ok: false,
          unavailable: false,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: errMsg || String(errCode),
          sqlstate: String(errCode),
          message: errMsg || null,
          state: deepCloneSafe(actionState)
        };
      }
      if (rpcRes && rpcRes.data && rpcRes.data.result) {
        if (rpcRes.data.combate || rpcRes.data.revisao !== undefined) {
          OS.acceptMesaCombatSnapshot(st.mesaId, {
            combate: rpcRes.data.combate || state,
            revisao: rpcRes.data.revisao !== undefined ? rpcRes.data.revisao : tracker.revision + 1
          });
        } else if (rpcRes.data.action_state && typeof rpcRes.data.action_state === "object") {
          var confirmedAs = deepCloneSafe(rpcRes.data.action_state);
          confirmedAs.persistedOnServer = true;
          if (found.entry) found.entry.actionState = confirmedAs;
          found.item.actionState = confirmedAs;
          found.item.action_state = confirmedAs;
          savePersistedCanonicalState(st.mesaId);
          OS.renderMesaCombat();
        }
        var serverOut = deepCloneSafe(rpcRes.data.result);
        serverOut.unavailable = false;
        serverOut.persistedOnServer = true;
        return serverOut;
      }
      return {
        ok: false,
        unavailable: false,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: "INVALID_RPC_RESPONSE",
        sqlstate: null,
        state: deepCloneSafe(actionState)
      };
    } catch (rpcEx) {
      var exMsg = String((rpcEx && rpcEx.message) || "");
      var exCode = (rpcEx && (rpcEx.code || rpcEx.status)) || "NETWORK_ERROR";
      var isMissingEx =
        exCode === "PGRST202" ||
        exCode === "42883" ||
        exMsg.indexOf("PGRST202") >= 0 ||
        exMsg.indexOf("42883") >= 0 ||
        exMsg.indexOf("Could not find the function") >= 0;
      return {
        ok: false,
        unavailable: isMissingEx,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: isMissingEx ? "ACTION_CONTROLLER_RPC_UNAVAILABLE" : (exMsg || "RPC_NETWORK_ERROR"),
        sqlstate: isMissingEx ? String(exCode || "PGRST202") : String(exCode),
        message: exMsg || null,
        state: deepCloneSafe(actionState)
      };
    }
  });

  actionControllerChain = job;
  return job;
}

function generateCombatOpId(prefix) {
  var base = String(prefix || "op");
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return base + "_" + crypto.randomUUID();
  }
  return base + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

function resolveCombatantSheetAnd6B(found) {
  var st = OS.activeMesaState || {};
  if (!found || !found.item) return { token: null, sheetData: null, instance6BState: null };
  var tid = String(found.tokenId || found.item.token_id || "");
  var token = Array.isArray(st.mesaTokens)
    ? st.mesaTokens.find(function (t) { return t && String(t.id) === tid; }) || null
    : null;
  var sheetData = null;
  var instance6BState = null;
  if (found.item.owner_type === "player") {
    var sheetRow = Array.isArray(st.playerSheets)
      ? st.playerSheets.find(function (r) { return r && String(r.id) === String(found.item.owner_ref); }) || null
      : null;
    sheetData = (sheetRow && sheetRow.dados) || null;
  } else {
    var inst = Array.isArray(st.sceneCreatures)
      ? st.sceneCreatures.find(function (c) { return c && String(c.instanceId) === String(found.item.owner_ref); }) || null
      : null;
    sheetData = (inst && inst.data) || null;
    if (st.instance6BById && found.item.owner_ref) {
      instance6BState = st.instance6BById[String(found.item.owner_ref)] || null;
    }
  }
  return { token: token, sheetData: sheetData, instance6BState: instance6BState };
}

function getFallbackTurnPhase(state, item, itemIndex) {
  if (!state || !state.ativo || !item) return "round_ended";
  var as = item.actionState || item.action_state || null;
  if (as && as.turnEnded === true) return "post_turn";
  var turnIdx = Number(state.turno_atual_idx);
  if (itemIndex >= 0 && turnIdx >= 0 && itemIndex === turnIdx) return "active_turn";
  if (itemIndex >= 0 && turnIdx >= 0 && itemIndex < turnIdx && !item.entrou_no_meio) return "post_turn";
  return "pre_turn";
}

function buildActionSummaryForFound(found) {
  if (!found) return null;
  var rs = tracker.roundState || {};
  if (typeof OS.summarizeCombatantActionEconomy === "function") {
    return OS.summarizeCombatantActionEconomy(found.state, found.item, {
      itemIndex: found.itemIndex,
      opportunities: rs.opportunities || found.state.oportunidades_reacao || [],
      requests: rs.requests || found.state.solicitacoes_reacao || []
    });
  }
  var as = getCanonicalActionStateForFound(found);
  var avail = computeDerivedAvailable(as);
  var phase = getFallbackTurnPhase(found.state, found.item, found.itemIndex);
  var opps = (rs.opportunities || []).filter(function (o) {
    return o && o.status === "open" && String(o.combatantId) === String(found.tokenId) && Number(o.round) === Number(found.state.round || 1);
  });
  var reqs = (rs.requests || []).filter(function (r) {
    return r && r.status === "pending" && String(r.combatantId) === String(found.tokenId) && Number(r.round) === Number(found.state.round || 1);
  });
  return {
    combatantId: found.tokenId,
    round: found.state.round || 1,
    turnPhase: phase,
    turnPhaseLabel: phase === "active_turn" ? "Turno ativo" : phase === "post_turn" ? "Turno encerrado (reações válidas)" : phase === "pre_turn" ? "Antes da própria vez (requer Xerife)" : "Rodada encerrada",
    actionsExpired: phase === "round_ended",
    budgetDefined: !!(as && as.budgetDefined),
    pendingReason: as ? as.pendingReason : null,
    initialBudget: as && as.budgetDefined ? as.initialBudget : null,
    spentActions: as ? Number(as.spentActions || 0) : 0,
    reservedActions: as ? Number(as.reservedActions || 0) : 0,
    availableActions: avail,
    reactionsAvailableCount: avail != null ? avail : 0,
    canPerformOrdinaryAction: phase === "active_turn" && avail > 0,
    canExecutePostTurnReaction: (phase === "post_turn" || phase === "active_turn") && avail > 0 && opps.length > 0,
    canRequestEarlyReaction: phase === "pre_turn" && avail > 0 && reqs.length === 0,
    hasPendingReservation: !!(as && Array.isArray(as.ledger) && as.ledger.some(function (l) { return l && l.status === "reserved"; })),
    pendingReservations: as && Array.isArray(as.ledger) ? as.ledger.filter(function (l) { return l && l.status === "reserved"; }) : [],
    openOpportunities: opps,
    pendingEarlyRequests: reqs,
    actionStateVersion: as && as.version ? Number(as.version) : 1,
    blockReasons: []
  };
}

function executeReactionControllerMutation(operation, req) {
  req = req || {};
  var job = actionControllerChain.catch(function () {}).then(async function () {
    var actorUserId = await resolveAuthenticatedActorUserId();
    if (!actorUserId) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "UNAUTHENTICATED_USER", sqlstate: "42501" };
    }
    var st = OS.activeMesaState;
    var state = st && st.combateAtivo;
    if (!st || !st.mesaId || !state || !state.ativo) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "NO_ACTIVE_COMBAT", sqlstate: "22023" };
    }
    if (req.combateId !== undefined && req.combateId !== null && state.id && String(req.combateId) !== String(state.id)) {
      return { ok: false, unavailable: false, conflict: true, persistedOnServer: false, idempotentReplay: false, errorCode: "COMBAT_MISMATCH", sqlstate: "PT409" };
    }
    var targetMapaId = req.mapaId !== undefined ? req.mapaId : st.activeMapId;
    if (state.mapa_id && targetMapaId && String(targetMapaId) !== String(state.mapa_id)) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "MAP_MISMATCH", sqlstate: "22023" };
    }
    if (req.round !== undefined && req.round !== null && Number(req.round) !== Number(state.round || 1)) {
      return { ok: false, unavailable: false, conflict: true, persistedOnServer: false, idempotentReplay: false, errorCode: "ROUND_MISMATCH", sqlstate: "PT409" };
    }

    var opLower = String(operation || "").trim().toLowerCase();
    var opId = String(req.opId || "").trim();
    if (!opId) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "MISSING_OP_ID", sqlstate: "22023" };
    }

    var gmOnlyOps = ["open_opportunity", "close_opportunity", "approve_early_reaction", "deny_early_reaction"];
    if (gmOnlyOps.indexOf(opLower) >= 0 && st.isMestre !== true) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "REACTION_REQUIRES_GM_AUTHORIZATION", sqlstate: "42501" };
    }

    var resolvedTokenId = req.combatantId || req.tokenId || null;
    if (!resolvedTokenId && req.requestId) {
      var foundReq = (tracker.roundState.requests || []).find(function (r) { return r && String(r.requestId) === String(req.requestId); });
      if (foundReq) resolvedTokenId = foundReq.combatantId;
    }
    if (!resolvedTokenId && req.opportunityId) {
      var foundOpp = (tracker.roundState.opportunities || []).find(function (o) { return o && String(o.opportunityId) === String(req.opportunityId); });
      if (foundOpp) resolvedTokenId = foundOpp.combatantId;
    }

    var found = resolvedTokenId ? findActiveCombatItemAndEntry(resolvedTokenId) : null;
    if (!found && opLower !== "close_opportunity" && opLower !== "approve_early_reaction" && opLower !== "deny_early_reaction" && opLower !== "cancel_early_reaction") {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "COMBATANT_NOT_IN_COMBAT", sqlstate: "22023" };
    }
    if (found && !isActorAuthorizedForCombatant(found, actorUserId)) {
      return { ok: false, unavailable: false, conflict: false, persistedOnServer: false, idempotentReplay: false, errorCode: "UNAUTHORIZED_COMBATANT_ACCESS", sqlstate: "42501" };
    }

    var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
    if (!client || typeof client.rpc !== "function" || req.localOnly) {
      return {
        ok: false,
        unavailable: true,
        conflict: false,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: "REACTION_CONTROLLER_RPC_UNAVAILABLE",
        sqlstate: "PGRST202",
        message: "RPC autoritativa gerenciar_reacao_combate indisponível."
      };
    }

    try {
      var rpcRes = await client.rpc("gerenciar_reacao_combate", {
        p_mesa_id: st.mesaId,
        p_combate_id: req.combateId !== undefined && req.combateId !== null ? req.combateId : state.id,
        p_token_id: found ? found.tokenId : (resolvedTokenId || null),
        p_operacao: opLower,
        p_op_id: opId,
        p_action_type: req.actionType || "reacao",
        p_cost: req.cost !== undefined ? req.cost : null,
        p_opportunity_id: req.opportunityId || null,
        p_request_id: req.requestId || null,
        p_target_token_id: req.targetTokenId || null,
        p_reach_meters: req.reachMeters !== undefined && req.reachMeters !== null && req.reachMeters !== "" ? Number(req.reachMeters) : null,
        p_range_confirmed: !!req.rangeConfirmedByGm,
        p_passive_skill: req.passiveSkillKey || null,
        p_passive_skill_required: req.passiveSkillRequired !== undefined ? !!req.passiveSkillRequired : null,
        p_passive_skill_confirmed: !!req.passiveSkillConfirmedByGm,
        p_trigger_label: req.triggerLabel || req.triggerSummary || null,
        p_mapa_id: targetMapaId || state.mapa_id || null,
        p_round: req.round !== undefined ? req.round : (state.round || 1),
        p_expected_combat_version: req.expectedCombatVersion !== undefined ? req.expectedCombatVersion : null,
        p_expected_action_version: req.expectedActionVersion !== undefined ? req.expectedActionVersion : null,
        p_justificativa: (req.reason || req.justificativa || "").trim() || null
      });

      var rpcErr = rpcRes && rpcRes.error;
      if (rpcErr) {
        var errCode = String(rpcErr.code || rpcErr.status || rpcErr.details || "RPC_ERROR");
        var errMsg = String(rpcErr.message || "");
        var rpcMissing =
          errCode === "PGRST202" ||
          errCode === "42883" ||
          errMsg.indexOf("Could not find the function") >= 0 ||
          (errMsg.indexOf("gerenciar_reacao_combate") >= 0 && errMsg.indexOf("does not exist") >= 0);
        if (rpcMissing) {
          return {
            ok: false,
            unavailable: true,
            conflict: false,
            persistedOnServer: false,
            idempotentReplay: false,
            errorCode: "REACTION_CONTROLLER_RPC_UNAVAILABLE",
            sqlstate: errCode || "PGRST202",
            message: errMsg || "Controle de reações indisponível no servidor."
          };
        }
        var isConflict =
          errCode === "PT409" ||
          errCode === "P0409" ||
          errCode === "40001" ||
          errCode === "409" ||
          Number(rpcErr.status) === 409;
        if (isConflict) {
          Promise.resolve(OS.loadMesaCombat()).catch(function () {});
        }
        return {
          ok: false,
          unavailable: false,
          conflict: isConflict,
          persistedOnServer: false,
          idempotentReplay: false,
          errorCode: isConflict ? "REACTION_STATE_CONFLICT" : (errMsg || errCode),
          sqlstate: errCode,
          message: errMsg || "Falha ao processar operação de reação."
        };
      }

      if (rpcRes && rpcRes.data && rpcRes.data.result) {
        if (rpcRes.data.combate || rpcRes.data.revisao !== undefined) {
          OS.acceptMesaCombatSnapshot(st.mesaId, {
            combate: rpcRes.data.combate || state,
            revisao: rpcRes.data.revisao !== undefined ? rpcRes.data.revisao : tracker.revision + 1
          });
        }
        var out = deepCloneSafe(rpcRes.data.result);
        out.unavailable = false;
        out.conflict = false;
        out.persistedOnServer = true;
        return out;
      }

      return {
        ok: false,
        unavailable: false,
        conflict: false,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: "INVALID_RPC_RESPONSE",
        sqlstate: null
      };
    } catch (rpcEx) {
      var exMsg = String((rpcEx && rpcEx.message) || "");
      var exCode = String((rpcEx && (rpcEx.code || rpcEx.status)) || "NETWORK_ERROR");
      var isMissingEx =
        exCode === "PGRST202" ||
        exCode === "42883" ||
        exMsg.indexOf("PGRST202") >= 0 ||
        exMsg.indexOf("42883") >= 0 ||
        exMsg.indexOf("Could not find the function") >= 0;
      return {
        ok: false,
        unavailable: isMissingEx,
        conflict: false,
        persistedOnServer: false,
        idempotentReplay: false,
        errorCode: isMissingEx ? "REACTION_CONTROLLER_RPC_UNAVAILABLE" : (exMsg || "RPC_NETWORK_ERROR"),
        sqlstate: isMissingEx ? (exCode || "PGRST202") : exCode,
        message: exMsg || null
      };
    }
  });

  actionControllerChain = job;
  return job;
}

OS.combatActionController = {
  getRoundBudget: function (combatantId) {
    var b = OS.getCombatantActionBudget(combatantId);
    return b ? deepCloneSafe(b) : null;
  },
  getAvailableActions: function (combatantId) {
    var found = findActiveCombatItemAndEntry(combatantId);
    if (!found) return null;
    var actionState = getCanonicalActionStateForFound(found);
    return computeDerivedAvailable(actionState);
  },
  getActionState: function (combatantId) {
    var found = findActiveCombatItemAndEntry(combatantId);
    if (!found) return null;
    var actionState = getCanonicalActionStateForFound(found);
    var copy = deepCloneSafe(actionState);
    copy.availableActions = computeDerivedAvailable(copy);
    return copy;
  },
  getAuditHistory: function (combatantId) {
    var found = findActiveCombatItemAndEntry(combatantId);
    if (!found) return [];
    var actionState = getCanonicalActionStateForFound(found);
    return deepCloneSafe((actionState && actionState.auditLog) || []);
  },
  getTurnPhase: function (combatantId) {
    var found = findActiveCombatItemAndEntry(combatantId);
    if (!found) return "round_ended";
    if (typeof OS.deriveCombatantTurnPhase === "function") {
      return OS.deriveCombatantTurnPhase(found.state, found.item, { itemIndex: found.itemIndex });
    }
    return getFallbackTurnPhase(found.state, found.item, found.itemIndex);
  },
  getActionSummary: function (combatantId) {
    var found = findActiveCombatItemAndEntry(combatantId);
    if (!found) return null;
    return deepCloneSafe(buildActionSummaryForFound(found));
  },
  getReactionOpportunities: function (combatantId) {
    var list = (tracker.roundState && Array.isArray(tracker.roundState.opportunities)) ? tracker.roundState.opportunities : [];
    if (!combatantId) return deepCloneSafe(list);
    return deepCloneSafe(list.filter(function (o) { return o && String(o.combatantId) === String(combatantId); }));
  },
  getReactionRequests: function (combatantId) {
    var list = (tracker.roundState && Array.isArray(tracker.roundState.requests)) ? tracker.roundState.requests : [];
    if (!combatantId) return deepCloneSafe(list);
    return deepCloneSafe(list.filter(function (r) { return r && String(r.combatantId) === String(combatantId); }));
  },
  evaluateOpportunity: function (params) {
    params = params || {};
    var st = OS.activeMesaState || {};
    var state = st.combateAtivo || null;
    var found = params.combatantId ? findActiveCombatItemAndEntry(params.combatantId) : null;
    var ctx = found ? resolveCombatantSheetAnd6B(found) : { token: null, sheetData: null, instance6BState: null };
    var targetToken = params.targetToken || null;
    if (!targetToken && params.targetTokenId && Array.isArray(st.mesaTokens)) {
      targetToken = st.mesaTokens.find(function (t) { return t && String(t.id) === String(params.targetTokenId); }) || null;
    }
    if (typeof OS.evaluateContextualOpportunity === "function") {
      return OS.evaluateContextualOpportunity(Object.assign({
        combatState: state,
        mesaId: st.mesaId || null,
        activeMesaId: st.mesaId || null,
        mapaId: st.activeMapId || (state && state.mapa_id) || null,
        round: state ? state.round : 0,
        isMestre: !!st.isMestre,
        reactorToken: ctx.token,
        targetToken: targetToken,
        sheetData: ctx.sheetData,
        instance6BState: ctx.instance6BState
      }, params));
    }
    return null;
  },
  reserveAction: function (req) {
    return executeActionControllerMutation("reserve", req);
  },
  commitReservation: function (req) {
    return executeActionControllerMutation("commit", req);
  },
  cancelReservation: function (req) {
    return executeActionControllerMutation("cancel", req);
  },
  openOpportunity: function (req) {
    return executeReactionControllerMutation("open_opportunity", req);
  },
  closeOpportunity: function (req) {
    return executeReactionControllerMutation("close_opportunity", req);
  },
  executeOpportunityReaction: function (req) {
    return executeReactionControllerMutation("execute_opportunity_reaction", req);
  },
  requestEarlyReaction: function (req) {
    return executeReactionControllerMutation("request_early_reaction", req);
  },
  approveEarlyReaction: function (req) {
    return executeReactionControllerMutation("approve_early_reaction", req);
  },
  denyEarlyReaction: function (req) {
    return executeReactionControllerMutation("deny_early_reaction", req);
  },
  cancelEarlyReaction: function (req) {
    return executeReactionControllerMutation("cancel_early_reaction", req);
  }
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
  if (
    action === "proximo" &&
    state &&
    Array.isArray(state.ordem) &&
    Number(state.turno_atual_idx) + 1 >= state.ordem.length &&
    hasPendingReservationInRoundState(tracker.roundState)
  ) {
    tracker.error = "Resolva ou cancele as reservas de ação pendentes antes de encerrar a rodada.";
    OS.renderMesaCombat();
    return false;
  }
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
  if (!token || token.owner_type === "player") return "ficha";
  var st = OS.activeMesaState;
  var instance = (st && Array.isArray(st.sceneCreatures) ? st.sceneCreatures : []).find(function (c) {
    return c && c.instanceId === token.owner_ref;
  });
  if (!instance) return "ficha";
  var source = (st && Array.isArray(st.npcsMesa) ? st.npcsMesa : []).find(function (c) {
    return c && c.mesaNpcId === instance.sourceId;
  });
  var byId = (OS.bestiaryCatalog && OS.bestiaryCatalog.byId) || {};
  var official = byId[(source && source.sourceId) || instance.sourceId];
  var data = instance.data || {};
  var sourceData = (source && source.data) || {};

  // Prioriza modalidade explícita (COM-03/COM-04) sem alterar a natureza da ficha
  var modeChoice = OS.extractCreatureModeChoice
    ? OS.extractCreatureModeChoice(instance)
    : null;
  if (modeChoice === null && OS.extractCreatureModeChoice && source) {
    modeChoice = OS.extractCreatureModeChoice(source);
  }
  if (modeChoice === null) {
    var rawOp = instance.operationalMode !== undefined ? instance.operationalMode
      : data.operationalMode !== undefined ? data.operationalMode
      : source && source.operationalMode !== undefined ? source.operationalMode
      : sourceData.operationalMode;
    if (rawOp === "creature_mode") modeChoice = true;
    else if (rawOp === "full_sheet") modeChoice = false;
    else {
      var rawFlag = instance.isCriatura !== undefined ? instance.isCriatura
        : data.isCriatura !== undefined ? data.isCriatura
        : data["is-criatura"] !== undefined ? data["is-criatura"]
        : source && source.isCriatura !== undefined ? source.isCriatura
        : sourceData.isCriatura !== undefined ? sourceData.isCriatura
        : sourceData["is-criatura"];
      if (rawFlag === true) modeChoice = true;
      else if (rawFlag === false) modeChoice = false;
    }
  }

  if (modeChoice === true) return "cascata";
  if (modeChoice === false) return "ficha";

  // Fallback legado e monstros oficiais sem operationalMode explícito
  var category = String(instance.sourceCategory || (source && source.sourceCategory) || (official && official.category) || "").toLowerCase();
  if (OS.resolveCombatantInitiativeMode) {
    return OS.resolveCombatantInitiativeMode({
      kind: "npc_human",
      operationalMode: null,
      isOfficialMonster: instance.sourceType === "oficial" && category !== "npc" && data.tipo_ficha !== "npc" && !data.isBestiaryCustom,
      category: category,
      tipoFicha: data.tipo_ficha,
      isBestiaryCustom: data.isBestiaryCustom,
      sourceType: instance.sourceType
    });
  }
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
    if (!player && mode === "ficha" && OS.normalizeMesaInitiative(token.iniciativa) === 0 && OS.resolveIndividual6BInitiative) {
      var instSetup = (st.sceneCreatures || []).find(function (c) { return c && c.instanceId === token.owner_ref; });
      var opSetup = instSetup && OS.resolveCombatantOperationalInfo ? OS.resolveCombatantOperationalInfo(instSetup) : null;
      if (opSetup && opSetup.operationalMode === "full_sheet" && opSetup.kind !== "bestiary_monster" && instSetup.data) {
        var derived6B = OS.resolveIndividual6BInitiative(instSetup.data);
        if (derived6B !== 0) {
          token.iniciativa = derived6B;
          instSetup.data.iniciativa = String(derived6B);
          instSetup.data._initiativeFrom6B = true;
          if (OS.syncSceneTokenInitiative) OS.syncSceneTokenInitiative(instSetup);
        }
      }
    }
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

OS.syncContextualActionBarSelection = function (tokenId) {
  var st = OS.activeMesaState;
  var state = st && st.combateAtivo;
  if (!state || !state.ativo || !Array.isArray(state.ordem)) return;
  if (tokenId && state.ordem.some(function (c) { return c && String(c.token_id) === String(tokenId); })) {
    tracker.selectedTokenId = String(tokenId);
    OS.renderMesaCombat();
  }
};

function resolveSelectedCombatantForBar(st, state) {
  var ordem = Array.isArray(state.ordem) ? state.ordem : [];
  if (!ordem.length) return null;
  var uid = resolveActorUserIdSync();
  var tokens = Array.isArray(st.mesaTokens) ? st.mesaTokens : [];
  var byId = {};
  tokens.forEach(function (t) { if (t && t.id) byId[String(t.id)] = t; });

  if (tracker.selectedTokenId) {
    var explicit = ordem.find(function (c) { return c && String(c.token_id) === String(tracker.selectedTokenId); });
    if (explicit) return explicit;
  }
  if (!st.isMestre) {
    var owned = ordem.find(function (c) {
      return c && isTokenOwnedByCurrentUser(byId[String(c.token_id)] || null, c, st, uid);
    });
    if (owned) {
      tracker.selectedTokenId = String(owned.token_id);
      return owned;
    }
  }
  var active = ordem[state.turno_atual_idx] || ordem[0];
  if (active) tracker.selectedTokenId = String(active.token_id);
  return active || null;
}

function formatActionBarResultMessage(res, okLabel) {
  if (!res) return "Sem resposta do servidor.";
  if (res.ok) {
    return res.idempotentReplay ? okLabel + " (confirmado via idempotência)." : okLabel;
  }
  if (res.conflict || res.sqlstate === "PT409" || res.sqlstate === "P0409" || res.sqlstate === "40001") {
    return "Conflito de estado detectado (" + (res.sqlstate || "PT409") + "): " + (res.message || "estado recarregado do servidor.");
  }
  return res.message || res.errorCode || "Operação não autorizada ou inválida.";
}

function runActionBarCommand(fn, okLabel) {
  if (tracker.actionBarBusy || tracker.busy) return Promise.resolve(null);
  tracker.actionBarBusy = true;
  tracker.actionBarFeedback = "";
  OS.renderMesaCombat();
  return Promise.resolve()
    .then(fn)
    .then(function (res) {
      tracker.actionBarFeedback = formatActionBarResultMessage(res, okLabel);
      return res;
    })
    .catch(function (err) {
      tracker.actionBarFeedback = (err && err.message) || "Erro ao executar ação de combate.";
      return null;
    })
    .finally(function () {
      tracker.actionBarBusy = false;
      OS.renderMesaCombat();
    });
}

function renderContextualActionBar(st, state) {
  var bar = $combat("mesa-tracker-action-bar");
  if (!bar) return;
  if (!st || !st.mesaId || !state || !state.ativo) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }

  var selected = resolveSelectedCombatantForBar(st, state);
  var allReqs = Array.isArray(tracker.roundState.requests) ? tracker.roundState.requests : (state.solicitacoes_reacao || []);
  var allOpps = Array.isArray(tracker.roundState.opportunities) ? tracker.roundState.opportunities : (state.oportunidades_reacao || []);
  var globalPendingGmReqs = st.isMestre
    ? allReqs.filter(function (r) { return r && r.status === "pending" && Number(r.round) === Number(state.round || 1); })
    : [];

  bar.hidden = false;
  bar.innerHTML = "";

  if (!selected) {
    bar.innerHTML = '<div class="mesa-action-block-note">Nenhum combatente disponível para a barra contextual.</div>';
    return;
  }

  var found = findActiveCombatItemAndEntry(selected.token_id);
  var uid = resolveActorUserIdSync();
  var canOperate = !!(found && isActorAuthorizedForCombatant(found, uid));
  var canInspectPrivate = !!(st.isMestre || canOperate);

  bar.dataset.selectedCombatant = String(selected.token_id);

  if (!canInspectPrivate) {
    var pubHead = document.createElement("div");
    pubHead.className = "mesa-action-bar-head";
    pubHead.innerHTML =
      '<span class="mesa-action-bar-title">🎯 ' + combatEscape(selected.name) + '</span>' +
      '<span class="mesa-action-phase-badge">Round ' + combatEscape(state.round) + ' · Somente leitura</span>';
    var pubNote = document.createElement("div");
    pubNote.className = "mesa-action-block-note";
    pubNote.textContent = "Selecione seu próprio personagem para visualizar saldo, ações válidas e reações.";
    bar.append(pubHead, pubNote);
    return;
  }

  var catalog = Array.isArray(OS.CONTEXTUAL_ACTION_CATALOG) && OS.CONTEXTUAL_ACTION_CATALOG.length
    ? OS.CONTEXTUAL_ACTION_CATALOG
    : [
        { key: "atacar", label: "Atacar", category: "ordinary", cost: 1, resources: "1 ação · arma ou ataque natural + 6B" },
        { key: "mover", label: "Mover", category: "ordinary", cost: 1, resources: "1 ação · deslocamento tático" },
        { key: "mirar", label: "Mirar", category: "ordinary", cost: 1, resources: "1 ação · arma à distância" },
        { key: "recarregar", label: "Recarregar", category: "ordinary", cost: 1, resources: "1 ação · munição" },
        { key: "usar_item", label: "Usar Item", category: "ordinary", cost: 1, resources: "1 ação · item" },
        { key: "ataque_oportunidade", label: "Ataque de Oportunidade", category: "reaction", cost: 1, resources: "1 ação · corpo a corpo · teste passivo" },
        { key: "reacao", label: "Reação", category: "reaction", cost: 1, resources: "1 ação · gatilho autorizado pelo Xerife" }
      ];

  var vm = typeof OS.evaluateContextualBarCommands === "function"
    ? OS.evaluateContextualBarCommands({
        combatState: state,
        selectedItem: selected,
        isMestre: !!st.isMestre,
        currentUserId: uid,
        canOperateCombatant: canOperate,
        selectedActionType: tracker.selectedActionType,
        opportunities: allOpps,
        requests: allReqs,
        busy: !!(tracker.busy || tracker.actionBarBusy)
      })
    : {
        summary: buildActionSummaryForFound(found),
        selectedAction: catalog.find(function (c) { return c.key === tracker.selectedActionType; }) || catalog[0],
        canReserveOrdinary: false,
        reserveBlockedReason: "Motor contextual carregando.",
        canRequestEarlyReaction: false,
        earlyRequestBlockedReason: null,
        canOpenOpportunity: !!st.isMestre,
        pendingReservations: [],
        openOpportunities: [],
        pendingRequests: []
      };

  var sum = vm.summary;
  bar.dataset.turnPhase = String(sum.turnPhase || "round_ended");

  // 1. Cabeçalho: combatente, rodada e condição do turno
  var head = document.createElement("div");
  head.className = "mesa-action-bar-head";
  head.innerHTML =
    '<span class="mesa-action-bar-title">🎯 ' + combatEscape(selected.name) + '</span>' +
    '<span class="mesa-action-phase-badge phase-' + combatEscape(sum.turnPhase) + '">' +
    'R' + combatEscape(state.round) + ' · ' + combatEscape(sum.turnPhaseLabel) + '</span>';
  bar.appendChild(head);

  // 2. Contadores somente-leitura (sem inputs editáveis)
  var counters = document.createElement("div");
  counters.className = "mesa-action-counters";
  var availTxt = sum.budgetDefined && sum.availableActions !== null ? String(sum.availableActions) : "—";
  var reactTxt = sum.budgetDefined ? String(sum.reactionsAvailableCount || 0) : "—";
  counters.innerHTML =
    '<div class="mesa-action-counter"><span>Disponíveis</span><strong data-stat="available">' + combatEscape(availTxt) + '</strong></div>' +
    '<div class="mesa-action-counter"><span>Reservadas</span><strong data-stat="reserved">' + combatEscape(sum.reservedActions) + '</strong></div>' +
    '<div class="mesa-action-counter"><span>Gastas</span><strong data-stat="spent">' + combatEscape(sum.spentActions) + '</strong></div>' +
    '<div class="mesa-action-counter"><span>Reações</span><strong data-stat="reactions">' + combatEscape(reactTxt) + '</strong></div>';
  bar.appendChild(counters);

  // 3. Seletor de ação + custo + recursos + botão de reservar ação ordinária
  var controlsRow = document.createElement("div");
  controlsRow.className = "mesa-action-controls-row";
  var sel = document.createElement("select");
  sel.className = "mesa-action-select";
  sel.id = "mesa-action-bar-select";
  sel.setAttribute("aria-label", "Ação contextual selecionada");
  catalog.forEach(function (act) {
    var opt = document.createElement("option");
    opt.value = act.key;
    opt.textContent = act.label + " (" + act.cost + (act.cost === 1 ? " ação)" : " ações)") + (act.category === "reaction" ? " · Reação" : "");
    if (act.key === vm.selectedAction.key) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", function () {
    tracker.selectedActionType = sel.value;
    OS.renderMesaCombat();
  });

  var btnReserve = document.createElement("button");
  btnReserve.type = "button";
  btnReserve.id = "btn-action-bar-reserve";
  btnReserve.className = "btn btn-primary btn-small";
  btnReserve.textContent = "Reservar (" + vm.selectedAction.cost + ")";
  btnReserve.disabled = !vm.canReserveOrdinary;
  if (vm.reserveBlockedReason) btnReserve.title = vm.reserveBlockedReason;
  btnReserve.addEventListener("click", function () {
    runActionBarCommand(function () {
      return OS.combatActionController.reserveAction({
        combatantId: selected.token_id,
        opId: generateCombatOpId("res"),
        actionType: vm.selectedAction.key,
        cost: vm.selectedAction.cost,
        isReaction: false,
        round: state.round,
        combateId: state.id,
        mapaId: state.mapa_id,
        expectedVersion: sum.actionStateVersion
      });
    }, "Ação reservada (" + vm.selectedAction.label + ")");
  });
  controlsRow.append(sel, btnReserve);
  bar.appendChild(controlsRow);

  var metaEl = document.createElement("div");
  metaEl.className = "mesa-action-meta";
  metaEl.textContent =
    "Custo: " + vm.selectedAction.cost + (vm.selectedAction.cost === 1 ? " ação" : " ações") +
    " · Recursos: " + vm.selectedAction.resources;
  bar.appendChild(metaEl);

  // 4. Reservas pendentes (Confirmar / Cancelar)
  if (vm.pendingReservations.length > 0) {
    var resWrap = document.createElement("div");
    resWrap.className = "mesa-action-sublist";
    vm.pendingReservations.forEach(function (resItem) {
      var card = document.createElement("div");
      card.className = "mesa-action-subitem";
      card.dataset.reservationId = resItem.reservationId;
      var cHead = document.createElement("div");
      cHead.className = "mesa-action-subitem-head";
      cHead.textContent = "⏳ Reserva: " + resItem.actionType + " (" + resItem.cost + " ação)";
      var btns = document.createElement("div");
      btns.className = "mesa-action-subitem-btns";
      var btnCommit = document.createElement("button");
      btnCommit.type = "button";
      btnCommit.className = "btn btn-primary btn-small";
      btnCommit.dataset.cmd = "commit-reservation";
      btnCommit.textContent = "Confirmar";
      btnCommit.disabled = !resItem.canCommit;
      btnCommit.addEventListener("click", function () {
        runActionBarCommand(function () {
          return OS.combatActionController.commitReservation({
            combatantId: selected.token_id,
            opId: generateCombatOpId("cmt"),
            reservationId: resItem.reservationId,
            resultRevealed: true,
            round: state.round,
            combateId: state.id,
            mapaId: state.mapa_id,
            expectedVersion: sum.actionStateVersion
          });
        }, "Ação confirmada");
      });
      var btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "btn btn-secondary btn-small";
      btnCancel.dataset.cmd = "cancel-reservation";
      btnCancel.textContent = "Cancelar";
      btnCancel.disabled = !resItem.canCancel;
      btnCancel.addEventListener("click", function () {
        runActionBarCommand(function () {
          return OS.combatActionController.cancelReservation({
            combatantId: selected.token_id,
            opId: generateCombatOpId("cnc"),
            reservationId: resItem.reservationId,
            round: state.round,
            combateId: state.id,
            mapaId: state.mapa_id,
            expectedVersion: sum.actionStateVersion
          });
        }, "Reserva cancelada");
      });
      btns.append(btnCommit, btnCancel);
      card.append(cHead, btns);
      resWrap.appendChild(card);
    });
    bar.appendChild(resWrap);
  }

  // 5. Oportunidades abertas para este combatente (COM-09 / COM-11)
  if (vm.openOpportunities.length > 0) {
    var oppWrap = document.createElement("div");
    oppWrap.className = "mesa-action-sublist";
    vm.openOpportunities.forEach(function (oppCmd) {
      var oppRaw = sum.openOpportunities.find(function (o) { return o && o.opportunityId === oppCmd.opportunityId; }) || oppCmd;
      var card = document.createElement("div");
      card.className = "mesa-action-subitem";
      card.dataset.opportunityId = oppCmd.opportunityId;
      var oHead = document.createElement("div");
      oHead.className = "mesa-action-subitem-head";
      oHead.textContent = "⚡ Oportunidade: " + oppCmd.triggerLabel + " (" + oppCmd.cost + " ação)";
      var oMeta = document.createElement("div");
      oMeta.className = "mesa-action-subitem-meta";
      var distTxt = oppRaw.gridDistanceMeters !== null && oppRaw.gridDistanceMeters !== undefined
        ? "Distância: " + oppRaw.gridDistanceMeters + "m"
        : oppRaw.rangeConfirmedByGm ? "Alcance confirmado pelo Xerife" : "Alcance narrativo";
      var passTxt = oppRaw.passiveSkillRequired ? " · Teste passivo (" + (oppRaw.passiveSkillKey || "corpo a corpo") + ")" : "";
      oMeta.textContent = distTxt + passTxt + (oppCmd.reason ? " · " + oppCmd.reason : "");
      var btns = document.createElement("div");
      btns.className = "mesa-action-subitem-btns";

      if (oppCmd.canExecuteDirectly) {
        var btnExec = document.createElement("button");
        btnExec.type = "button";
        btnExec.className = "btn btn-primary btn-small";
        btnExec.dataset.cmd = "execute-opportunity";
        btnExec.textContent = "Confirmar Reação";
        btnExec.addEventListener("click", function () {
          runActionBarCommand(function () {
            return OS.combatActionController.executeOpportunityReaction({
              combatantId: selected.token_id,
              opId: generateCombatOpId("xop"),
              opportunityId: oppCmd.opportunityId,
              actionType: oppCmd.actionType,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao,
              expectedActionVersion: sum.actionStateVersion
            });
          }, "Reação executada");
        });
        btns.appendChild(btnExec);
      } else if (oppCmd.canRequestEarly) {
        var btnReqOpp = document.createElement("button");
        btnReqOpp.type = "button";
        btnReqOpp.className = "btn btn-primary btn-small";
        btnReqOpp.dataset.cmd = "request-early-opportunity";
        btnReqOpp.textContent = "Solicitar Reação Antecipada";
        btnReqOpp.addEventListener("click", function () {
          runActionBarCommand(function () {
            return OS.combatActionController.requestEarlyReaction({
              combatantId: selected.token_id,
              opId: generateCombatOpId("req"),
              opportunityId: oppCmd.opportunityId,
              actionType: oppCmd.actionType,
              triggerSummary: oppCmd.triggerLabel,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao
            });
          }, "Solicitação enviada ao Xerife");
        });
        btns.appendChild(btnReqOpp);
      }

      if (oppCmd.canClose) {
        var btnClose = document.createElement("button");
        btnClose.type = "button";
        btnClose.className = "btn btn-secondary btn-small";
        btnClose.dataset.cmd = "close-opportunity";
        btnClose.textContent = "Fechar";
        btnClose.addEventListener("click", function () {
          runActionBarCommand(function () {
            return OS.combatActionController.closeOpportunity({
              combatantId: selected.token_id,
              opId: generateCombatOpId("cls"),
              opportunityId: oppCmd.opportunityId,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao
            });
          }, "Oportunidade encerrada");
        });
        btns.appendChild(btnClose);
      }

      card.append(oHead, oMeta, btns);
      oppWrap.appendChild(card);
    });
    bar.appendChild(oppWrap);
  }

  // 6. Botão de solicitar reação antecipada (COM-10) quando pré-turno sem oportunidade específica
  if (sum.turnPhase === "pre_turn") {
    var btnEarly = document.createElement("button");
    btnEarly.type = "button";
    btnEarly.id = "btn-action-bar-request-early";
    btnEarly.className = "btn btn-secondary btn-small";
    btnEarly.textContent = "Solicitar Reação Antecipada (1 ação)";
    btnEarly.disabled = !vm.canRequestEarlyReaction;
    if (vm.earlyRequestBlockedReason) btnEarly.title = vm.earlyRequestBlockedReason;
    btnEarly.addEventListener("click", function () {
      var reqActionType = vm.selectedAction.category === "reaction" ? vm.selectedAction.key : "reacao";
      runActionBarCommand(function () {
        return OS.combatActionController.requestEarlyReaction({
          combatantId: selected.token_id,
          opId: generateCombatOpId("req"),
          actionType: reqActionType,
          triggerSummary: vm.selectedAction.category === "reaction" ? vm.selectedAction.label : "Reação antecipada",
          round: state.round,
          combateId: state.id,
          mapaId: state.mapa_id,
          expectedCombatVersion: state.versao
        });
      }, "Solicitação de reação enviada ao Xerife");
    });
    bar.appendChild(btnEarly);
  }

  // 7. Solicitações pendentes aguardando o Xerife (para o selecionado ou fila completa do Xerife)
  var reqsToShow = st.isMestre ? globalPendingGmReqs : sum.pendingEarlyRequests;
  if (reqsToShow.length > 0) {
    var reqWrap = document.createElement("div");
    reqWrap.className = "mesa-action-sublist";
    reqWrap.dataset.section = "pending-requests";
    reqsToShow.forEach(function (reqItem) {
      var card = document.createElement("div");
      card.className = "mesa-action-subitem is-pending-gm";
      card.dataset.requestId = reqItem.requestId;
      var rHead = document.createElement("div");
      rHead.className = "mesa-action-subitem-head";
      rHead.textContent = "🔔 Aguardando Xerife: " + (reqItem.combatantName || reqItem.combatantId);
      var rMeta = document.createElement("div");
      rMeta.className = "mesa-action-subitem-meta";
      rMeta.textContent = (reqItem.triggerSummary || reqItem.actionType) + " · Custo: " + (reqItem.cost || 1) + " ação · Ordem de iniciativa preservada";
      var btns = document.createElement("div");
      btns.className = "mesa-action-subitem-btns";

      if (st.isMestre) {
        var btnApp = document.createElement("button");
        btnApp.type = "button";
        btnApp.className = "btn btn-primary btn-small";
        btnApp.dataset.cmd = "approve-request";
        btnApp.textContent = "Aprovar";
        btnApp.disabled = !!(tracker.busy || tracker.actionBarBusy);
        btnApp.addEventListener("click", function () {
          var targetFound = findActiveCombatItemAndEntry(reqItem.combatantId);
          var targetAs = targetFound ? getCanonicalActionStateForFound(targetFound) : null;
          runActionBarCommand(function () {
            return OS.combatActionController.approveEarlyReaction({
              combatantId: reqItem.combatantId,
              opId: generateCombatOpId("apr"),
              requestId: reqItem.requestId,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao,
              expectedActionVersion: targetAs ? targetAs.version : null
            });
          }, "Reação antecipada aprovada");
        });

        var btnDeny = document.createElement("button");
        btnDeny.type = "button";
        btnDeny.className = "btn btn-danger btn-small";
        btnDeny.dataset.cmd = "deny-request";
        btnDeny.textContent = "Negar";
        btnDeny.disabled = !!(tracker.busy || tracker.actionBarBusy);
        btnDeny.addEventListener("click", function () {
          runActionBarCommand(function () {
            return OS.combatActionController.denyEarlyReaction({
              combatantId: reqItem.combatantId,
              opId: generateCombatOpId("dny"),
              requestId: reqItem.requestId,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao
            });
          }, "Reação antecipada negada");
        });
        btns.append(btnApp, btnDeny);
      }

      var targetForCancel = findActiveCombatItemAndEntry(reqItem.combatantId);
      if (st.isMestre || (targetForCancel && isActorAuthorizedForCombatant(targetForCancel, uid))) {
        var btnCancelReq = document.createElement("button");
        btnCancelReq.type = "button";
        btnCancelReq.className = "btn btn-secondary btn-small";
        btnCancelReq.dataset.cmd = "cancel-request";
        btnCancelReq.textContent = "Cancelar";
        btnCancelReq.disabled = !!(tracker.busy || tracker.actionBarBusy);
        btnCancelReq.addEventListener("click", function () {
          runActionBarCommand(function () {
            return OS.combatActionController.cancelEarlyReaction({
              combatantId: reqItem.combatantId,
              opId: generateCombatOpId("cnr"),
              requestId: reqItem.requestId,
              round: state.round,
              combateId: state.id,
              mapaId: state.mapa_id,
              expectedCombatVersion: state.versao
            });
          }, "Solicitação cancelada");
        });
        btns.appendChild(btnCancelReq);
      }

      card.append(rHead, rMeta, btns);
      reqWrap.appendChild(card);
    });
    bar.appendChild(reqWrap);
  }

  // 8. Controles exclusivos do Xerife para indicar Oportunidade Contextual (COM-11 V1)
  if (st.isMestre) {
    var details = document.createElement("details");
    details.className = "mesa-action-gm-opp";
    details.id = "mesa-action-gm-opp-panel";
    details.open = !!tracker.gmOppDraft.open;
    details.addEventListener("toggle", function () {
      tracker.gmOppDraft.open = details.open;
    });
    var summaryEl = document.createElement("summary");
    summaryEl.textContent = "⚡ Indicar Oportunidade (Xerife)";
    details.appendChild(summaryEl);

    var body = document.createElement("div");
    body.className = "mesa-action-gm-opp-body";

    var typeLbl = document.createElement("label");
    typeLbl.textContent = "Tipo de reação";
    var typeSel = document.createElement("select");
    typeSel.id = "gm-opp-type";
    [
      { value: "ataque_oportunidade", label: "Ataque de Oportunidade (1 ação · corpo a corpo)" },
      { value: "reacao", label: "Reação Contextual (1 ação)" }
    ].forEach(function (optMeta) {
      var opt = document.createElement("option");
      opt.value = optMeta.value;
      opt.textContent = optMeta.label;
      if (tracker.gmOppDraft.actionType === optMeta.value) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener("change", function () {
      tracker.gmOppDraft.actionType = typeSel.value;
      OS.renderMesaCombat();
    });
    typeLbl.appendChild(typeSel);

    var targetLbl = document.createElement("label");
    targetLbl.textContent = "Alvo no mapa (opcional para cálculo na grade)";
    var targetSel = document.createElement("select");
    targetSel.id = "gm-opp-target";
    var emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "Sem alvo específico (confirmação manual)";
    targetSel.appendChild(emptyOpt);
    (st.mesaTokens || []).forEach(function (t) {
      if (!t || String(t.id) === String(selected.token_id)) return;
      if (state.mapa_id && t.mapa_id && String(t.mapa_id) !== String(state.mapa_id)) return;
      var o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = (t.display_name || "Token") + " (" + (t.grid_x != null ? t.grid_x : "?") + "," + (t.grid_y != null ? t.grid_y : "?") + ")";
      if (String(tracker.gmOppDraft.targetTokenId || "") === String(t.id)) o.selected = true;
      targetSel.appendChild(o);
    });
    targetSel.addEventListener("change", function () {
      tracker.gmOppDraft.targetTokenId = targetSel.value;
      OS.renderMesaCombat();
    });
    targetLbl.appendChild(targetSel);

    var trigLbl = document.createElement("label");
    trigLbl.textContent = "Gatilho / observação";
    var trigInp = document.createElement("input");
    trigInp.type = "text";
    trigInp.id = "gm-opp-trigger";
    trigInp.placeholder = "Ex.: Alvo saiu do alcance corpo a corpo";
    trigInp.value = tracker.gmOppDraft.triggerLabel || "";
    trigInp.addEventListener("input", function () {
      tracker.gmOppDraft.triggerLabel = trigInp.value;
    });
    trigLbl.appendChild(trigInp);

    var checks = document.createElement("div");
    checks.className = "mesa-action-gm-opp-checks";
    var rangeLbl = document.createElement("label");
    var rangeCb = document.createElement("input");
    rangeCb.type = "checkbox";
    rangeCb.id = "gm-opp-range-confirm";
    rangeCb.checked = !!tracker.gmOppDraft.rangeConfirmed;
    rangeCb.addEventListener("change", function () {
      tracker.gmOppDraft.rangeConfirmed = rangeCb.checked;
      OS.renderMesaCombat();
    });
    rangeLbl.append(rangeCb, document.createTextNode("Confirmar alcance"));

    var passLbl = document.createElement("label");
    var passCb = document.createElement("input");
    passCb.type = "checkbox";
    passCb.id = "gm-opp-passive-confirm";
    passCb.checked = !!tracker.gmOppDraft.passiveConfirmed;
    passCb.addEventListener("change", function () {
      tracker.gmOppDraft.passiveConfirmed = passCb.checked;
      OS.renderMesaCombat();
    });
    passLbl.append(passCb, document.createTextNode("Confirmar perícia passiva"));
    checks.append(rangeLbl, passLbl);

    var evalPreview = OS.combatActionController.evaluateOpportunity({
      combatantId: selected.token_id,
      actionType: tracker.gmOppDraft.actionType,
      targetTokenId: tracker.gmOppDraft.targetTokenId || null,
      rangeConfirmedByGm: !!tracker.gmOppDraft.rangeConfirmed,
      passiveSkillConfirmedByGm: !!tracker.gmOppDraft.passiveConfirmed
    });
    var evalNote = document.createElement("div");
    evalNote.className = "mesa-action-meta";
    if (evalPreview) {
      var parts = [];
      if (evalPreview.rangeCheck && evalPreview.rangeCheck.distanceMeters !== null) {
        parts.push("Grade: " + evalPreview.rangeCheck.distanceMeters + "m (" + evalPreview.rangeCheck.status + ")");
      }
      if (evalPreview.passiveSkillCheck && evalPreview.passiveSkillCheck.formulaPreview) {
        parts.push("Passivo: " + evalPreview.passiveSkillCheck.formulaPreview);
      }
      if (evalPreview.requiresEarlyApproval) {
        parts.push("Pré-turno: exigirá aprovação do Xerife");
      }
      if (!evalPreview.eligible && evalPreview.blockReasons.length) {
        parts.push("Pendências: " + evalPreview.blockReasons[0]);
      }
      evalNote.textContent = parts.join(" · ");
    }

    var btnOpenOpp = document.createElement("button");
    btnOpenOpp.type = "button";
    btnOpenOpp.id = "btn-gm-open-opportunity";
    btnOpenOpp.className = "btn btn-primary btn-small";
    btnOpenOpp.textContent = "Abrir Oportunidade para " + selected.name;
    btnOpenOpp.disabled = !vm.canOpenOpportunity || (evalPreview ? !evalPreview.eligible : false);
    btnOpenOpp.addEventListener("click", function () {
      runActionBarCommand(function () {
        return OS.combatActionController.openOpportunity({
          combatantId: selected.token_id,
          opId: generateCombatOpId("opp"),
          actionType: tracker.gmOppDraft.actionType,
          targetTokenId: tracker.gmOppDraft.targetTokenId || null,
          rangeConfirmedByGm: !!tracker.gmOppDraft.rangeConfirmed,
          passiveSkillConfirmedByGm: !!tracker.gmOppDraft.passiveConfirmed,
          triggerLabel: tracker.gmOppDraft.triggerLabel || null,
          round: state.round,
          combateId: state.id,
          mapaId: state.mapa_id,
          expectedCombatVersion: state.versao
        });
      }, "Oportunidade aberta para " + selected.name);
    });

    body.append(typeLbl, targetLbl, trigLbl, checks, evalNote, btnOpenOpp);
    details.appendChild(body);
    bar.appendChild(details);
  }

  // 9. Explicação explícita de bloqueios ou restrições + feedback de operação
  var blockText = (sum.blockReasons && sum.blockReasons.length > 0)
    ? sum.blockReasons[0]
    : (vm.reserveBlockedReason && !vm.canReserveOrdinary ? vm.reserveBlockedReason : "");
  if (blockText) {
    var blk = document.createElement("div");
    blk.className = "mesa-action-block-note";
    blk.dataset.section = "block-reason";
    blk.textContent = blockText;
    bar.appendChild(blk);
  }
  if (tracker.actionBarFeedback) {
    var fb = document.createElement("div");
    fb.className = "mesa-action-meta";
    fb.dataset.section = "action-bar-feedback";
    fb.textContent = tracker.actionBarFeedback;
    bar.appendChild(fb);
  }
}

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
  if (!active) {
    renderContextualActionBar(st, null);
    return;
  }
  $combat("mesa-tracker-round").textContent = "⚔️ Round " + state.round;
  $combat("btn-tracker-end").hidden = !st.isMestre;
  $combat("mesa-tracker-footer").hidden = !st.isMestre;
  $combat("btn-tracker-next").disabled = tracker.busy || !state.ordem.length;
  var current = state.ordem[state.turno_atual_idx];
  $combat("mesa-tracker-current").textContent = current ? "Vez de " + current.name :
    state.turno_oculto ? "Aguardando o Mestre" : "Nenhum participante em cena.";
  var selectedForBar = resolveSelectedCombatantForBar(st, state);
  var selectedBarId = selectedForBar ? String(selectedForBar.token_id) : null;
  var list = $combat("mesa-tracker-order"); list.innerHTML = "";
  state.ordem.forEach(function (c, index) {
    var currScore = c.currentInitiative !== undefined ? c.currentInitiative : c.iniciativa;
    var li = document.createElement("li"); li.className = "mesa-tracker-combatant";
    li.dataset.tokenId = c.token_id;
    li.dataset.currentInitiative = String(currScore);
    li.dataset.initiativeSource = String(c.iniciativa_fonte || "ficha");
    if (c.nextRoundInitiative !== null && c.nextRoundInitiative !== undefined) {
      li.dataset.nextRoundInitiative = String(c.nextRoundInitiative);
    }
    var budgetVisible = !!(st.isMestre || (st.playerFichaId && String(c.owner_ref) === String(st.playerFichaId)));
    if (budgetVisible && c.actionBudget) {
      if (c.actionBudget.budgetDefined) {
        li.dataset.actionBudget = String(c.actionBudget.initialBudget);
      } else if (c.actionBudget.pendingReason) {
        li.dataset.actionBudgetPending = String(c.actionBudget.pendingReason);
      }
    }
    if (index === state.turno_atual_idx) { li.classList.add("is-current"); li.setAttribute("aria-current", "step"); }
    if (selectedBarId && String(c.token_id) === selectedBarId) { li.classList.add("is-selected"); }
    li.addEventListener("click", function () {
      tracker.selectedTokenId = String(c.token_id);
      OS.renderMesaCombat();
    });
    var portrait = document.createElement("span"); portrait.className = "mesa-tracker-portrait"; portrait.textContent = c.owner_type === "player" ? "🤠" : "☠";
    if (c.image_url && /^(https?:|data:image\/|blob:|asset:)/i.test(c.image_url)) {
      var img = document.createElement("img"); img.src = c.image_url; img.alt = "";
      img.addEventListener("error", function () { img.remove(); }); portrait.appendChild(img);
    }
    var label = document.createElement("span"); label.className = "mesa-tracker-name"; label.textContent = c.name;
    var note = document.createElement("small");
    var baseNote = (st.isMestre && !c.visible_to_players ? "🙈 Oculto · " : "") +
      (c.entrou_no_meio ? "Entrou nesta rodada" : c.iniciativa_fonte === "cascata" ? "Cascata" : c.iniciativa_fonte === "fixa" ? "Iniciativa fixa" : "Iniciativa da ficha");
    if (budgetVisible && c.actionBudget && c.actionBudget.budgetDefined) {
      baseNote += " · " + c.actionBudget.initialBudget + (c.actionBudget.initialBudget === 1 ? " ação" : " ações");
    }
    if (budgetVisible && c.nextRoundInitiative !== null && c.nextRoundInitiative !== undefined) {
      baseNote += " · Próx: " + c.nextRoundInitiative;
    }
    note.textContent = baseNote;
    label.appendChild(note);
    var score = document.createElement("strong"); score.className = "mesa-tracker-score"; score.textContent = currScore;
    li.append(portrait, label, score); list.appendChild(li);
  });
  renderContextualActionBar(st, state);
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
