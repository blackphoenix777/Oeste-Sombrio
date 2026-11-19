import {
  CANONICAL_ACTION_COSTS,
  ALLOWED_REACTION_ACTION_TYPES,
  resolveCanonicalActionCost,
  computeAvailableActionsFromState,
  hasPendingActionReservations
} from "./initiativeRules.js";

/**
 * Escala tática oficial do grid (regras_combate.json -> combate_tatico.tamanho_do_quadrado_metros).
 */
export var GRID_SQUARE_METERS = 1.5;
export var DEFAULT_MELEE_REACH_SQUARES = 1;
export var DEFAULT_MELEE_REACH_METERS = 1.5;

/**
 * Catálogo canônico somente-leitura para a barra contextual de ações (COM-12).
 * Custos permanecem derivados exclusivamente de CANONICAL_ACTION_COSTS.
 */
export var CONTEXTUAL_ACTION_CATALOG = Object.freeze([
  Object.freeze({
    key: "atacar",
    label: "Atacar",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.atacar,
    resources: "1 ação · arma ou ataque natural + 6B",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "mover",
    label: "Mover",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.mover,
    resources: "1 ação · deslocamento tático (6m base / 3m sobrecarregado)",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "mirar",
    label: "Mirar",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.mirar,
    resources: "1 ação · arma à distância",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "recarregar",
    label: "Recarregar",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.recarregar,
    resources: "1 ação · munição ou preparo",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "usar_item",
    label: "Usar Item",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.usar_item,
    resources: "1 ação · item disponível no inventário",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "magia",
    label: "Magia",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.magia,
    resources: "1 ação · REM / conjuração conforme regra",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "narrativa",
    label: "Ação Narrativa",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.narrativa,
    resources: "1 ação · interação com cena ou ambiente",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "apagar_fogo",
    label: "Apagar Fogo",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.apagar_fogo,
    resources: "1 ação · remover Em Chamas",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "limpar_olhos",
    label: "Limpar Olhos",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.limpar_olhos,
    resources: "2 ações · remover Cego por fuligem",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "quebrar_objeto",
    label: "Quebrar Objeto",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.quebrar_objeto,
    resources: "2 ações · força ou ferramenta",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "remover_desorientado",
    label: "Remover Desorientado",
    category: "ordinary",
    cost: CANONICAL_ACTION_COSTS.remover_desorientado,
    resources: "3 ações · recuperar foco",
    requiresPassiveSkill: false
  }),
  Object.freeze({
    key: "ataque_oportunidade",
    label: "Ataque de Oportunidade",
    category: "reaction",
    cost: CANONICAL_ACTION_COSTS.ataque_oportunidade,
    resources: "1 ação · corpo a corpo (≤ 1,5m) · teste passivo (maior 6B + perícia)",
    requiresPassiveSkill: true,
    defaultPassiveSkill: "combate-corpo-a-corpo",
    defaultReachMeters: DEFAULT_MELEE_REACH_METERS
  }),
  Object.freeze({
    key: "reacao",
    label: "Reação",
    category: "reaction",
    cost: CANONICAL_ACTION_COSTS.reacao,
    resources: "1 ação · gatilho indicado/autorizado pelo Xerife",
    requiresPassiveSkill: false,
    defaultPassiveSkill: null,
    defaultReachMeters: null
  })
]);

export function getContextualActionSpec(actionKey) {
  var key = String(actionKey || "").trim().toLowerCase();
  for (var i = 0; i < CONTEXTUAL_ACTION_CATALOG.length; i++) {
    if (CONTEXTUAL_ACTION_CATALOG[i].key === key) {
      return CONTEXTUAL_ACTION_CATALOG[i];
    }
  }
  return null;
}

/**
 * Deriva a fase semântica do turno do combatente na rodada vigente (COM-09/COM-10).
 * Nunca inventa um estado paralelo: lê exclusivamente `combate.ativo`, `turno_atual_idx`
 * e `action_state.turnEnded`.
 *
 * @param {Object|null} combatState
 * @param {Object|null} combatantItem
 * @param {{ itemIndex?: number }} [options]
 * @returns {"pre_turn"|"active_turn"|"post_turn"|"round_ended"}
 */
