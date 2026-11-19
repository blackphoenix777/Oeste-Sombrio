/**
 * Motor puro de regras para 6B próprio de NPCs, Veteranos e Bosses (XER-04)
 * e contratos formais de estado/transição por instância para XER-05 e XER-06.
 *
 * Este módulo NÃO importa DOM, window, OS ou cliente Supabase.
 */

export var ALLOWED_6B_DIE_TYPES = ["d4", "d6", "d8", "d10", "d12"];

export var DIE_TYPE_TO_SIDES = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12
};

export var DIE_SIDES_TO_TYPE = {
  "4": "d4",
  "6": "d6",
  "8": "d8",
  "10": "d10",
  "12": "d12"
};

export var MIN_OWN_6B_DICE = 1;
export var MAX_OWN_6B_DICE = 15;

export function createEmptyOwn6BCounts() {
  return { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 };
}

export function formatOwn6BComposition(counts) {
  if (!counts || typeof counts !== "object") return "";
  var clean = createEmptyOwn6BCounts();
  ALLOWED_6B_DIE_TYPES.forEach(function (die) {
    var v = Number(counts[die]);
    clean[die] = Number.isInteger(v) && v > 0 ? v : 0;
  });
  var keys = ALLOWED_6B_DIE_TYPES.filter(function (k) {
    return clean[k] > 0;
  });
  if (!keys.length) return "";

  var order =
    clean.d12 >= 6 && keys.length > 1
      ? ["d12", "d4", "d6", "d8", "d10"]
      : ["d4", "d6", "d8", "d10", "d12"];
  keys.sort(function (a, b) {
    return order.indexOf(a) - order.indexOf(b);
  });

  return keys
    .map(function (k) {
      return clean[k] + k;
    })
    .join(" + ");
}

/**
 * Faz o parse estrito de uma expressão textual de 6B (ex.: "4d6", "3d8 + 2d10", "15d12").
 * Rejeita tipos de dado inválidos (ex.: d20, d3), quantidades <= 0, tokens malformados
 * e totais acima de MAX_OWN_6B_DICE (15).
 */
export function parseStrictOwn6BString(rawStr, options) {
  options = options || {};
  var maxDice =
    typeof options.maxDice === "number" && options.maxDice > 0
      ? Math.trunc(options.maxDice)
      : MAX_OWN_6B_DICE;
  var text = String(rawStr == null ? "" : rawStr).trim();
  var counts = createEmptyOwn6BCounts();

  if (!text) {
    return {
      valid: false,
      empty: true,
      errorCode: "EMPTY_COMPOSITION",
      errorMessage: "O 6B próprio habilitado exige ao menos 1 dado (máximo " + maxDice + ").",
      counts: counts,
      totalDice: 0,
      invalidTokens: []
    };
  }

  var parts = text.split("+");
  var invalidTokens = [];
  var invalidDieTypes = [];
  var invalidCounts = [];

  for (var i = 0; i < parts.length; i++) {
    var token = String(parts[i] || "").trim();
    if (!token) {
      invalidTokens.push("(vazio)");
      continue;
    }
    var m = /^([+-]?\d+)\s*([a-zA-Z]\d+|\S+)$/.exec(token);
    if (!m) {
      invalidTokens.push(token);
      continue;
    }
    var qty = Number(m[1]);
    var dieRaw = String(m[2] || "").toLowerCase();
    if (!Number.isInteger(qty) || qty <= 0) {
      invalidCounts.push(token);
      continue;
    }
    if (ALLOWED_6B_DIE_TYPES.indexOf(dieRaw) === -1) {
      invalidDieTypes.push(dieRaw);
      continue;
    }
    counts[dieRaw] += qty;
  }

  if (invalidTokens.length > 0) {
    return {
      valid: false,
      empty: false,
      errorCode: "INVALID_SYNTAX",
      errorMessage:
        "Expressão de 6B inválida (" +
        invalidTokens.join(", ") +
        "). Use o formato Nd6 ou Nd8 + Md10.",
      counts: counts,
      totalDice: 0,
      invalidTokens: invalidTokens
    };
  }

  if (invalidCounts.length > 0) {
    return {
      valid: false,
      empty: false,
      errorCode: "INVALID_COUNT",
      errorMessage:
        "Quantidade de dados inválida (" +
        invalidCounts.join(", ") +
        "). Informe números inteiros positivos.",
      counts: counts,
      totalDice: 0,
      invalidTokens: invalidCounts
    };
  }

  if (invalidDieTypes.length > 0) {
    return {
      valid: false,
      empty: false,
      errorCode: "INVALID_DIE_TYPE",
      errorMessage:
        "Tipo de dado não permitido (" +
        invalidDieTypes.join(", ") +
        "). Tipos válidos: d4, d6, d8, d10 e d12.",
      counts: counts,
      totalDice: 0,
      invalidTokens: invalidDieTypes
    };
  }

  var totalDice = 0;
  ALLOWED_6B_DIE_TYPES.forEach(function (d) {
    totalDice += counts[d];
  });

  if (totalDice < MIN_OWN_6B_DICE) {
    return {
      valid: false,
      empty: true,
      errorCode: "EMPTY_COMPOSITION",
      errorMessage: "O 6B próprio habilitado exige ao menos 1 dado (máximo " + maxDice + ").",
      counts: counts,
      totalDice: totalDice,
      invalidTokens: []
    };
  }

  if (totalDice > maxDice) {
    return {
      valid: false,
      empty: false,
      errorCode: "MAX_DICE_EXCEEDED",
      errorMessage:
        "O 6B próprio permite no máximo " +
        maxDice +
        " dados (configurado: " +
        totalDice +
        ").",
      counts: counts,
      totalDice: totalDice,
      invalidTokens: []
    };
  }

  return {
    valid: true,
    empty: false,
    errorCode: null,
    errorMessage: null,
    counts: counts,
    totalDice: totalDice,
    invalidTokens: []
  };
}

