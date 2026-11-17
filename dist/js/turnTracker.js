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

  return {
    userId: uid,
    mesaId: String(mesaId),
    combatId: rs.combatId,
    mapaId: rs.mapaId || null,
    round: rs.round,
    serverVersion: rs.serverVersion,
    orderIds: safeOrder,
    byTokenId: safeByToken,
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
      var initVal = normTrackerInit(srvCurr);
      var entry = {
        tokenId: tid,
        currentInitiative: initVal,
        nextRoundInitiative: srvNext !== null ? normTrackerInit(srvNext) : null,
        initiativeSource: item.iniciativa_fonte || "ficha",
        turnEnded: false,
        budget: null,
        actionState: null
      };
      item.currentInitiative = entry.currentInitiative;
      item.iniciativa = entry.currentInitiative;
      item.nextRoundInitiative = entry.nextRoundInitiative;
      entry.budget = computeBudgetForCombatItem(item, nextRound, entry.currentInitiative);
      entry.actionState = createActionStateForItem(item, nextRound, next, entry.budget, null);
      item.actionBudget = entry.budget;
      item.actionState = entry.actionState;
      rs.byTokenId[tid] = entry;
      rs.orderIds.push(tid);
    });
    next.ordem = ordem;

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
      var entry;
      if (!prev) {
        entry = {
          tokenId: tid,
          currentInitiative: srvCurr !== null ? normTrackerInit(srvCurr) : serverInit,
          nextRoundInitiative: srvNext !== null ? normTrackerInit(srvNext) : null,
          initiativeSource: item.iniciativa_fonte || "fixa",
          turnEnded: false,
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
          turnEnded: !!prev.turnEnded,
          budget: null,
          actionState: prev.actionState || null
        };
      }
      item.currentInitiative = entry.currentInitiative;
      item.iniciativa = entry.currentInitiative;
      item.nextRoundInitiative = entry.nextRoundInitiative;
      entry.budget = computeBudgetForCombatItem(item, rs.round, entry.currentInitiative);
      entry.actionState = createActionStateForItem(item, rs.round, next, entry.budget, entry.actionState);
      entry.actionState.turnEnded = !!entry.turnEnded;
      item.actionBudget = entry.budget;
      item.actionState = entry.actionState;
      nextMap[tid] = entry;
      rebuiltOrdem.push(item);
    });

    rs.byTokenId = nextMap;
    rs.orderIds = preservedIds;
    next.ordem = rebuiltOrdem;
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
  next.ordem = ordem;

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
        if (String(errCode) === "40001" || String(errCode) === "P0409") {
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
  reserveAction: function (req) {
    return executeActionControllerMutation("reserve", req);
  },
  commitReservation: function (req) {
    return executeActionControllerMutation("commit", req);
  },
  cancelReservation: function (req) {
    return executeActionControllerMutation("cancel", req);
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