export function deriveCombatantTurnPhase(combatState, combatantItem, options) {
  options = options || {};
  if (!combatState || combatState.ativo === false) {
    return "round_ended";
  }
  if (!combatantItem || typeof combatantItem !== "object") {
    return "round_ended";
  }

  var ordem = Array.isArray(combatState.ordem) ? combatState.ordem : [];
  var itemIdx =
    typeof options.itemIndex === "number" && options.itemIndex >= 0
      ? options.itemIndex
      : ordem.findIndex(function (c) {
          return c && String(c.token_id) === String(combatantItem.token_id || combatantItem.combatantId || "");
        });

  var turnIdx =
    typeof combatState.turno_atual_idx === "number"
      ? combatState.turno_atual_idx
      : parseInt(String(combatState.turno_atual_idx == null ? -1 : combatState.turno_atual_idx), 10);

  var actionState =
    combatantItem.actionState ||
    combatantItem.action_state ||
    null;

  if (actionState && Number(actionState.round || 0) > 0 && Number(combatState.round || 0) > 0) {
    if (Number(actionState.round) < Number(combatState.round)) {
      return "round_ended";
    }
  }

  if (actionState && actionState.turnEnded === true) {
    return "post_turn";
  }
  if (itemIdx >= 0 && turnIdx >= 0 && itemIdx === turnIdx) {
    return "active_turn";
  }
  if (itemIdx >= 0 && turnIdx >= 0 && itemIdx < turnIdx && combatantItem.entrou_no_meio !== true) {
    return "post_turn";
  }
  return "pre_turn";
}

export function getTurnPhaseLabel(turnPhase) {
  if (turnPhase === "active_turn") return "Turno ativo";
  if (turnPhase === "post_turn") return "Turno encerrado (reações válidas)";
  if (turnPhase === "pre_turn") return "Antes da própria vez (requer Xerife)";
  return "Rodada encerrada";
}

/**
 * Resume a economia autoritativa de ações e reações de um combatente na rodada (COM-09/10/12).
 *
 * @param {Object|null} combatState
 * @param {Object|null} combatantItem
 * @param {{ itemIndex?: number, opportunities?: Array, requests?: Array }} [options]
 * @returns {Object}
 */