/**
 * Valida e normaliza qualquer entrada de composição 6B próprio (string, objeto de contagens,
 * vetor de tipos/lados ou objeto de molde).
 */
export function validateOwn6BComposition(input, options) {
  options = options || {};
  var maxDice =
    typeof options.maxDice === "number" && options.maxDice > 0
      ? Math.trunc(options.maxDice)
      : MAX_OWN_6B_DICE;

  var explicitEnabled =
    options.enabled !== undefined
      ? !!options.enabled
      : input && typeof input === "object" && typeof input.enabled === "boolean"
      ? input.enabled
      : true;

  if (!explicitEnabled) {
    return {
      valid: true,
      enabled: false,
      errorCode: null,
      errorMessage: null,
      totalDice: 0,
      counts: createEmptyOwn6BCounts(),
      compactCounts: {},
      diceTypes: [],
      dicePoolDesc: [],
      diceSides: [],
      formatted: ""
    };
  }

  var counts = createEmptyOwn6BCounts();

  if (typeof input === "string") {
    var parsedStr = parseStrictOwn6BString(input, { maxDice: maxDice });
    if (!parsedStr.valid) {
      return {
        valid: false,
        enabled: true,
        errorCode: parsedStr.errorCode,
        errorMessage: parsedStr.errorMessage,
        totalDice: parsedStr.totalDice,
        counts: parsedStr.counts,
        compactCounts: {},
        diceTypes: [],
        dicePoolDesc: [],
        diceSides: [],
        formatted: ""
      };
    }
    counts = parsedStr.counts;
  } else if (Array.isArray(input)) {
    for (var a = 0; a < input.length; a++) {
      var item = input[a];
      var dieKey = null;
      if (typeof item === "number" || /^\d+$/.test(String(item))) {
        dieKey = DIE_SIDES_TO_TYPE[String(item)] || null;
      } else if (typeof item === "string") {
        var normDie = item.trim().toLowerCase();
        if (ALLOWED_6B_DIE_TYPES.indexOf(normDie) >= 0) dieKey = normDie;
      }
      if (!dieKey) {
        return {
          valid: false,
          enabled: true,
          errorCode: "INVALID_DIE_TYPE",
          errorMessage:
            "Tipo de dado não permitido (" +
            String(item) +
            "). Tipos válidos: d4, d6, d8, d10 e d12.",
          totalDice: 0,
          counts: createEmptyOwn6BCounts(),
          compactCounts: {},
          diceTypes: [],
          dicePoolDesc: [],
          diceSides: [],
          formatted: ""
        };
      }
      counts[dieKey] += 1;
    }
  } else if (input && typeof input === "object") {
    var sourceMap =
      input.counts && typeof input.counts === "object"
        ? input.counts
        : input.config6B && typeof input.config6B === "object"
        ? input.config6B
        : input;

    if (
      Array.isArray(input.diceTypes) &&
      input.diceTypes.length > 0 &&
      (!input.counts || typeof input.counts !== "object")
    ) {
      return validateOwn6BComposition(input.diceTypes, options);
    }
    if (
      typeof input.formatted === "string" &&
      input.formatted.trim() !== "" &&
      (!input.counts || typeof input.counts !== "object")
    ) {
      return validateOwn6BComposition(input.formatted, options);
    }

    var metaKeys = {
      enabled: true,
      schemaVersion: true,
      totalDice: true,
      diceTypes: true,
      dicePoolDesc: true,
      diceSides: true,
      formatted: true,
      compactCounts: true,
      poolSource: true,
      isExplicit: true,
      isLegacy: true
    };

    var rawKeys = Object.keys(sourceMap);
    for (var kIdx = 0; kIdx < rawKeys.length; kIdx++) {
      var rawK = rawKeys[kIdx];
      if (sourceMap === input && metaKeys[rawK]) continue;
      var mappedDie = ALLOWED_6B_DIE_TYPES.indexOf(rawK.toLowerCase()) >= 0
        ? rawK.toLowerCase()
        : DIE_SIDES_TO_TYPE[String(rawK)] || null;
      var rawVal = sourceMap[rawK];
      if (!mappedDie) {
        if (rawVal !== 0 && rawVal !== "0" && rawVal != null && rawVal !== "") {
          return {
            valid: false,
            enabled: true,
            errorCode: "INVALID_DIE_TYPE",
            errorMessage:
              "Tipo de dado não permitido (" +
              rawK +
              "). Tipos válidos: d4, d6, d8, d10 e d12.",
            totalDice: 0,
            counts: createEmptyOwn6BCounts(),
            compactCounts: {},
            diceTypes: [],
            dicePoolDesc: [],
            diceSides: [],
            formatted: ""
          };
        }
        continue;
      }
      if (rawVal === "" || rawVal == null) {
        counts[mappedDie] += 0;
        continue;
      }
      var numVal = Number(rawVal);
      if (!Number.isInteger(numVal) || numVal < 0) {
        return {
          valid: false,
          enabled: true,
          errorCode: "INVALID_COUNT",
          errorMessage:
            "Quantidade inválida para " +
            mappedDie +
            " (" +
            String(rawVal) +
            "). Informe um inteiro entre 0 e " +
            maxDice +
            ".",
          totalDice: 0,
          counts: createEmptyOwn6BCounts(),
          compactCounts: {},
          diceTypes: [],
          dicePoolDesc: [],
          diceSides: [],
          formatted: ""
        };
      }
      counts[mappedDie] += numVal;
    }
  } else {
    return {
      valid: false,
      enabled: true,
      errorCode: "EMPTY_COMPOSITION",
      errorMessage: "O 6B próprio habilitado exige ao menos 1 dado (máximo " + maxDice + ").",
      totalDice: 0,
      counts: createEmptyOwn6BCounts(),
      compactCounts: {},
      diceTypes: [],
      dicePoolDesc: [],
      diceSides: [],
      formatted: ""
    };
  }

  var total = 0;
  var compactCounts = {};
  var diceTypes = [];
  var diceSides = [];
  ALLOWED_6B_DIE_TYPES.forEach(function (die) {
    var c = counts[die] || 0;
    total += c;
    if (c > 0) {
      compactCounts[die] = c;
      for (var i = 0; i < c; i++) {
        diceTypes.push(die);
        diceSides.push(DIE_TYPE_TO_SIDES[die]);
      }
    }
  });

  var dicePoolDesc = [];
  ["d12", "d10", "d8", "d6", "d4"].forEach(function (die) {
    var c = counts[die] || 0;
    for (var i = 0; i < c; i++) {
      dicePoolDesc.push(die);
    }
  });

  if (total < MIN_OWN_6B_DICE) {
    return {
      valid: false,
      enabled: true,
      errorCode: "EMPTY_COMPOSITION",
      errorMessage: "O 6B próprio habilitado exige ao menos 1 dado (máximo " + maxDice + ").",
      totalDice: 0,
      counts: counts,
      compactCounts: {},
      diceTypes: [],
      dicePoolDesc: [],
      diceSides: [],
      formatted: ""
    };
  }

  if (total > maxDice) {
    return {
      valid: false,
      enabled: true,
      errorCode: "MAX_DICE_EXCEEDED",
      errorMessage:
        "O 6B próprio permite no máximo " +
        maxDice +
        " dados (configurado: " +
        total +
        ").",
      totalDice: total,
      counts: counts,
      compactCounts: compactCounts,
      diceTypes: diceTypes,
      dicePoolDesc: dicePoolDesc,
      diceSides: diceSides,
      formatted: formatOwn6BComposition(counts)
    };
  }

  return {
    valid: true,
    enabled: true,
    errorCode: null,
    errorMessage: null,
    totalDice: total,
    counts: counts,
    compactCounts: compactCounts,
    diceTypes: diceTypes,
    dicePoolDesc: dicePoolDesc,
    diceSides: diceSides,
    formatted: formatOwn6BComposition(counts)
  };
}

