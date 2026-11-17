import {
  calculateLooseLoadCapacity,
  countLooseLoadItems,
  evaluateOverloadState
} from "./volumeRules.js";
import { getSkillLevelFromSheetData } from "./restRules.js";

export function calculateInitiative(chamberValues) {
  // Initiative is chambers 1, 2, 3 (indices 0, 1, 2)
  return (
    (chamberValues[0] || 0) +
    (chamberValues[1] || 0) +
    (chamberValues[2] || 0)
  );
}

/**
 * Calcula ações por turno derivadas da Iniciativa (regras_combate.json → regra_acoes_por_iniciativa)
 * aplicando a perda de ações bônus por sobrecarga (itens_e_equipamentos.json → acoes_bonus_perdidas: 2),
 * sem nunca perder a 1 ação padrão.
 */
export function calculateActionsFromInitiative(initiativeScore, isOverloaded, lostBonusActions) {
  var baseActions = 1;
  var init = Math.max(0, Number(initiativeScore) || 0);
  var baseBonusActions = Math.floor(init / 5);
  var penalty = isOverloaded
    ? (typeof lostBonusActions === "number" ? lostBonusActions : 2)
    : 0;
  var effectiveBonusActions = Math.max(0, baseBonusActions - penalty);
  return {
    baseActions: baseActions,
    baseBonusActions: baseBonusActions,
    effectiveBonusActions: effectiveBonusActions,
    lostBonusActions: penalty,
    totalActions: baseActions + effectiveBonusActions
  };
}

/**
 * Calcula o deslocamento em metros por ação (base 6m = 4 quadrados × 1,5m),
 * aplicando -3m/ação quando sobrecarregado.
 */
export function calculateMovementPerAction(baseMeters, isOverloaded, penaltyMeters) {
  var base = typeof baseMeters === "number" && !isNaN(baseMeters) ? baseMeters : 6;
  var pen = isOverloaded ? (typeof penaltyMeters === "number" ? penaltyMeters : 3) : 0;
  return {
    baseMeters: base,
    penaltyMeters: pen,
    effectiveMeters: Math.max(0, base - pen)
  };
}

/**
 * Normaliza um valor de iniciativa para inteiro dentro da faixa suportada no banco.
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
export function normalizeInitiativeScore(value) {
  var text = String(value == null ? "" : value).trim();
  if (!/^[+-]?[0-9]+([.][0-9]+)?$/.test(text)) return 0;
  var n = Number(text);
  return Number.isFinite(n)
    ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(n)))
    : 0;
}

function parseChamberInt(val) {
  var n = parseInt(String(val == null ? "" : val).trim(), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Resolve a iniciativa individual derivada do 6B de uma ficha (câmaras 1..3 + buffs).
 * Não utiliza DOM; opera exclusivamente sobre `sheetData` (ou vetor de câmaras).
 *
 * @param {Object|number[]} sheetData
 * @param {{ fromChambersOnly?: boolean, recalculateFromChambers?: boolean, useOriginalChambers?: boolean }} [options]
 * @returns {number}
 */
export function resolveIndividual6BInitiative(sheetData, options) {
  options = options || {};
  if (Array.isArray(sheetData)) {
    return normalizeInitiativeScore(
      calculateInitiative([
        parseChamberInt(sheetData[0]),
        parseChamberInt(sheetData[1]),
        parseChamberInt(sheetData[2])
      ])
    );
  }
  var d =
    sheetData && typeof sheetData === "object"
      ? sheetData.data && typeof sheetData.data === "object"
        ? sheetData.data
        : sheetData.dados && typeof sheetData.dados === "object"
        ? sheetData.dados
        : sheetData
      : {};

  var c0 = parseChamberInt(
    options.useOriginalChambers && Array.isArray(d.originalChambers)
      ? d.originalChambers[0]
      : d["chamber-0"]
  );
  var c1 = parseChamberInt(
    options.useOriginalChambers && Array.isArray(d.originalChambers)
      ? d.originalChambers[1]
      : d["chamber-1"]
  );
  var c2 = parseChamberInt(
    options.useOriginalChambers && Array.isArray(d.originalChambers)
      ? d.originalChambers[2]
      : d["chamber-2"]
  );
  var chamberSum = calculateInitiative([c0, c1, c2]);

  var buffBonus = 0;
  if (Array.isArray(d.activeBuffs)) {
    for (var i = 0; i < d.activeBuffs.length; i++) {
      var b = d.activeBuffs[i];
      if (!b || b.active === false) continue;
      if (String(b.target || "").trim().toLowerCase() === "iniciativa") {
        var delta = Number(
          b.bonus !== undefined
            ? b.bonus
            : b.valor !== undefined
            ? b.valor
            : b.value !== undefined
            ? b.value
            : 0
        );
        if (Number.isFinite(delta)) buffBonus += Math.trunc(delta);
      }
    }
  }

  if (options.fromChambersOnly || options.recalculateFromChambers) {
    return normalizeInitiativeScore(chamberSum + buffBonus);
  }

  var hasExplicitInit =
    d.iniciativa !== undefined &&
    d.iniciativa !== null &&
    String(d.iniciativa).trim() !== "";
  var explicitInit = hasExplicitInit ? normalizeInitiativeScore(d.iniciativa) : 0;

  if (hasExplicitInit && explicitInit !== 0) {
    return explicitInit;
  }
  if (chamberSum !== 0 || buffBonus !== 0) {
    return normalizeInitiativeScore(chamberSum + buffBonus);
  }
  return explicitInit;
}

/**
 * Resolve o modo de iniciativa do Turn Tracker ("ficha" | "cascata") a partir
 * da modalidade operacional (COM-03/04) preservando legados e monstros oficiais.
 *
 * @param {Object} info
 * @param {string} [info.kind]
 * @param {"creature_mode"|"full_sheet"|null} [info.operationalMode]
 * @param {boolean} [info.isOfficialMonster]
 * @param {string} [info.category]
 * @param {string} [info.tipoFicha]
 * @param {boolean} [info.isBestiaryCustom]
 * @param {string} [info.sourceType]
 * @returns {"ficha"|"cascata"}
 */