export function summarizeCombatantActionEconomy(combatState, combatantItem, options) {
  options = options || {};
  var tokenId = combatantItem ? String(combatantItem.token_id || combatantItem.combatantId || "") : "";
  var roundNum = combatState && combatState.round ? Math.max(1, Number(combatState.round) || 1) : 0;
  var turnPhase = deriveCombatantTurnPhase(combatState, combatantItem, options);
  var actionState =
    (combatantItem && (combatantItem.actionState || combatantItem.action_state)) || null;
  var budget = (combatantItem && combatantItem.actionBudget) || null;

  var budgetDefined = !!(
    (actionState && actionState.budgetDefined) ||
    (!actionState && budget && budget.budgetDefined)
  );
  var pendingReason =
    (actionState && actionState.pendingReason) ||
    (budget && budget.pendingReason) ||
    null;
  var initialBudget = budgetDefined
    ? Number(
        actionState && actionState.initialBudget !== null && actionState.initialBudget !== undefined
          ? actionState.initialBudget
          : budget && budget.initialBudget !== null && budget.initialBudget !== undefined
          ? budget.initialBudget
          : 0
      )
    : null;

  var ledger = actionState && Array.isArray(actionState.ledger) ? actionState.ledger : [];
  var pendingReservations = ledger.filter(function (e) {
    return e && e.status === "reserved";
  });
  var spentActions = 0;
  var reservedActions = 0;
  for (var i = 0; i < ledger.length; i++) {
    var entry = ledger[i];
    if (!entry || typeof entry !== "object") continue;
    var costVal = Math.max(0, Math.trunc(Number(entry.cost) || 0));
    if (entry.status === "committed") spentActions += costVal;
    else if (entry.status === "reserved") reservedActions += costVal;
  }

  var availableActions = null;
  if (turnPhase === "round_ended") {
    availableActions = budgetDefined ? 0 : null;
  } else if (actionState && actionState.budgetDefined) {
    availableActions = computeAvailableActionsFromState(actionState);
  } else if (budgetDefined && initialBudget !== null) {
    availableActions = Math.max(0, initialBudget - spentActions - reservedActions);
  }

  var allOpps = Array.isArray(options.opportunities)
    ? options.opportunities
    : combatState && Array.isArray(combatState.oportunidades_reacao)
    ? combatState.oportunidades_reacao
    : [];
  var allReqs = Array.isArray(options.requests)
    ? options.requests
    : combatState && Array.isArray(combatState.solicitacoes_reacao)
    ? combatState.solicitacoes_reacao
    : [];

  var openOpportunities = allOpps.filter(function (o) {
    return (
      o &&
      o.status === "open" &&
      String(o.combatantId || "") === tokenId &&
      Number(o.round || 0) === roundNum
    );
  });
  var pendingEarlyRequests = allReqs.filter(function (r) {
    return (
      r &&
      r.status === "pending" &&
      String(r.combatantId || "") === tokenId &&
      Number(r.round || 0) === roundNum
    );
  });

  var hasActions = budgetDefined && typeof availableActions === "number" && availableActions > 0;
  var ordinaryActionsAvailable = turnPhase === "active_turn" && hasActions ? availableActions : 0;
  var postTurnReactionsAvailable = turnPhase === "post_turn" && hasActions ? availableActions : 0;
  var earlyReactionsAvailable = turnPhase === "pre_turn" && hasActions ? availableActions : 0;

  var blockReasons = [];
  if (turnPhase === "round_ended") {
    blockReasons.push("Rodada encerrada: saldo remanescente expirado.");
  } else if (!budgetDefined) {
    if (pendingReason === "legacy_npc_operational_mode_unset") {
      blockReasons.push("NPC legado sem modalidade operacional definida (orçamento indefinido).");
    } else if (pendingReason === "bestiary_monster_fixed_actions_undefined") {
      blockReasons.push("Monstro do bestiário sem quantidade fixa de ações definida.");
    } else {
      blockReasons.push("Orçamento de ações não disponível para este combatente.");
    }
  } else if (availableActions === 0) {
    blockReasons.push("Sem ações disponíveis nesta rodada.");
  } else if (turnPhase === "post_turn") {
    blockReasons.push("Turno encerrado: ações ordinárias bloqueadas; saldo preservado apenas para reações válidas até o fim da rodada.");
  } else if (turnPhase === "pre_turn") {
    blockReasons.push("Antes da própria vez: ações ordinárias bloqueadas; reação antecipada exige autorização do Xerife.");
  }

  return {
    combatantId: tokenId || null,
    round: roundNum,
    turnPhase: turnPhase,
    turnPhaseLabel: getTurnPhaseLabel(turnPhase),
    actionsExpired: turnPhase === "round_ended",
    budgetDefined: budgetDefined,
    pendingReason: pendingReason,
    initialBudget: initialBudget,
    spentActions: spentActions,
    reservedActions: reservedActions,
    availableActions: availableActions,
    ordinaryActionsAvailable: ordinaryActionsAvailable,
    postTurnReactionsAvailable: postTurnReactionsAvailable,
    earlyReactionsAvailable: earlyReactionsAvailable,
    reactionsAvailableCount:
      turnPhase === "post_turn"
        ? postTurnReactionsAvailable
        : turnPhase === "pre_turn"
        ? earlyReactionsAvailable
        : turnPhase === "active_turn"
        ? ordinaryActionsAvailable
        : 0,
    canPerformOrdinaryAction: turnPhase === "active_turn" && hasActions,
    canExecutePostTurnReaction:
      (turnPhase === "post_turn" || turnPhase === "active_turn") &&
      hasActions &&
      openOpportunities.length > 0,
    canRequestEarlyReaction:
      turnPhase === "pre_turn" &&
      hasActions &&
      pendingEarlyRequests.length === 0,
    hasPendingReservation: hasPendingActionReservations(actionState),
    pendingReservations: pendingReservations,
    openOpportunities: openOpportunities,
    pendingEarlyRequests: pendingEarlyRequests,
    actionStateVersion: actionState && actionState.version ? Number(actionState.version) : 1,
    blockReasons: blockReasons
  };
}

/**
 * Calcula distância tática estritamente sobre coordenadas inteiras de grade (grid_x, grid_y)
 * no mesmo mapa (1 quadrado = 1,5m). Nunca utiliza pixels de tela.
 *
 * @param {Object|null} tokenA
 * @param {Object|null} tokenB
 * @param {{ squareMeters?: number }} [options]
 * @returns {{ valid: boolean, reason: string|null, sameMap: boolean, squares: number|null, meters: number|null }}
 */