/**
 * Extrai a definição pura de molde (Template State) de um NPC/Boss sem misturar
 * saldos de instância viva (resultados, usados, bloqueados, fadiga).
 */
export function extractOwn6BTemplate(targetOrData) {
  var rawObj = targetOrData && typeof targetOrData === "object" ? targetOrData : {};
  var d =
    rawObj.data && typeof rawObj.data === "object"
      ? rawObj.data
      : rawObj.dados && typeof rawObj.dados === "object"
      ? rawObj.dados
      : rawObj;

  var hasExplicitFlag = typeof d.hasOwn6B === "boolean" || typeof rawObj.hasOwn6B === "boolean";
  var hasExplicitObj = Boolean(
    (d.own6B && typeof d.own6B === "object" && typeof d.own6B.enabled === "boolean") ||
      (rawObj.own6B && typeof rawObj.own6B === "object" && typeof rawObj.own6B.enabled === "boolean")
  );
  var isExplicit = hasExplicitFlag || hasExplicitObj;

  var ownObj =
    d.own6B && typeof d.own6B === "object"
      ? d.own6B
      : rawObj.own6B && typeof rawObj.own6B === "object"
      ? rawObj.own6B
      : null;

  var enabled = false;
  if (ownObj && typeof ownObj.enabled === "boolean") {
    enabled = ownObj.enabled;
  } else if (typeof d.hasOwn6B === "boolean") {
    enabled = d.hasOwn6B;
  } else if (typeof rawObj.hasOwn6B === "boolean") {
    enabled = rawObj.hasOwn6B;
  }

  if (isExplicit && !enabled) {
    return {
      schemaVersion: 1,
      isExplicit: true,
      isLegacy: false,
      enabled: false,
      poolSource: "xerife_aberta",
      totalDice: 0,
      counts: createEmptyOwn6BCounts(),
      compactCounts: {},
      diceTypes: [],
      diceSides: [],
      formatted: ""
    };
  }

  if (isExplicit && enabled) {
    var candidate =
      (ownObj && ownObj.counts && Object.keys(ownObj.counts).length ? ownObj.counts : null) ||
      (ownObj && ownObj.formatted ? ownObj.formatted : null) ||
      (d["config-6b"] && String(d["config-6b"]).trim() ? String(d["config-6b"]).trim() : null) ||
      (d.config6B && typeof d.config6B === "object" && Object.keys(d.config6B).length ? d.config6B : null) ||
      { d6: 6 };

    var valRes = validateOwn6BComposition(candidate, { enabled: true });
    if (!valRes.valid) {
      valRes = validateOwn6BComposition({ d6: 6 }, { enabled: true });
    }
    return {
      schemaVersion: 1,
      isExplicit: true,
      isLegacy: false,
      enabled: true,
      poolSource: "own_6b",
      totalDice: valRes.totalDice,
      counts: valRes.counts,
      compactCounts: valRes.compactCounts,
      diceTypes: valRes.diceTypes,
      diceSides: valRes.diceSides,
      formatted: valRes.formatted
    };
  }

  // Caso legado: sem hasOwn6B nem own6B explícitos
  var legacyRawStr =
    d["config-6b"] !== undefined && d["config-6b"] !== null
      ? String(d["config-6b"]).trim()
      : "";
  var legacyObj =
    d.config6B && typeof d.config6B === "object" && Object.keys(d.config6B).length > 0
      ? d.config6B
      : null;
  var legacyArr =
    Array.isArray(d.tipo_dados_6b) && d.tipo_dados_6b.length > 0
      ? d.tipo_dados_6b
      : null;

  var legacySource = legacyRawStr || legacyObj || legacyArr;
  if (legacySource) {
    var legacyVal = validateOwn6BComposition(legacySource, { enabled: true });
    if (legacyVal.valid) {
      return {
        schemaVersion: 1,
        isExplicit: false,
        isLegacy: true,
        enabled: true,
        poolSource: "legacy_config",
        totalDice: legacyVal.totalDice,
        counts: legacyVal.counts,
        compactCounts: legacyVal.compactCounts,
        diceTypes: legacyVal.diceTypes,
        diceSides: legacyVal.diceSides,
        formatted: legacyVal.formatted
      };
    }
  }

  return {
    schemaVersion: 1,
    isExplicit: false,
    isLegacy: true,
    enabled: false,
    poolSource: "xerife_aberta",
    totalDice: 0,
    counts: createEmptyOwn6BCounts(),
    compactCounts: {},
    diceTypes: [],
    diceSides: [],
    formatted: ""
  };
}