export function resolveCombatantInitiativeMode(info) {
  info = info || {};
  if (info.kind === "player") return "ficha";
  if (info.operationalMode === "full_sheet") return "ficha";
  if (info.operationalMode === "creature_mode") return "cascata";
  if (info.isOfficialMonster) return "cascata";

  var catLower = String(info.category || "").trim().toLowerCase();
  var tipoLower = String(info.tipoFicha || "").trim().toLowerCase();
  if (
    catLower === "npc" ||
    tipoLower === "npc" ||
    info.isBestiaryCustom === true ||
    (info.sourceType && info.sourceType !== "oficial")
  ) {
    return "ficha";
  }
  return "cascata";
}

/**
 * Calcula de forma pura a distribuição em cascata D20 (1d20 + N - pos)
 * mantendo um turno individual por token e ordenação oficial.
 *
 * @param {Array<{ token_id: string, name?: string, modo: "ficha"|"cascata", prioridade?: number, iniciativa?: number, owner_type?: string, owner_ref?: string }>} participants
 * @param {{ d20Roll?: number, rng?: function(): number }} [options]
 * @returns {{ cascata_d20: number|null, cascata_total: number, ordem: Array<Object> }}
 */
export function computeCascadeInitiatives(participants, options) {
  options = options || {};
  var list = Array.isArray(participants) ? participants.slice() : [];
  var cascataList = [];
  var fichaList = [];

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item) continue;
    if (item.modo === "cascata") {
      cascataList.push(item);
    } else {
      fichaList.push(item);
    }
  }

  cascataList.sort(function (a, b) {
    var pa = normalizeInitiativeScore(a.prioridade);
    var pb = normalizeInitiativeScore(b.prioridade);
    if (pa !== pb) return pa - pb;
    var ta = String(a.token_id || "");
    var tb = String(b.token_id || "");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  var cascataTotal = cascataList.length;
  var d20 = null;
  if (cascataTotal > 0) {
    if (typeof options.d20Roll === "number" && Number.isFinite(options.d20Roll)) {
      d20 = Math.max(1, Math.min(20, Math.trunc(options.d20Roll)));
    } else {
      var rng = typeof options.rng === "function" ? options.rng : Math.random;
      d20 = Math.floor(rng() * 20) + 1;
    }
  }

  var resolved = [];
  for (var c = 0; c < cascataList.length; c++) {
    var cp = cascataList[c];
    resolved.push(
      Object.assign({}, cp, {
        iniciativa: d20 + cascataTotal - c,
        iniciativa_fonte: "cascata",
        entrou_no_meio: false
      })
    );
  }
  for (var f = 0; f < fichaList.length; f++) {
    var fp = fichaList[f];
    resolved.push(
      Object.assign({}, fp, {
        iniciativa: normalizeInitiativeScore(fp.iniciativa),
        iniciativa_fonte: "ficha",
        entrou_no_meio: false
      })
    );
  }

  resolved.sort(function (a, b) {
    if (b.iniciativa !== a.iniciativa) return b.iniciativa - a.iniciativa;
    var na = String(a.name || "");
    var nb = String(b.name || "");
    if (na !== nb) return na < nb ? -1 : 1;
    var ta = String(a.token_id || "");
    var tb = String(b.token_id || "");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  return {
    cascata_d20: d20,
    cascata_total: cascataTotal,
    ordem: resolved
  };
}

/**
 * Extrai a quantidade fixa de ações de monstros do bestiário, se definida
 * explicitamente de forma estruturada na ficha. Nunca inventa valores ausentes.
 *
 * @param {Object} sheetData
 * @returns {number|null}
 */
export function extractMonsterFixedActions(sheetData) {
  if (!sheetData || typeof sheetData !== "object") return null;
  var d =
    sheetData.data && typeof sheetData.data === "object"
      ? sheetData.data
      : sheetData.dados && typeof sheetData.dados === "object"
      ? sheetData.dados
      : sheetData;
  var keys = [
    "acoes_por_turno",
    "acoes_fixas",
    "acoesFixas",
    "acoesPorTurno",
    "actionsPerTurn",
    "fixedActions",
    "acoes"
  ];
  for (var i = 0; i < keys.length; i++) {
    var val = d[keys[i]];
    if (val === undefined || val === null || val === "" || typeof val === "boolean") {
      continue;
    }
    var n = Number(val);
    if (Number.isFinite(n) && n >= 0) {
      return Math.trunc(n);
    }
  }
  return null;
}

function normalizeConditionNameKey(rawName) {
  return String(rawName || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Inspeciona condições ativas de combate que afetam o orçamento de ações.
 *
 * @param {Array<{nome?:string, name?:string, id?:string, grau?:number, degree?:number}|string>} conditions
 * @param {{ inTotalCover?: boolean }} [options]
 * @returns {{
 *   isParalyzed: boolean,
 *   isUnconscious: boolean,
 *   inTotalCover: boolean,
 *   incapacitated: boolean,
 *   stunnedDegree: number,
 *   mustFlee: boolean,
 *   cannotMove: boolean,
 *   blocksComplexActions: boolean
 * }}
 */
export function inspectCombatConditionsForActions(conditions, options) {
  options = options || {};
  var list = Array.isArray(conditions) ? conditions : [];
  var isParalyzed = false;
  var isUnconscious = false;
  var inTotalCover = !!options.inTotalCover;
  var stunnedDegree = 0;
  var mustFlee = false;
  var cannotMove = false;
  var blocksComplexActions = false;

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item) continue;
    var rawName =
      typeof item === "string" ? item : item.nome || item.name || item.id || "";
    var key = normalizeConditionNameKey(rawName);
    if (!key) continue;

    if (key === "paralisado" || key === "paralizado") {
      isParalyzed = true;
    } else if (key === "inconsciente") {
      isUnconscious = true;
    } else if (key === "cobertura total") {
      inTotalCover = true;
    } else if (key === "atordoado") {
      var rawDeg =
        typeof item === "object" && item.grau !== undefined && item.grau !== null && item.grau !== ""
          ? item.grau
          : typeof item === "object" && item.degree !== undefined && item.degree !== null && item.degree !== ""
          ? item.degree
          : 1;
      var deg = parseInt(String(rawDeg), 10);
      stunnedDegree += isNaN(deg) ? 1 : Math.max(0, deg);
    } else if (key === "apavorado") {
      mustFlee = true;
    } else if (key === "imobilizado") {
      cannotMove = true;
    } else if (key === "enjoado") {
      blocksComplexActions = true;
    }
  }

  var incapacitated = isParalyzed || isUnconscious || inTotalCover;
  if (incapacitated) cannotMove = true;

  return {
    isParalyzed: isParalyzed,
    isUnconscious: isUnconscious,
    inTotalCover: inTotalCover,
    incapacitated: incapacitated,
    stunnedDegree: stunnedDegree,
    mustFlee: mustFlee,
    cannotMove: cannotMove,
    blocksComplexActions: blocksComplexActions
  };
}

/**
 * Avalia sobrecarga exclusivamente a partir dos dados puros da ficha, sem DOM.
 *
 * @param {Object} sheetData
 * @param {{ isOverloaded?: boolean, overloadBonusPenalty?: number, rulesOverride?: Object }} [options]
 */
export function evaluateSheetOverloadForActions(sheetData, options) {
  options = options || {};
  if (typeof options.isOverloaded === "boolean") {
    var pen =
      typeof options.overloadBonusPenalty === "number"
        ? options.overloadBonusPenalty
        : 2;
    return {
      overloaded: options.isOverloaded,
      looseCount: 0,
      capacity: 0,
      defensePenalty: options.isOverloaded ? 5 : 0,
      movementPenaltyMeters: options.isOverloaded ? 3 : 0,
      bonusActionsLost: options.isOverloaded ? pen : 0
    };
  }
  if (sheetData && typeof sheetData === "object" && Array.isArray(sheetData.inventoryItems)) {
    var atletismo = getSkillLevelFromSheetData(sheetData, "pericia-atletismo");
    var capacity = calculateLooseLoadCapacity(atletismo, 2, 2);
    var looseCount = countLooseLoadItems(sheetData.inventoryItems);
    return evaluateOverloadState(looseCount, capacity, options.rulesOverride);
  }
  return {
    overloaded: false,
    looseCount: 0,
    capacity: 2,
    defensePenalty: 0,
    movementPenaltyMeters: 0,
    bonusActionsLost: 0
  };
}

/**
 * Calcula o contrato completo de orçamento inicial de ações por turno e instância
 * (`ActionBudgetContract`) respeitando COM-02, COM-05 e COM-06.
 * Usa exclusivamente a iniciativa vigente da rodada (`currentInitiative`), ignorando
 * `nextRoundInitiative`. Não implementa consumo nem reserva nesta etapa.
 *
 * @param {Object} params
 * @param {string|null} [params.combatantId]
 * @param {number} [params.round=1]
 * @param {"player"|"npc_human"|"npc_veteran"|"bestiary_monster"} [params.kind]
 * @param {"full_sheet"|"creature_mode"|null} [params.operationalMode]
 * @param {boolean} [params.isOfficialMonster]
 * @param {number} [params.currentInitiative=0]
 * @param {number|null} [params.nextRoundInitiative=null]
 * @param {Object|null} [params.sheetData=null]
 * @param {Array} [params.conditions]
 * @param {boolean} [params.isOverloaded]
 * @param {number} [params.overloadBonusPenalty=2]
 * @param {boolean} [params.inTotalCover=false]
 * @param {number|null} [params.fixedActions]
 * @returns {Object}
 */
export function computeTurnActionBudget(params) {
  params = params || {};
  var d =
    params.sheetData && typeof params.sheetData === "object"
      ? params.sheetData.data && typeof params.sheetData.data === "object"
        ? params.sheetData.data
        : params.sheetData.dados && typeof params.sheetData.dados === "object"
        ? params.sheetData.dados
        : params.sheetData
      : null;

  var roundNum = Math.max(1, parseInt(String(params.round || 1), 10) || 1);
  var kind = params.kind || "npc_human";
  var opMode =
    params.operationalMode === "creature_mode" || params.operationalMode === "full_sheet"
      ? params.operationalMode
      : null;
  var isMonster = !!params.isOfficialMonster || kind === "bestiary_monster";
  var currentInit = normalizeInitiativeScore(params.currentInitiative);
  var condList = Array.isArray(params.conditions)
    ? params.conditions
    : d && Array.isArray(d.activeConditions)
    ? d.activeConditions
    : [];
  var cond = inspectCombatConditionsForActions(condList, {
    inTotalCover: !!params.inTotalCover
  });

  // 1. NPC legado sem modalidade definida não assume orçamento simplificado ou avançado.
  if (opMode === null && kind !== "player" && !isMonster) {
    return {
      combatantId: params.combatantId || null,
      round: roundNum,
      kind: kind,
      operationalMode: null,
      currentInitiative: currentInit,
      budgetDefined: false,
      pendingReason: "legacy_npc_operational_mode_unset",
      baseActions: null,
      bonusActionsRaw: 0,
      bonusActionsLostOverload: 0,
      bonusActionsLostConditions: 0,
      effectiveBonusActions: 0,
      initialBudget: null,
      spentActions: 0,
      reservedActions: 0,
      availableActions: null,
      isOverloaded: false,
      incapacitated: cond.incapacitated,
      conditionsSummary: cond,
      ledger: []
    };
  }

  // 2. Monstro oficial / do bestiário: quantidade fixa definida na ficha, nunca escala com cascata.
  if (isMonster) {
    var fixedActions =
      params.fixedActions !== undefined && params.fixedActions !== null
        ? Number.isFinite(Number(params.fixedActions)) && Number(params.fixedActions) >= 0
          ? Math.trunc(Number(params.fixedActions))
          : null
        : extractMonsterFixedActions(d);

    if (fixedActions === null) {
      return {
        combatantId: params.combatantId || null,
        round: roundNum,
        kind: "bestiary_monster",
        operationalMode: opMode || "creature_mode",
        currentInitiative: currentInit,
        budgetDefined: false,
        pendingReason: "bestiary_monster_fixed_actions_undefined",
        baseActions: null,
        bonusActionsRaw: 0,
        bonusActionsLostOverload: 0,
        bonusActionsLostConditions: 0,
        effectiveBonusActions: 0,
        initialBudget: null,
        spentActions: 0,
        reservedActions: 0,
        availableActions: null,
        isOverloaded: false,
        incapacitated: cond.incapacitated,
        conditionsSummary: cond,
        ledger: []
      };
    }

    var monsterActions = cond.incapacitated ? 0 : Math.max(0, fixedActions);
    return {
      combatantId: params.combatantId || null,
      round: roundNum,
      kind: "bestiary_monster",
      operationalMode: opMode || "creature_mode",
      currentInitiative: currentInit,
      budgetDefined: true,
      pendingReason: null,
      baseActions: monsterActions,
      bonusActionsRaw: 0,
      bonusActionsLostOverload: 0,
      bonusActionsLostConditions: 0,
      effectiveBonusActions: 0,
      initialBudget: monsterActions,
      spentActions: 0,
      reservedActions: 0,
      availableActions: monsterActions,
      isOverloaded: false,
      incapacitated: cond.incapacitated,
      conditionsSummary: cond,
      ledger: []
    };
  }

  // 3. NPC Criatura (humano ou Veterano em creature_mode): exatamente 1 ação básica, sem bônus de iniciativa.
  if (opMode === "creature_mode") {
    var creatureActions = cond.incapacitated ? 0 : 1;
    return {
      combatantId: params.combatantId || null,
      round: roundNum,
      kind: kind,
      operationalMode: "creature_mode",
      currentInitiative: currentInit,
      budgetDefined: true,
      pendingReason: null,
      baseActions: creatureActions,
      bonusActionsRaw: 0,
      bonusActionsLostOverload: 0,
      bonusActionsLostConditions: 0,
      effectiveBonusActions: 0,
      initialBudget: creatureActions,
      spentActions: 0,
      reservedActions: 0,
      availableActions: creatureActions,
      isOverloaded: false,
      incapacitated: cond.incapacitated,
      conditionsSummary: cond,
      ledger: []
    };
  }

  // 4. Personagem jogador ou NPC Avançado (full_sheet): 1 + floor(iniciativa / 5) - sobrecarga - Atordoado.
  var ov = evaluateSheetOverloadForActions(d, {
    isOverloaded: params.isOverloaded,
    overloadBonusPenalty: params.overloadBonusPenalty
  });
  var actCalc = calculateActionsFromInitiative(
    currentInit,
    !!ov.overloaded,
    ov.bonusActionsLost
  );
  var lostOverload = ov.overloaded ? actCalc.lostBonusActions : 0;
  var lostConditions = cond.stunnedDegree;

  if (cond.incapacitated) {
    return {
      combatantId: params.combatantId || null,
      round: roundNum,
      kind: kind,
      operationalMode: "full_sheet",
      currentInitiative: currentInit,
      budgetDefined: true,
      pendingReason: null,
      baseActions: 0,
      bonusActionsRaw: actCalc.baseBonusActions,
      bonusActionsLostOverload: lostOverload,
      bonusActionsLostConditions: lostConditions,
      effectiveBonusActions: 0,
      initialBudget: 0,
      spentActions: 0,
      reservedActions: 0,
      availableActions: 0,
      isOverloaded: !!ov.overloaded,
      incapacitated: true,
      conditionsSummary: cond,
      ledger: []
    };
  }

  var effectiveBonus = Math.max(
    0,
    actCalc.baseBonusActions - lostOverload - lostConditions
  );
  var initialBudget = actCalc.baseActions + effectiveBonus;

  return {
    combatantId: params.combatantId || null,
    round: roundNum,
    kind: kind,
    operationalMode: "full_sheet",
    currentInitiative: currentInit,
    budgetDefined: true,
    pendingReason: null,
    baseActions: actCalc.baseActions,
    bonusActionsRaw: actCalc.baseBonusActions,
    bonusActionsLostOverload: lostOverload,
    bonusActionsLostConditions: lostConditions,
    effectiveBonusActions: effectiveBonus,
    initialBudget: initialBudget,
    spentActions: 0,
    reservedActions: 0,
    availableActions: initialBudget,
    isOverloaded: !!ov.overloaded,
    incapacitated: false,
    conditionsSummary: cond,
    ledger: []
  };
}

/**
 * Custos canônicos de ações no motor de combate (COM-08).
 * O frontend e o backend utilizam este contrato para rejeitar custos adulterados.
 */
export var CANONICAL_ACTION_COSTS = Object.freeze({
  atacar: 1,
  mover: 1,
  mirar: 1,
  recarregar: 1,
  usar_item: 1,
  magia: 1,
  narrativa: 1,
  apagar_fogo: 1,
  em_chamas: 1,
  ataque_oportunidade: 1,
  reacao: 1,
  ataque_aprimorado_inebriado: 1,
  limpar_olhos: 2,
  remover_cego_fuligem: 2,
  salto_das_sombras: 2,
  onda_de_dejetos: 2,
  quebrar_objeto: 2,
  habilidade_2_acoes: 2,
  remover_desorientado: 3
});

export var ALLOWED_REACTION_ACTION_TYPES = Object.freeze([
  "ataque_oportunidade",
  "reacao",
  "custom"
]);

/**
 * Resolve e valida o custo canônico de uma ação de combate sem confiar em custo arbitrário.
 * Ações "custom" exigem Mestre autorizado (`options.isMestre === true`) e justificativa explícita.
 *
 * @param {string} actionType
 * @param {number|string|null|undefined} [requestedCost]
 * @param {{ isMestre?: boolean, reason?: string|null, justificativa?: string|null }} [options]
 * @returns {{ valid: boolean, cost: number|null, errorCode: string|null, reason?: string|null }}
 */
export function resolveCanonicalActionCost(actionType, requestedCost, options) {
  options = options || {};
  var key = String(actionType || "").trim().toLowerCase();
  if (!key) {
    return { valid: false, cost: null, errorCode: "INVALID_ACTION_TYPE" };
  }

  var reason = String(
    options.reason !== undefined ? options.reason : (options.justificativa || "")
  ).trim();

  if (key === "custom") {
    if (options.isMestre !== true) {
      return { valid: false, cost: null, errorCode: "CUSTOM_ACTION_REQUIRES_GM" };
    }
    if (
      requestedCost === undefined ||
      requestedCost === null ||
      requestedCost === "" ||
      typeof requestedCost === "boolean"
    ) {
      return { valid: false, cost: null, errorCode: "INVALID_CUSTOM_ACTION_COST" };
    }
    var customCost = Number(requestedCost);
    if (!Number.isFinite(customCost) || Math.trunc(customCost) !== customCost || customCost < 1 || customCost > 10) {
      return { valid: false, cost: null, errorCode: "INVALID_CUSTOM_ACTION_COST" };
    }
    if (!reason) {
      return { valid: false, cost: null, errorCode: "CUSTOM_ACTION_REQUIRES_JUSTIFICATION" };
    }
    return { valid: true, cost: Math.trunc(customCost), errorCode: null, reason: reason };
  }

  var hasRequested =
    requestedCost !== undefined && requestedCost !== null && requestedCost !== "";
  var parsedRequested = null;
  if (hasRequested) {
    if (typeof requestedCost === "boolean") {
      return { valid: false, cost: null, errorCode: "INVALID_OR_TAMPERED_COST" };
    }
    var n = Number(requestedCost);
    if (!Number.isFinite(n) || Math.trunc(n) !== n || n < 1) {
      return { valid: false, cost: null, errorCode: "INVALID_OR_TAMPERED_COST" };
    }
    parsedRequested = n;
  }

  if (Object.prototype.hasOwnProperty.call(CANONICAL_ACTION_COSTS, key)) {
    var canonical = CANONICAL_ACTION_COSTS[key];
    if (hasRequested && parsedRequested !== canonical) {
      return { valid: false, cost: null, errorCode: "INVALID_OR_TAMPERED_COST" };
    }
    return { valid: true, cost: canonical, errorCode: null, reason: reason || null };
  }

  return { valid: false, cost: null, errorCode: "UNKNOWN_ACTION_TYPE" };
}

function summarizeActionLedger(ledger) {
  var list = Array.isArray(ledger) ? ledger : [];
  var spent = 0;
  var reserved = 0;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || typeof e !== "object") continue;
    var c = Math.max(0, Math.trunc(Number(e.cost) || 0));
    if (e.status === "committed") spent += c;
    else if (e.status === "reserved") reserved += c;
  }
  return { spentActions: spent, reservedActions: reserved };
}

/**
 * Calcula o saldo disponível derivado diretamente de `initialBudget - gastas - reservadas`.
 * Nunca é armazenado como segunda fonte autoritativa independente.
 *
 * @param {Object|null} actionState
 * @returns {number|null}
 */
export function computeAvailableActionsFromState(actionState) {
  if (
    !actionState ||
    typeof actionState !== "object" ||
    !actionState.budgetDefined ||
    actionState.initialBudget === null ||
    actionState.initialBudget === undefined
  ) {
    return null;
  }
  var initial = Math.max(0, Math.trunc(Number(actionState.initialBudget) || 0));
  var sums = summarizeActionLedger(actionState.ledger);
  return Math.max(0, initial - sums.spentActions - sums.reservedActions);
}

/**
 * Indica se há reservas pendentes impedindo o encerramento da rodada.
 *
 * @param {Object|null} actionState
 * @returns {boolean}
 */
export function hasPendingActionReservations(actionState) {
  if (!actionState || !Array.isArray(actionState.ledger)) return false;
  for (var i = 0; i < actionState.ledger.length; i++) {
    var entry = actionState.ledger[i];
    if (entry && entry.status === "reserved") return true;
  }
  return false;
}

/**
 * Cria o estado canônico de ações (COM-08) para uma instância de combatente na rodada,
 * consultando exclusivamente `computeTurnActionBudget` (sem duplicar fórmulas).
 *
 * @param {Object} params
 * @returns {Object}
 */
export function createCombatantActionState(params) {
  params = params || {};
  var budget =
    params.precomputedBudget && typeof params.precomputedBudget === "object"
      ? params.precomputedBudget
      : computeTurnActionBudget(params);

  return {
    mesaId: params.mesaId ? String(params.mesaId) : null,
    combateId: params.combateId ? String(params.combateId) : null,
    mapaId: params.mapaId ? String(params.mapaId) : null,
    round: Math.max(1, parseInt(String(params.round || budget.round || 1), 10) || 1),
    combatantId: params.combatantId ? String(params.combatantId) : budget.combatantId || null,
    instanceId: params.instanceId ? String(params.instanceId) : null,
    kind: budget.kind,
    operationalMode: budget.operationalMode,
    currentInitiative: budget.currentInitiative,
    budgetDefined: !!budget.budgetDefined,
    pendingReason: budget.pendingReason || null,
    initialBudget: budget.budgetDefined ? budget.initialBudget : null,
    spentActions: 0,
    reservedActions: 0,
    turnEnded: !!params.turnEnded,
    version: Math.max(1, parseInt(String(params.version || 1), 10) || 1),
    ledger: [],
    auditLog: [],
    opResults: {}
  };
}

export var MAX_ROUND_ACTION_ENTRIES = 64;

/**
 * Máquina pura, idempotente e auditável de mutações do Action Controller (COM-08).
 *
 * @param {Object} actionState
 * @param {Object} opRequest
 * @returns {Object}
 */
export function applyActionControllerOperation(actionState, opRequest) {
  opRequest = opRequest || {};
  if (!actionState || typeof actionState !== "object") {
    return { ok: false, errorCode: "STATE_NOT_INITIALIZED", state: null };
  }

  var state = JSON.parse(JSON.stringify(actionState));
  if (!Array.isArray(state.ledger)) state.ledger = [];
  if (!Array.isArray(state.auditLog)) state.auditLog = [];
  if (!state.opResults || typeof state.opResults !== "object") state.opResults = {};

  var opId = String(opRequest.opId || "").trim();
  if (!opId) {
    return { ok: false, errorCode: "MISSING_OP_ID", state: state };
  }

  var operation = String(opRequest.operation || "").trim().toLowerCase();

  // Idempotência estrita: repetição após perda de rede retorna resultado original somente se o payload coincidir.
  if (Object.prototype.hasOwnProperty.call(state.opResults, opId)) {
    var prevResult = JSON.parse(JSON.stringify(state.opResults[opId]));
    var sameOp = operation === String(prevResult.operation || "");
    var payloadMatches = sameOp;
    if (payloadMatches && operation === "reserve") {
      var reqType = String(opRequest.actionType || "").trim().toLowerCase();
      var reqReact = !!opRequest.isReaction;
      var hasReqCost =
        opRequest.cost !== undefined && opRequest.cost !== null && opRequest.cost !== "";
      var reqResId = String(opRequest.reservationId || "").trim();
      var hasReqReason =
        opRequest.reason !== undefined || opRequest.justificativa !== undefined;
      var reqReasonNorm = hasReqReason
        ? String(
            opRequest.reason !== undefined ? opRequest.reason : (opRequest.justificativa || "")
          ).trim() || null
        : null;
      payloadMatches =
        reqType === String(prevResult.actionType || "") &&
        reqReact === !!prevResult.isReaction &&
        (!hasReqCost || Number(opRequest.cost) === Number(prevResult.cost)) &&
        (!reqResId || reqResId === String(prevResult.reservationId || "")) &&
        (!hasReqReason || reqReasonNorm === (prevResult.reason || null));
    } else if (payloadMatches && (operation === "commit" || operation === "cancel")) {
      var replayKey = String(opRequest.reservationId || opRequest.targetOpId || "").trim();
      var prevResId = String(prevResult.reservationId || "");
      var matchedLedgerEntry = state.ledger.find(function (e) {
        return e && String(e.opId || "") === replayKey && String(e.reservationId || "") === prevResId;
      });
      payloadMatches =
        !replayKey ||
        replayKey === prevResId ||
        ("res_" + replayKey) === prevResId ||
        !!matchedLedgerEntry;
    }
    if (!payloadMatches) {
      return {
        ok: false,
        errorCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        sqlstate: "22023",
        state: state
      };
    }
    prevResult.idempotentReplay = true;
    prevResult.state = state;
    return prevResult;
  }

  // Fallback contra descarte na janela recente (64) de opResults: mantém idempotência mesmo após 65+ ops na rodada
  var evictedEntry = state.ledger.find(function (e) {
    return e && (String(e.opId || "") === opId || String(e.finalOpId || "") === opId);
  });
  if (evictedEntry) {
    var evictedIsReserve = String(evictedEntry.opId || "") === opId;
    var evictedMatches = false;
    var evictedReplay = null;
    if (evictedIsReserve) {
      var evReqType = String(opRequest.actionType || "").trim().toLowerCase();
      var evReqReact = !!opRequest.isReaction;
      var evHasCost = opRequest.cost !== undefined && opRequest.cost !== null && opRequest.cost !== "";
      var evReqResId = String(opRequest.reservationId || "").trim();
      var evHasReason = opRequest.reason !== undefined || opRequest.justificativa !== undefined;
      var evReqReason = evHasReason
        ? String(opRequest.reason !== undefined ? opRequest.reason : (opRequest.justificativa || "")).trim() || null
        : null;
      evictedMatches =
        operation === "reserve" &&
        evReqType === String(evictedEntry.actionType || "") &&
        evReqReact === !!evictedEntry.isReaction &&
        (!evHasCost || Number(opRequest.cost) === Number(evictedEntry.cost)) &&
        (!evReqResId || evReqResId === String(evictedEntry.reservationId || "")) &&
        (!evHasReason || evReqReason === (evictedEntry.reason || null));
      evictedReplay = {
        ok: true,
        idempotentReplay: true,
        evictedFromRecentCache: true,
        operation: "reserve",
        opId: opId,
        reservationId: evictedEntry.reservationId,
        actionType: evictedEntry.actionType,
        cost: evictedEntry.cost,
        isReaction: !!evictedEntry.isReaction,
        reason: evictedEntry.reason || null,
        authorizedByGm: !!evictedEntry.authorizedByGm,
        status: evictedEntry.status,
        version: Number(state.version || 1),
        spentActions: Number(state.spentActions || 0),
        reservedActions: Number(state.reservedActions || 0),
        availableActions: computeAvailableActionsFromState(state),
        state: state
      };
    } else {
      var evReplayKey = String(opRequest.reservationId || opRequest.targetOpId || "").trim();
      var evResId = String(evictedEntry.reservationId || "");
      evictedMatches =
        operation === String(evictedEntry.finalOperation || "") &&
        (!evReplayKey || evReplayKey === evResId || ("res_" + evReplayKey) === evResId || evReplayKey === String(evictedEntry.opId || ""));
      evictedReplay = {
        ok: true,
        idempotentReplay: true,
        evictedFromRecentCache: true,
        operation: evictedEntry.finalOperation,
        opId: opId,
        reservationId: evictedEntry.reservationId,
        actionType: evictedEntry.actionType,
        cost: evictedEntry.cost,
        isReaction: !!evictedEntry.isReaction,
        reason: evictedEntry.reason || null,
        authorizedByGm: !!evictedEntry.authorizedByGm,
        status: evictedEntry.status,
        version: Number(state.version || 1),
        spentActions: Number(state.spentActions || 0),
        reservedActions: Number(state.reservedActions || 0),
        availableActions: computeAvailableActionsFromState(state),
        state: state
      };
    }
    if (!evictedMatches) {
      return {
        ok: false,
        errorCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        sqlstate: "22023",
        state: state
      };
    }
    return evictedReplay;
  }

  if (
    opRequest.combateId !== undefined &&
    opRequest.combateId !== null &&
    state.combateId !== null &&
    String(opRequest.combateId) !== String(state.combateId)
  ) {
    return { ok: false, errorCode: "COMBAT_MISMATCH", state: state };
  }
  if (
    opRequest.mapaId !== undefined &&
    opRequest.mapaId !== null &&
    state.mapaId !== null &&
    String(opRequest.mapaId) !== String(state.mapaId)
  ) {
    return { ok: false, errorCode: "MAP_MISMATCH", state: state };
  }
  if (
    opRequest.round !== undefined &&
    opRequest.round !== null &&
    Number(opRequest.round) !== Number(state.round)
  ) {
    return { ok: false, errorCode: "ROUND_MISMATCH", state: state };
  }
  if (
    opRequest.expectedVersion !== undefined &&
    opRequest.expectedVersion !== null &&
    Number(opRequest.expectedVersion) !== Number(state.version)
  ) {
    return {
      ok: false,
      errorCode: "STALE_STATE_VERSION",
      expectedVersion: opRequest.expectedVersion,
      actualVersion: state.version,
      state: state
    };
  }

  var nowIso = opRequest.timestamp || new Date().toISOString();
  var actorUserId = opRequest.actorUserId ? String(opRequest.actorUserId) : null;
  var isMestre = opRequest.isMestre === true;
  var requestReason = String(
    opRequest.reason !== undefined ? opRequest.reason : (opRequest.justificativa || "")
  ).trim() || null;
  var targetEntry = null;
  var outPayload = null;

  if (operation === "reserve") {
    if (!state.budgetDefined || state.initialBudget === null) {
      return { ok: false, errorCode: "BUDGET_UNDEFINED", sqlstate: "22023", state: state };
    }
    if (state.ledger.length >= MAX_ROUND_ACTION_ENTRIES) {
      return {
        ok: false,
        errorCode: "ACTION_LEDGER_LIMIT_EXCEEDED",
        sqlstate: "22023",
        state: state
      };
    }
    var isReaction = !!opRequest.isReaction;
    var actionKey = String(opRequest.actionType || "").trim().toLowerCase();
    if (actionKey === "custom" && !isMestre) {
      return {
        ok: false,
        errorCode: "CUSTOM_ACTION_REQUIRES_GM",
        sqlstate: "42501",
        state: state
      };
    }
    if ((state.turnEnded || opRequest.isCurrentTurn === false) && !isReaction) {
      return {
        ok: false,
        errorCode: "OUT_OF_TURN_NORMAL_ACTION_FORBIDDEN",
        sqlstate: "22023",
        state: state
      };
    }
    if (isReaction) {
      if (ALLOWED_REACTION_ACTION_TYPES.indexOf(actionKey) < 0) {
        return {
          ok: false,
          errorCode: "INVALID_REACTION_ACTION_TYPE",
          sqlstate: "22023",
          state: state
        };
      }
      if (!isMestre || opRequest.gmAuthorizedReaction === false) {
        return {
          ok: false,
          errorCode: "REACTION_REQUIRES_GM_AUTHORIZATION",
          sqlstate: "42501",
          state: state
        };
      }
    }
    var costCheck = resolveCanonicalActionCost(opRequest.actionType, opRequest.cost, {
      isMestre: isMestre,
      reason: requestReason
    });
    if (!costCheck.valid) {
      return {
        ok: false,
        errorCode: costCheck.errorCode,
        sqlstate: costCheck.errorCode === "CUSTOM_ACTION_REQUIRES_GM" ? "42501" : "22023",
        state: state
      };
    }
    var availableBefore = computeAvailableActionsFromState(state);
    if (costCheck.cost > availableBefore) {
      return {
        ok: false,
        errorCode: "INSUFFICIENT_AVAILABLE_ACTIONS",
        sqlstate: "22023",
        availableActions: availableBefore,
        requestedCost: costCheck.cost,
        state: state
      };
    }

    var reservationId = opRequest.reservationId
      ? String(opRequest.reservationId)
      : "res_" + opId;
    var resolvedReason = costCheck.reason || requestReason;
    targetEntry = {
      opId: opId,
      reservationId: reservationId,
      actionType: actionKey,
      cost: costCheck.cost,
      isReaction: isReaction,
      authorizedByGm: isMestre,
      reason: resolvedReason,
      status: "reserved",
      resultRevealed: false,
      actorUserId: actorUserId,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.ledger.push(targetEntry);
    outPayload = {
      ok: true,
      idempotentReplay: false,
      operation: "reserve",
      opId: opId,
      reservationId: reservationId,
      actionType: targetEntry.actionType,
      cost: targetEntry.cost,
      isReaction: isReaction,
      reason: resolvedReason,
      authorizedByGm: isMestre,
      status: "reserved"
    };
  } else if (operation === "commit") {
    var commitKey = String(opRequest.reservationId || opRequest.targetOpId || "").trim();
    targetEntry = state.ledger.find(function (e) {
      return e && (String(e.reservationId) === commitKey || String(e.opId) === commitKey);
    });
    if (!targetEntry) {
      return { ok: false, errorCode: "RESERVATION_NOT_FOUND", sqlstate: "22023", state: state };
    }
    if (targetEntry.status !== "reserved") {
      return {
        ok: false,
        errorCode: "RESERVATION_NOT_PENDING",
        sqlstate: "22023",
        currentStatus: targetEntry.status,
        state: state
      };
    }
    var commitIsReaction = !!opRequest.isReaction || !!targetEntry.isReaction;
    if (commitIsReaction) {
      var targetActionKey = String(targetEntry.actionType || "").trim().toLowerCase();
      if (ALLOWED_REACTION_ACTION_TYPES.indexOf(targetActionKey) < 0) {
        return {
          ok: false,
          errorCode: "INVALID_REACTION_ACTION_TYPE",
          sqlstate: "22023",
          state: state
        };
      }
      if ((opRequest.isReaction === true && !isMestre) || (!targetEntry.authorizedByGm && !isMestre)) {
        return {
          ok: false,
          errorCode: "REACTION_REQUIRES_GM_AUTHORIZATION",
          sqlstate: "42501",
          state: state
        };
      }
    }
    targetEntry.status = "committed";
    targetEntry.resultRevealed = opRequest.resultRevealed !== false;
    targetEntry.finalOpId = opId;
    targetEntry.finalOperation = "commit";
    targetEntry.updatedAt = nowIso;
    outPayload = {
      ok: true,
      idempotentReplay: false,
      operation: "commit",
      opId: opId,
      reservationId: targetEntry.reservationId,
      actionType: targetEntry.actionType,
      cost: targetEntry.cost,
      isReaction: !!targetEntry.isReaction,
      reason: targetEntry.reason || requestReason,
      authorizedByGm: Boolean(targetEntry.authorizedByGm || isMestre),
      status: "committed"
    };
  } else if (operation === "cancel") {
    var cancelKey = String(opRequest.reservationId || opRequest.targetOpId || "").trim();
    targetEntry = state.ledger.find(function (e) {
      return e && (String(e.reservationId) === cancelKey || String(e.opId) === cancelKey);
    });
    if (!targetEntry) {
      return { ok: false, errorCode: "RESERVATION_NOT_FOUND", sqlstate: "22023", state: state };
    }
    if (
      targetEntry.status === "committed" ||
      targetEntry.resultRevealed === true ||
      opRequest.resultRevealed === true
    ) {
      return {
        ok: false,
        errorCode: "CANCEL_FORBIDDEN_ALREADY_COMMITTED",
        sqlstate: "22023",
        state: state
      };
    }
    if (targetEntry.status === "cancelled") {
      return {
        ok: false,
        errorCode: "RESERVATION_ALREADY_CANCELLED",
        sqlstate: "22023",
        state: state
      };
    }
    targetEntry.status = "cancelled";
    targetEntry.finalOpId = opId;
    targetEntry.finalOperation = "cancel";
    targetEntry.updatedAt = nowIso;
    outPayload = {
      ok: true,
      idempotentReplay: false,
      operation: "cancel",
      opId: opId,
      reservationId: targetEntry.reservationId,
      actionType: targetEntry.actionType,
      cost: targetEntry.cost,
      isReaction: !!targetEntry.isReaction,
      reason: targetEntry.reason || requestReason,
      authorizedByGm: Boolean(targetEntry.authorizedByGm || isMestre),
      status: "cancelled"
    };
  } else {
    return { ok: false, errorCode: "UNSUPPORTED_OPERATION", sqlstate: "22023", state: state };
  }

  var sumsAfter = summarizeActionLedger(state.ledger);
  state.spentActions = sumsAfter.spentActions;
  state.reservedActions = sumsAfter.reservedActions;
  state.version = Number(state.version || 1) + 1;

  var availableAfter = computeAvailableActionsFromState(state);
  var nextSeq =
    state.auditLog.length > 0
      ? Number(state.auditLog[state.auditLog.length - 1].seq || state.auditLog.length) + 1
      : 1;
  state.auditLog.push({
    seq: nextSeq,
    opId: opId,
    operation: outPayload.operation,
    reservationId: outPayload.reservationId,
    actionType: outPayload.actionType,
    cost: outPayload.cost,
    isReaction: !!outPayload.isReaction,
    reason: outPayload.reason || null,
    authorizedByGm: !!outPayload.authorizedByGm,
    statusAfter: outPayload.status,
    versionAfter: state.version,
    spentActions: state.spentActions,
    reservedActions: state.reservedActions,
    availableActions: availableAfter,
    timestamp: nowIso,
    actorUserId: actorUserId
  });
  if (state.auditLog.length > MAX_ROUND_ACTION_ENTRIES) {
    state.auditLog = state.auditLog.slice(-MAX_ROUND_ACTION_ENTRIES);
  }

  outPayload.version = state.version;
  outPayload.spentActions = state.spentActions;
  outPayload.reservedActions = state.reservedActions;
  outPayload.availableActions = availableAfter;
  state.opResults[opId] = JSON.parse(JSON.stringify(outPayload));
  var opKeys = Object.keys(state.opResults);
  if (opKeys.length > MAX_ROUND_ACTION_ENTRIES) {
    opKeys.sort(function (a, b) {
      return (
        Number((state.opResults[b] && state.opResults[b].version) || 0) -
        Number((state.opResults[a] && state.opResults[a].version) || 0)
      );
    });
    for (var k = MAX_ROUND_ACTION_ENTRIES; k < opKeys.length; k++) {
      delete state.opResults[opKeys[k]];
    }
  }

  return Object.assign({}, outPayload, { state: state });
}