export function computeGridDistanceBetweenTokens(tokenA, tokenB, options) {
  options = options || {};
  var sqMeters =
    typeof options.squareMeters === "number" && options.squareMeters > 0
      ? options.squareMeters
      : GRID_SQUARE_METERS;

  if (!tokenA || !tokenB || typeof tokenA !== "object" || typeof tokenB !== "object") {
    return { valid: false, reason: "MISSING_TOKEN", sameMap: false, squares: null, meters: null };
  }
  if (
    tokenA.mapa_id &&
    tokenB.mapa_id &&
    String(tokenA.mapa_id) !== String(tokenB.mapa_id)
  ) {
    return { valid: false, reason: "DIFFERENT_MAP", sameMap: false, squares: null, meters: null };
  }

  var hasCoords =
    tokenA.grid_x !== undefined &&
    tokenA.grid_x !== null &&
    tokenA.grid_y !== undefined &&
    tokenA.grid_y !== null &&
    tokenB.grid_x !== undefined &&
    tokenB.grid_x !== null &&
    tokenB.grid_y !== undefined &&
    tokenB.grid_y !== null;
  if (!hasCoords) {
    return { valid: false, reason: "MISSING_GRID_COORDS", sameMap: true, squares: null, meters: null };
  }

  var ax = Number(tokenA.grid_x);
  var ay = Number(tokenA.grid_y);
  var bx = Number(tokenB.grid_x);
  var by = Number(tokenB.grid_y);
  if (
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by) ||
    Math.trunc(ax) !== ax ||
    Math.trunc(ay) !== ay ||
    Math.trunc(bx) !== bx ||
    Math.trunc(by) !== by ||
    ax < 0 ||
    ay < 0 ||
    bx < 0 ||
    by < 0
  ) {
    return { valid: false, reason: "INVALID_GRID_COORDS", sameMap: true, squares: null, meters: null };
  }

  var squares = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  var meters = Math.round(squares * sqMeters * 100) / 100;
  return {
    valid: true,
    reason: null,
    sameMap: true,
    squares: squares,
    meters: meters
  };
}

/**
 * Inspeciona os insumos de teste passivo (sistema_de_testes.json: maior valor disponível do 6B
 * + dado da perícia ou 1d4-2 se não treinada) sem inventar dados ausentes.
 *
 * @param {Object|null} sheetData
 * @param {string|null} skillKey
 * @param {{ instance6BState?: Object|null }} [options]
 * @returns {Object}
 */
export function inspectPassiveSkillForReaction(sheetData, skillKey, options) {
  options = options || {};
  var normalizedKey = String(skillKey || "").trim().toLowerCase();
  if (!normalizedKey) {
    return {
      required: false,
      status: "not_required",
      skillKey: null,
      trainedDice: [],
      untrainedFallback: false,
      maxAvailable6B: null,
      formulaPreview: null,
      needsGmConfirmation: false,
      reason: null
    };
  }

  var d =
    sheetData && typeof sheetData === "object"
      ? sheetData.data && typeof sheetData.data === "object"
        ? sheetData.data
        : sheetData.dados && typeof sheetData.dados === "object"
        ? sheetData.dados
        : sheetData
      : null;

  if (!d) {
    return {
      required: true,
      status: "needs_gm_confirmation",
      skillKey: normalizedKey,
      trainedDice: [],
      untrainedFallback: false,
      maxAvailable6B: null,
      formulaPreview: null,
      needsGmConfirmation: true,
      reason: "Dados da ficha indisponíveis para cálculo automático de perícia passiva."
    };
  }

  var bareKey = normalizedKey.replace(/^(pericia-|combate-)/, "");
  var prefixes = normalizedKey.startsWith("combate-")
    ? ["combate-" + bareKey, "pericia-" + bareKey]
    : normalizedKey.startsWith("pericia-")
    ? ["pericia-" + bareKey, "combate-" + bareKey]
    : ["combate-" + bareKey, "pericia-" + bareKey];

  var diceOrder = ["d4", "d6", "d8", "d10", "d12"];
  var trainedDice = [];
  for (var p = 0; p < prefixes.length; p++) {
    for (var i = 0; i < diceOrder.length; i++) {
      var field = prefixes[p] + "-" + diceOrder[i];
      if (d[field] === true || d[field] === "true") {
        if (trainedDice.indexOf(diceOrder[i]) < 0) trainedDice.push(diceOrder[i]);
      }
    }
    if (trainedDice.length > 0) break;
  }

  var max6B = null;
  var inst6B = options.instance6BState || null;
  if (inst6B && Array.isArray(inst6B.resultados) && inst6B.resultados.length > 0) {
    var usedSet = new Set(Array.isArray(inst6B.usados) ? inst6B.usados.map(Number) : []);
    var bestInst = 0;
    for (var k = 0; k < inst6B.resultados.length; k++) {
      if (usedSet.has(k)) continue;
      var rv = Number(inst6B.resultados[k]) || 0;
      if (rv > bestInst) bestInst = rv;
    }
    max6B = bestInst;
  } else {
    var usedArr = Array.isArray(d.usedChambers) ? d.usedChambers.map(Number) : [];
    var dmgArr = Array.isArray(d.damagedChambers) ? d.damagedChambers.map(Number) : [];
    var foundChamberField = false;
    var bestVal = 0;
    for (var c = 0; c < 15; c++) {
      var ck = "chamber-" + c;
      if (d[ck] === undefined || d[ck] === null || d[ck] === "") continue;
      foundChamberField = true;
      if (usedArr.indexOf(c) >= 0 || dmgArr.indexOf(c) >= 0) continue;
      var cv = parseInt(String(d[ck]), 10);
      if (!isNaN(cv) && cv > bestVal) bestVal = cv;
    }
    if (foundChamberField) {
      max6B = bestVal;
    }
  }

  var untrained = trainedDice.length === 0;
  var dieDesc = untrained ? "1d4-2 (não treinada)" : trainedDice.join("·");

  if (max6B === null) {
    return {
      required: true,
      status: "needs_gm_confirmation",
      skillKey: normalizedKey,
      trainedDice: trainedDice,
      untrainedFallback: untrained,
      maxAvailable6B: null,
      formulaPreview: "Maior 6B (?) + " + dieDesc,
      needsGmConfirmation: true,
      reason: "6B disponível não identificado automaticamente; confirmar com o Xerife."
    };
  }

  return {
    required: true,
    status: "evaluated",
    skillKey: normalizedKey,
    trainedDice: trainedDice,
    untrainedFallback: untrained,
    maxAvailable6B: max6B,
    formulaPreview: "Maior 6B (" + max6B + ") + " + dieDesc,
    needsGmConfirmation: max6B === 0,
    reason: max6B === 0 ? "Nenhum dado 6B disponível no momento (Maior 6B = 0)." : null
  };
}