/**
 * Verifica se a entidade/ficha possui 6B próprio explicitamente habilitado (XER-04).
 */
export function entityHasExplicitOwn6B(targetOrData) {
  var tpl = extractOwn6BTemplate(targetOrData);
  return !!(tpl.isExplicit && tpl.enabled && tpl.totalDice > 0);
}

export var MAX_OP_LEDGER_ENTRIES = 64;

/**
 * Regra aprovada de Fadiga no 6B (fatigueRules.js / Capítulo de Combate):
 * Cada ponto de fadiga reduz em 1 o MAIOR valor disponível entre os dados intactos
 * (em caso de empate, o primeiro índice no sentido horário: 0, 1, 2...).
 * Se um dado chega a 0 por fadiga, fica inutilizado (zeradosPorFadiga) e o restante
 * da fadiga continua reduzindo o próximo maior dado disponível.
 * Dados bloqueados por dano físico permanecem em 0 e nunca são confundidos com fadiga.
 */
export function applyFatigueCascadeToInstanceRoll(originalResults, blockedIndices, fatigueLevel) {
  var orig = Array.isArray(originalResults) ? originalResults : [];
  var blocked = Array.isArray(blockedIndices) ? blockedIndices : [];
  var values = orig.map(function (v, idx) {
    if (blocked.indexOf(idx) >= 0) return 0;
    var n = Math.trunc(Number(v) || 0);
    return n > 0 ? n : 0;
  });
  var remaining = Math.max(0, Math.min(40, Math.trunc(Number(fatigueLevel) || 0)));
  var zeroedByFatigue = [];

  while (remaining > 0) {
    var highestValue = -1;
    var highestIndex = -1;
    for (var i = 0; i < values.length; i++) {
      if (blocked.indexOf(i) >= 0) continue;
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

    if (values[highestIndex] === 0 && zeroedByFatigue.indexOf(highestIndex) === -1) {
      zeroedByFatigue.push(highestIndex);
    }
  }

  zeroedByFatigue.sort(function (a, b) { return a - b; });
  return {
    values: values,
    zeroedByFatigue: zeroedByFatigue
  };
}

/**
 * Contrato XER-05: Constrói o estado inicial isolado de uma instância viva na mesa
 * a partir de um molde XER-04, sem compartilhar referências com outras instâncias.
 */
export function createOwn6BInstanceStateContract(templateOrSheet, instanceContext) {
  instanceContext = instanceContext || {};
  var tpl =
    templateOrSheet &&
    typeof templateOrSheet === "object" &&
    templateOrSheet.schemaVersion === 1 &&
    Array.isArray(templateOrSheet.diceSides)
      ? templateOrSheet
      : extractOwn6BTemplate(templateOrSheet);

  var instanceId = String(instanceContext.instanceId || "").trim();
  var mesaId = String(instanceContext.mesaId || "").trim();
  if (!instanceId) {
    throw new Error("XER-05 Contract Error: instanceId é obrigatório para estado de instância.");
  }

  var initialFatigue = Math.max(
    0,
    Math.min(40, Math.trunc(Number(instanceContext.fadiga || 0) || 0))
  );
  var isEnabled = !!(tpl.enabled && tpl.totalDice > 0);
  return {
    schemaVersion: 1,
    mesaId: mesaId || null,
    mapaId: instanceContext.mapaId ? String(instanceContext.mapaId) : null,
    instanceId: instanceId,
    tokenId: instanceContext.tokenId ? String(instanceContext.tokenId) : null,
    sourceId: instanceContext.sourceId ? String(instanceContext.sourceId) : null,
    sourceType: instanceContext.sourceType ? String(instanceContext.sourceType) : "custom",
    enabled: isEnabled,
    versao: 0,
    dados: isEnabled ? tpl.diceSides.slice() : [],
    resultados: [],
    resultadosOriginais: [],
    consumidos: [],
    bloqueados: [],
    zeradosPorFadiga: [],
    usados: [],
    fadiga: initialFatigue,
    esgotado: false,
    lastOpId: null,
    opLedger: {},
    opOrder: []
  };
}

/**
 * Contrato XER-05 / XER-06: Valida e projeta transições atômicas sobre o estado
 * de uma instância (rolagem inicial, consumo concorrente sem saldo negativo,
 * dano com escolha do defensor, fadiga automática em cascata nos maiores dados e renovação idempotente).
 */
export function validateAndProjectOwn6BInstanceCommand(instanceState, command) {
  if (!instanceState || typeof instanceState !== "object" || !instanceState.instanceId) {
    return { ok: false, errorCode: "22023", reason: "INVALID_INSTANCE_STATE" };
  }
  if (!command || typeof command !== "object" || !command.type) {
    return { ok: false, errorCode: "22023", reason: "INVALID_COMMAND" };
  }
  if (!instanceState.enabled || !Array.isArray(instanceState.dados) || !instanceState.dados.length) {
    return { ok: false, errorCode: "55000", reason: "OWN_6B_DISABLED" };
  }

  var state = JSON.parse(JSON.stringify(instanceState));
  if (!Array.isArray(state.bloqueados)) state.bloqueados = [];
  if (!Array.isArray(state.usados)) state.usados = [];
  if (!Array.isArray(state.zeradosPorFadiga)) state.zeradosPorFadiga = [];
  if (!Array.isArray(state.consumidos)) {
    state.consumidos = state.usados.filter(function (idx) {
      return state.bloqueados.indexOf(idx) === -1 && state.zeradosPorFadiga.indexOf(idx) === -1;
    });
  }
  if (!state.opLedger || typeof state.opLedger !== "object") state.opLedger = {};
  if (!Array.isArray(state.opOrder)) state.opOrder = Object.keys(state.opLedger);

  var opId = command.opId ? String(command.opId).trim() : null;
  if (opId && state.opLedger[opId]) {
    var cachedEntry = state.opLedger[opId];
    return {
      ok: true,
      idempotentReplay: true,
      opId: opId,
      versionBefore: cachedEntry.versionBefore,
      versionAfter: cachedEntry.versionAfter,
      consumedIndices: cachedEntry.consumedIndices || [],
      consumedValues: cachedEntry.consumedValues || [],
      consumedBonus: cachedEntry.consumedBonus || 0,
      state: state
    };
  }

  if (
    command.expectedVersion !== undefined &&
    command.expectedVersion !== null &&
    Number(command.expectedVersion) !== Number(state.versao)
  ) {
    return {
      ok: false,
      errorCode: "40001",
      reason: "VERSION_CONFLICT",
      expectedVersion: Number(command.expectedVersion),
      actualVersion: state.versao,
      state: state
    };
  }

  var n = state.dados.length;
  var versionBefore = state.versao;
  var cmdType = String(command.type).toUpperCase();
  var consumedIndicesOut = [];
  var consumedValuesOut = [];
  var consumedBonusOut = 0;

  function recomputeDerivedSets(s) {
    var unionMap = {};
    (s.consumidos || []).forEach(function (i) {
      if (Number.isInteger(i) && i >= 0 && i < n) unionMap[i] = true;
    });
    (s.bloqueados || []).forEach(function (i) {
      if (Number.isInteger(i) && i >= 0 && i < n) unionMap[i] = true;
    });
    (s.zeradosPorFadiga || []).forEach(function (i) {
      if (Number.isInteger(i) && i >= 0 && i < n) unionMap[i] = true;
    });
    s.usados = Object.keys(unionMap)
      .map(function (k) { return Number(k); })
      .sort(function (a, b) { return a - b; });

    if (!s.resultados || s.resultados.length !== n) {
      s.esgotado = false;
      return;
    }
    for (var i = 0; i < n; i++) {
      if (
        s.bloqueados.indexOf(i) === -1 &&
        s.usados.indexOf(i) === -1 &&
        Number(s.resultados[i]) > 0
      ) {
        s.esgotado = false;
        return;
      }
    }
    s.esgotado = true;
  }

  if (cmdType === "ROLL_INITIAL") {
    if (state.versao > 0 && state.resultados.length === n) {
      return { ok: false, errorCode: "0A000", reason: "ALREADY_ROLLED", state: state };
    }
    var rawRolls = Array.isArray(command.rolls) ? command.rolls : [];
    if (rawRolls.length !== n) {
      return { ok: false, errorCode: "22023", reason: "INVALID_ROLLS_LENGTH", state: state };
    }
    var origList = [];
    for (var rIdx = 0; rIdx < n; rIdx++) {
      var sides = state.dados[rIdx];
      if (state.bloqueados.indexOf(rIdx) >= 0) {
        origList.push(0);
      } else {
        var val = Math.trunc(Number(rawRolls[rIdx]));
        if (!Number.isFinite(val) || val < 1 || val > sides) {
          return { ok: false, errorCode: "22023", reason: "ROLL_OUT_OF_RANGE", state: state };
        }
        origList.push(val);
      }
    }
    state.resultadosOriginais = origList;
    state.consumidos = [];
    var fatInit = applyFatigueCascadeToInstanceRoll(
      state.resultadosOriginais,
      state.bloqueados,
      state.fadiga
    );
    state.resultados = fatInit.values;
    state.zeradosPorFadiga = fatInit.zeroedByFatigue;
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "CONSUME") {
    if (state.resultados.length !== n) {
      return { ok: false, errorCode: "55000", reason: "NOT_ROLLED", state: state };
    }
    var indices = Array.isArray(command.indices) ? command.indices : [];
    if (!indices.length) {
      return { ok: false, errorCode: "22023", reason: "EMPTY_INDICES", state: state };
    }
    var uniq = [];
    for (var cIdx = 0; cIdx < indices.length; cIdx++) {
      var idx = Number(indices[cIdx]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= n || uniq.indexOf(idx) >= 0) {
        return { ok: false, errorCode: "22023", reason: "INVALID_CHAMBER_INDEX", state: state };
      }
      if (
        state.usados.indexOf(idx) >= 0 ||
        state.consumidos.indexOf(idx) >= 0 ||
        state.bloqueados.indexOf(idx) >= 0 ||
        state.zeradosPorFadiga.indexOf(idx) >= 0 ||
        Number(state.resultados[idx]) <= 0
      ) {
        return { ok: false, errorCode: "22023", reason: "CHAMBER_ALREADY_SPENT_OR_BLOCKED", state: state };
      }
      uniq.push(idx);
    }
    uniq.forEach(function (u) {
      state.consumidos.push(u);
      var v = Number(state.resultados[u]) || 0;
      consumedIndicesOut.push(u);
      consumedValuesOut.push(v);
      consumedBonusOut += v;
    });
    state.consumidos.sort(function (a, b) { return a - b; });
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "APPLY_DAMAGE") {
    var dmgPts = Math.trunc(Number(command.damagePoints || 0));
    var chosen = Array.isArray(command.chosenIndices) ? command.chosenIndices : [];
    if (!Number.isInteger(dmgPts) || dmgPts <= 0) {
      return { ok: false, errorCode: "22023", reason: "INVALID_DAMAGE_POINTS", state: state };
    }
    var intact = [];
    for (var dIdx = 0; dIdx < n; dIdx++) {
      if (state.bloqueados.indexOf(dIdx) === -1) intact.push(dIdx);
    }
    var requiredChoices = Math.min(dmgPts, intact.length);
    if (chosen.length !== requiredChoices) {
      return {
        ok: false,
        errorCode: "22023",
        reason: "DEFENDER_CHOICE_COUNT_MISMATCH",
        requiredChoices: requiredChoices,
        state: state
      };
    }
    var seenDamageIdx = [];
    for (var ch = 0; ch < chosen.length; ch++) {
      var targetIdx = Number(chosen[ch]);
      if (
        !Number.isInteger(targetIdx) ||
        targetIdx < 0 ||
        targetIdx >= n ||
        seenDamageIdx.indexOf(targetIdx) >= 0 ||
        state.bloqueados.indexOf(targetIdx) >= 0
      ) {
        return { ok: false, errorCode: "22023", reason: "INVALID_DEFENDER_DAMAGE_CHOICE", state: state };
      }
      seenDamageIdx.push(targetIdx);
    }
    seenDamageIdx.forEach(function (bIdx) {
      state.bloqueados.push(bIdx);
      var fPos = state.zeradosPorFadiga.indexOf(bIdx);
      if (fPos >= 0) state.zeradosPorFadiga.splice(fPos, 1);
      if (state.resultados.length === n) state.resultados[bIdx] = 0;
      if (state.resultadosOriginais.length === n) state.resultadosOriginais[bIdx] = 0;
    });
    state.bloqueados.sort(function (a, b) { return a - b; });
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "HEAL_DAMAGE") {
    var healList = Array.isArray(command.healedIndices) ? command.healedIndices : [];
    if (!healList.length) {
      return { ok: false, errorCode: "22023", reason: "EMPTY_HEAL_INDICES", state: state };
    }
    for (var h = 0; h < healList.length; h++) {
      var hIdx = Number(healList[h]);
      if (!Number.isInteger(hIdx) || hIdx < 0 || hIdx >= n || state.bloqueados.indexOf(hIdx) === -1) {
        return { ok: false, errorCode: "22023", reason: "CHAMBER_NOT_DAMAGED", state: state };
      }
    }
    state.bloqueados = state.bloqueados.filter(function (bIdx) {
      return healList.indexOf(bIdx) === -1;
    });
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "SET_FATIGUE") {
    var nextFatigue = Number(command.fatigue);
    if (!Number.isInteger(nextFatigue) || nextFatigue < 0 || nextFatigue > 40) {
      return { ok: false, errorCode: "22023", reason: "INVALID_FATIGUE_VALUE", state: state };
    }
    state.fadiga = nextFatigue;
    if (state.resultadosOriginais.length === n) {
      var fatRecalc = applyFatigueCascadeToInstanceRoll(
        state.resultadosOriginais,
        state.bloqueados,
        state.fadiga
      );
      state.resultados = fatRecalc.values;
      state.zeradosPorFadiga = fatRecalc.zeroedByFatigue;
    }
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "RENEW") {
    if (state.resultados.length !== n) {
      return { ok: false, errorCode: "55000", reason: "NOT_ROLLED", state: state };
    }
    recomputeDerivedSets(state);
    if (!state.esgotado) {
      return { ok: false, errorCode: "55000", reason: "POOL_NOT_EXHAUSTED", state: state };
    }
    if (state.bloqueados.length >= n) {
      return { ok: false, errorCode: "55000", reason: "ALL_CHAMBERS_DAMAGED", state: state };
    }
    var renewRolls = Array.isArray(command.rolls) ? command.rolls : [];
    if (renewRolls.length !== n) {
      return { ok: false, errorCode: "22023", reason: "INVALID_ROLLS_LENGTH", state: state };
    }
    var renewOrig = [];
    for (var rw = 0; rw < n; rw++) {
      var dieSides = state.dados[rw];
      if (state.bloqueados.indexOf(rw) >= 0) {
        renewOrig.push(0);
      } else {
        var rwVal = Math.trunc(Number(renewRolls[rw]));
        if (!Number.isFinite(rwVal) || rwVal < 1 || rwVal > dieSides) {
          return { ok: false, errorCode: "22023", reason: "ROLL_OUT_OF_RANGE", state: state };
        }
        renewOrig.push(rwVal);
      }
    }
    var applyFatigue = command.applyFatigue !== false;
    if (applyFatigue) {
      state.fadiga = Math.min(40, state.fadiga + 1);
    }
    state.resultadosOriginais = renewOrig;
    state.consumidos = [];
    var fatRenew = applyFatigueCascadeToInstanceRoll(
      state.resultadosOriginais,
      state.bloqueados,
      state.fadiga
    );
    state.resultados = fatRenew.values;
    state.zeradosPorFadiga = fatRenew.zeroedByFatigue;
    recomputeDerivedSets(state);
    state.versao += 1;
  } else if (cmdType === "SYNC_TEMPLATE") {
    var tplCheck = validateOwn6BComposition(command.dados || command.composition, { enabled: true });
    if (!tplCheck.valid) {
      return { ok: false, errorCode: "22023", reason: "INVALID_TEMPLATE_DICE", state: state };
    }
    if (state.versao > 0 && !command.forceReset) {
      return {
        ok: true,
        idempotentReplay: false,
        templateChangeDeferred: true,
        versionBefore: versionBefore,
        versionAfter: state.versao,
        state: state
      };
    }
    state.dados = tplCheck.diceSides.slice();
    n = state.dados.length;
    state.bloqueados = state.bloqueados.filter(function (i) { return i >= 0 && i < n; });
    state.consumidos = [];
    state.zeradosPorFadiga = [];
    state.resultados = [];
    state.resultadosOriginais = [];
    state.usados = state.bloqueados.slice();
    state.esgotado = false;
    state.versao += 1;
  } else {
    return { ok: false, errorCode: "22023", reason: "UNKNOWN_COMMAND_TYPE", state: state };
  }

  if (opId) {
    state.lastOpId = opId;
    if (state.opOrder.indexOf(opId) === -1) {
      state.opOrder.push(opId);
    }
    while (state.opOrder.length > MAX_OP_LEDGER_ENTRIES) {
      var oldestOp = state.opOrder.shift();
      if (oldestOp && oldestOp !== opId) {
        delete state.opLedger[oldestOp];
      }
    }
    state.opLedger[opId] = {
      type: cmdType,
      versionBefore: versionBefore,
      versionAfter: state.versao,
      consumedIndices: consumedIndicesOut,
      consumedValues: consumedValuesOut,
      consumedBonus: consumedBonusOut
    };
  }

  return {
    ok: true,
    idempotentReplay: false,
    opId: opId,
    versionBefore: versionBefore,
    versionAfter: state.versao,
    consumedIndices: consumedIndicesOut,
    consumedValues: consumedValuesOut,
    consumedBonus: consumedBonusOut,
    state: state
  };
}