/**
 * Avalia elegibilidade completa de uma oportunidade contextual de reação (COM-11 V1).
 * Distingue explicitamente o que foi verificado automaticamente e o que exige confirmação do Xerife.
 * Nunca inventa elegibilidade quando faltam dados de distância ou perícia.
 *
 * @param {Object} params
 * @returns {Object}
 */
export function evaluateContextualOpportunity(params) {
  params = params || {};
  var combat = params.combatState || null;
  var mesaId = params.mesaId ? String(params.mesaId) : null;
  var activeMesaId = params.activeMesaId ? String(params.activeMesaId) : mesaId;
  var combatantId = params.combatantId ? String(params.combatantId) : "";
  var actionType = String(params.actionType || "ataque_oportunidade").trim().toLowerCase();
  var isMestre = params.isMestre === true;
  var requestedCost = params.cost;
  var reason = params.reason || params.justificativa || null;

  var autoCheckedFields = [];
  var requiresGmConfirmationFields = [];
  var blockReasons = [];
  var warnings = [];

  // 1. Mesa e combate ativos
  if (!mesaId || !activeMesaId || mesaId !== activeMesaId) {
    blockReasons.push("Mesa inválida ou divergente da mesa ativa.");
  } else {
    autoCheckedFields.push("mesa");
  }

  if (!combat || !combat.ativo) {
    blockReasons.push("Não há combate ativo ou a rodada já foi encerrada.");
  } else {
    autoCheckedFields.push("combate_ativo");
  }

  var activeRound = combat && combat.round ? Math.max(1, Number(combat.round) || 1) : 0;
  var requestedRound = params.round !== undefined && params.round !== null ? Number(params.round) : activeRound;
  if (combat && combat.ativo) {
    if (requestedRound !== activeRound) {
      blockReasons.push("Oportunidade direcionada a rodada encerrada ou divergente.");
    } else {
      autoCheckedFields.push("rodada");
    }
  }

  // 2. Combatente na ordem de combate
  var ordem = combat && Array.isArray(combat.ordem) ? combat.ordem : [];
  var itemIndex = ordem.findIndex(function (c) {
    return c && String(c.token_id) === combatantId;
  });
  var combatantItem = itemIndex >= 0 ? ordem[itemIndex] : null;
  if (!combatantItem) {
    blockReasons.push("Combatente informado não participa do combate ativo.");
  } else {
    autoCheckedFields.push("combatente");
  }

  // 3. Mapa consistente
  var combatMapaId = combat && combat.mapa_id ? String(combat.mapa_id) : null;
  var requestedMapaId = params.mapaId ? String(params.mapaId) : combatMapaId;
  var reactorToken = params.reactorToken || null;
  var targetToken = params.targetToken || null;
  if (combatMapaId && requestedMapaId && combatMapaId !== requestedMapaId) {
    blockReasons.push("Oportunidade direcionada a mapa diferente do combate ativo.");
  } else if (reactorToken && combatMapaId && reactorToken.mapa_id && String(reactorToken.mapa_id) !== combatMapaId) {
    blockReasons.push("Combatente não está no mapa ativo do combate.");
  } else if (targetToken && combatMapaId && targetToken.mapa_id && String(targetToken.mapa_id) !== combatMapaId) {
    blockReasons.push("Alvo da oportunidade está em outro mapa.");
  } else {
    autoCheckedFields.push("mapa");
  }

  // 4. Tipo de reação e custo canônico
  if (ALLOWED_REACTION_ACTION_TYPES.indexOf(actionType) < 0) {
    blockReasons.push("Tipo de ação não permitido como reação: " + actionType + ".");
  }
  var costRes = resolveCanonicalActionCost(actionType, requestedCost, {
    isMestre: isMestre,
    reason: reason
  });
  if (!costRes.valid) {
    blockReasons.push("Custo de reação inválido (" + costRes.errorCode + ").");
  } else {
    autoCheckedFields.push("custo");
  }
  var resolvedCost = costRes.valid ? costRes.cost : 1;

  // 5. Alcance tático (grade 1,5m/quadrado; nunca pixels)
  var spec = getContextualActionSpec(actionType);
  var reachMeters =
    params.reachMeters !== undefined && params.reachMeters !== null && params.reachMeters !== ""
      ? Number(params.reachMeters)
      : spec && spec.defaultReachMeters !== undefined
      ? spec.defaultReachMeters
      : null;
  var rangeConfirmedByGm = params.rangeConfirmedByGm === true;
  var gridDist =
    reactorToken && targetToken
      ? computeGridDistanceBetweenTokens(reactorToken, targetToken, {
          squareMeters: GRID_SQUARE_METERS
        })
      : { valid: false, reason: "MISSING_TOKEN", sameMap: true, squares: null, meters: null };

  var rangeCheck = {
    status: "not_applicable",
    reachMeters: reachMeters,
    distanceSquares: gridDist.squares,
    distanceMeters: gridDist.meters,
    confirmedByGm: rangeConfirmedByGm,
    reason: null
  };

  if (reachMeters !== null && Number.isFinite(reachMeters) && reachMeters >= 0) {
    if (gridDist.valid) {
      autoCheckedFields.push("alcance_grade");
      if (gridDist.meters <= reachMeters) {
        rangeCheck.status = "in_range";
      } else if (rangeConfirmedByGm && isMestre) {
        rangeCheck.status = "confirmed_by_gm";
        warnings.push(
          "Distância na grade (" +
            gridDist.meters +
            "m) excede alcance padrão (" +
            reachMeters +
            "m); mantido por confirmação explícita do Xerife."
        );
      } else {
        rangeCheck.status = "out_of_range";
        rangeCheck.reason =
          "Alvo fora de alcance (" + gridDist.meters + "m > " + reachMeters + "m).";
        blockReasons.push(rangeCheck.reason);
      }
    } else if (gridDist.reason === "DIFFERENT_MAP") {
      rangeCheck.status = "out_of_range";
      rangeCheck.reason = "Alvo em mapa diferente do combatente.";
      blockReasons.push(rangeCheck.reason);
    } else if (rangeConfirmedByGm) {
      rangeCheck.status = "confirmed_by_gm";
      requiresGmConfirmationFields.push("alcance");
    } else {
      rangeCheck.status = "needs_gm_confirmation";
      rangeCheck.reason =
        "Distância tática não mensurável automaticamente; exige confirmação de alcance pelo Xerife.";
      requiresGmConfirmationFields.push("alcance");
      blockReasons.push(rangeCheck.reason);
    }
  } else if (!rangeConfirmedByGm) {
    rangeCheck.status = "needs_gm_confirmation";
    requiresGmConfirmationFields.push("alcance");
  } else {
    rangeCheck.status = "confirmed_by_gm";
  }

  // 6. Perícia passiva (obrigatória por regra em Ataque de Oportunidade)
  var requiresPassiveSkill =
    params.passiveSkillRequired !== undefined && params.passiveSkillRequired !== null
      ? !!params.passiveSkillRequired
      : !!(spec && spec.requiresPassiveSkill);
  var passiveSkillKey = requiresPassiveSkill
    ? params.passiveSkillKey || (spec && spec.defaultPassiveSkill) || "combate-corpo-a-corpo"
    : null;
  var passiveSkillConfirmedByGm = params.passiveSkillConfirmedByGm === true;
  var passiveSkillCheck = inspectPassiveSkillForReaction(
    params.sheetData || null,
    passiveSkillKey,
    { instance6BState: params.instance6BState || null }
  );
  passiveSkillCheck.confirmedByGm = passiveSkillConfirmedByGm;

  if (requiresPassiveSkill) {
    if (passiveSkillCheck.status === "evaluated") {
      autoCheckedFields.push("pericia_passiva");
      if (passiveSkillCheck.maxAvailable6B === 0) {
        warnings.push("Combatente está sem dados 6B disponíveis para o componente passivo (Maior 6B = 0).");
      }
    } else if (passiveSkillConfirmedByGm) {
      passiveSkillCheck.status = "confirmed_by_gm";
      requiresGmConfirmationFields.push("pericia_passiva");
    } else {
      requiresGmConfirmationFields.push("pericia_passiva");
      blockReasons.push(
        passiveSkillCheck.reason ||
          "Perícia passiva indisponível para leitura automática; exige confirmação do Xerife."
      );
    }
  }

  // 7. Saldo disponível e fase do turno (COM-09 vs COM-10)
  var summary = summarizeCombatantActionEconomy(combat, combatantItem, {
    itemIndex: itemIndex
  });

  if (!summary.budgetDefined || summary.availableActions === null) {
    blockReasons.push("Orçamento de ações do combatente está indefinido.");
  } else if (summary.availableActions < resolvedCost) {
    blockReasons.push(
      "Saldo de ações insuficiente (disponível: " +
        summary.availableActions +
        ", necessário: " +
        resolvedCost +
        ")."
    );
  } else {
    autoCheckedFields.push("saldo_acoes");
  }

  var authorizationMode = "blocked";
  var requiresEarlyApproval = false;
  if (summary.turnPhase === "round_ended") {
    authorizationMode = "blocked";
  } else if (summary.turnPhase === "pre_turn") {
    authorizationMode = "requires_early_reaction_approval";
    requiresEarlyApproval = true;
    requiresGmConfirmationFields.push("autorizacao_reacao_antecipada");
  } else if (summary.turnPhase === "post_turn") {
    authorizationMode = "post_turn_gm_opportunity";
    autoCheckedFields.push("fase_pos_turno");
  } else {
    authorizationMode = "active_turn";
    autoCheckedFields.push("fase_turno_ativo");
  }

  var eligible = blockReasons.length === 0;
  return {
    eligible: eligible,
    combatantId: combatantId || null,
    round: activeRound,
    turnPhase: summary.turnPhase,
    turnPhaseLabel: summary.turnPhaseLabel,
    actionType: actionType,
    cost: resolvedCost,
    availableActions: summary.availableActions,
    authorizationMode: authorizationMode,
    requiresEarlyApproval: requiresEarlyApproval,
    rangeCheck: rangeCheck,
    passiveSkillCheck: passiveSkillCheck,
    autoCheckedFields: autoCheckedFields,
    requiresGmConfirmationFields: requiresGmConfirmationFields,
    blockReasons: blockReasons,
    warnings: warnings
  };
}

/**
 * Constrói o modelo de comandos válidos da barra contextual de ações (COM-12),
 * garantindo que somente comandos autorizados para o estado e papel sejam habilitados.
 *
 * @param {Object} params
 * @returns {Object}
 */
export function evaluateContextualBarCommands(params) {
  params = params || {};
  var combat = params.combatState || null;
  var selectedItem = params.selectedItem || null;
  var isMestre = params.isMestre === true;
  var canOperate = params.canOperateCombatant === true;
  var busy = params.busy === true;
  var selectedActionKey = String(params.selectedActionType || "atacar").trim().toLowerCase();
  var actionSpec = getContextualActionSpec(selectedActionKey) || CONTEXTUAL_ACTION_CATALOG[0];
  var summary = summarizeCombatantActionEconomy(combat, selectedItem, {
    opportunities: params.opportunities,
    requests: params.requests
  });

  var isOrdinarySelected = actionSpec.category === "ordinary";
  var canAffordSelected =
    summary.budgetDefined &&
    summary.availableActions !== null &&
    summary.availableActions >= actionSpec.cost;

  var reserveBlockedReason = null;
  if (!combat || !combat.ativo) reserveBlockedReason = "Combate inativo.";
  else if (!selectedItem) reserveBlockedReason = "Selecione um combatente.";
  else if (!canOperate) reserveBlockedReason = "Sem permissão para operar este combatente.";
  else if (!isOrdinarySelected) reserveBlockedReason = "Selecione uma ação ordinária para reservar no turno.";
  else if (summary.turnPhase === "post_turn") reserveBlockedReason = "Turno encerrado: ações ordinárias bloqueadas; saldo restante serve apenas para reações válidas.";
  else if (summary.turnPhase === "pre_turn") reserveBlockedReason = "Aguarde sua vez para ações ordinárias (ou solicite reação antecipada ao Xerife).";
  else if (summary.turnPhase === "round_ended") reserveBlockedReason = "Rodada encerrada.";
  else if (!summary.budgetDefined) reserveBlockedReason = summary.blockReasons[0] || "Orçamento indefinido.";
  else if (!canAffordSelected) reserveBlockedReason = "Saldo insuficiente (" + summary.availableActions + " disponível, custo " + actionSpec.cost + ").";

  var earlyRequestBlockedReason = null;
  if (!combat || !combat.ativo) earlyRequestBlockedReason = "Combate inativo.";
  else if (!selectedItem) earlyRequestBlockedReason = "Selecione um combatente.";
  else if (!canOperate) earlyRequestBlockedReason = "Sem permissão para solicitar reação por este combatente.";
  else if (summary.turnPhase !== "pre_turn") {
    earlyRequestBlockedReason =
      summary.turnPhase === "post_turn"
        ? "Turno já encerrado: utilize uma oportunidade de reação pós-turno."
        : summary.turnPhase === "active_turn"
        ? "Já é a vez deste combatente."
        : "Rodada encerrada.";
  } else if (summary.pendingEarlyRequests.length > 0) {
    earlyRequestBlockedReason = "Já existe uma solicitação pendente aguardando o Xerife.";
  } else if (!summary.budgetDefined || summary.availableActions === null || summary.availableActions < 1) {
    earlyRequestBlockedReason = "Sem saldo disponível para reação antecipada (custo 1 ação).";
  }

  var openOppCommands = summary.openOpportunities.map(function (opp) {
    var oppCost = Math.max(1, Number(opp.cost || 1));
    var hasBalance = summary.budgetDefined && summary.availableActions !== null && summary.availableActions >= oppCost;
    var needsEarly = summary.turnPhase === "pre_turn";
    var canDirectExecute =
      !busy &&
      canOperate &&
      hasBalance &&
      !needsEarly &&
      summary.turnPhase !== "round_ended";
    var canRequestEarlyForOpp =
      !busy &&
      canOperate &&
      hasBalance &&
      needsEarly &&
      summary.pendingEarlyRequests.length === 0;
    var reason = null;
    if (!canOperate) reason = "Sem permissão para este combatente.";
    else if (!hasBalance) reason = "Saldo insuficiente (" + (summary.availableActions == null ? "?" : summary.availableActions) + " < " + oppCost + ").";
    else if (needsEarly && summary.pendingEarlyRequests.length > 0) reason = "Aguardando decisão do Xerife na solicitação pendente.";
    else if (needsEarly) reason = "Antes da própria vez: exige solicitação e aprovação do Xerife.";
    return {
      opportunityId: opp.opportunityId,
      actionType: opp.actionType,
      cost: oppCost,
      triggerLabel: opp.triggerLabel || opp.actionType,
      canExecuteDirectly: canDirectExecute,
      canRequestEarly: canRequestEarlyForOpp,
      canClose: !busy && isMestre,
      reason: reason
    };
  });

  var requestCommands = summary.pendingEarlyRequests.map(function (req) {
    return {
      requestId: req.requestId,
      combatantId: req.combatantId,
      actionType: req.actionType,
      cost: Math.max(1, Number(req.cost || 1)),
      canApprove: !busy && isMestre,
      canDeny: !busy && isMestre,
      canCancel: !busy && canOperate
    };
  });

  return {
    summary: summary,
    selectedAction: actionSpec,
    canReserveOrdinary: !busy && reserveBlockedReason === null,
    reserveBlockedReason: reserveBlockedReason,
    canRequestEarlyReaction: !busy && earlyRequestBlockedReason === null,
    earlyRequestBlockedReason: earlyRequestBlockedReason,
    canOpenOpportunity: !busy && isMestre && !!(combat && combat.ativo && selectedItem),
    pendingReservations: summary.pendingReservations.map(function (res) {
      return {
        reservationId: res.reservationId,
        actionType: res.actionType,
        cost: Number(res.cost || 1),
        canCommit: !busy && canOperate,
        canCancel: !busy && canOperate && res.resultRevealed !== true
      };
    }),
    openOpportunities: openOppCommands,
    pendingRequests: requestCommands
  };
}
