/**
 * Aba de Magias, Repertório, Cálculo de REM, Progressão do 6B e Subida de Nível.
 * Consome os JSON carregados por gameData.js (lista_magias, caminhos_magia,
 * reservatorio_energia_mistica, progressao_6b, pontos_pericia) sem duplicá-los.
 */
import { OS } from "./app.js";
import { getMisticismoLevel, calculateRemMax } from "./rules/index.js";

/* ─── Estado compartilhado ───────────────────────────────────── */
OS.knownSpells = [];
OS.config6B = { d6: 6 };
OS.remSpent = 0;
OS._levelUpState = null;
OS.activeBuffs = [];
OS._pendingBuffDeactivations = {};
OS._buffCastContext = null;

var magiasState = {
  activeCaminho: "Todos",
  filterText: "",
  selectedSpell: null,
  selectedCaminho: null
};

var EFEITO_LABELS = {
  sucesso_critico: "Sucesso Crítico",
  sucesso: "Sucesso",
  falha: "Falha",
  falha_2: "Falha (2)",
  falha_critica: "Falha Crítica",
  uma_acao: "Uma Ação",
  duas_acoes: "Duas Ações",
  tres_acoes: "Três Ações"
};

var SPELL_ATTR_LABELS = [
  ["acoes", "Ações"],
  ["custo", "Custo"],
  ["alcance", "Alcance"],
  ["area", "Área"],
  ["resistencia", "Resistência"],
  ["duracao", "Duração"],
  ["descricao", "Descrição"]
];

/* ─── Helpers ────────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function esc(str) {
  return String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmptyVal(v) {
  return v === null || v === undefined || v === "";
}

function normalizeStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatEfeitoKey(key) {
  if (EFEITO_LABELS[key]) return EFEITO_LABELS[key];
  var s = String(key || "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

OS.getCurrentLevel = function () {
  var el = OS.$("nivel");
  var n = parseInt(String((el && el.value) || ""), 10);
  return isNaN(n) || n < 1 ? 1 : n;
};

/* ─── 4. Progressão do 6B (progressao_6b.json) ───────────────── */

/**
 * Calcula a configuração de dados do 6B para o nível informado,
 * lendo diretamente a estrutura de progressao_6b.json.
 */
OS.calculate6BConfig = function (nivel) {
  var prog = OS.getGameData ? OS.getGameData("progressao_6b") : null;
  var n = parseInt(String(nivel || 1), 10);
  if (isNaN(n) || n < 1) n = 1;

  if (!prog || !prog.estado_inicial) {
    return { d6: 6 };
  }

  var config = Object.assign({}, prog.estado_inicial.configuracao_6b);
  var startLv = prog.estado_inicial.nivel || 1;
  var beyond20 = prog.alem_do_nivel_20 || {};
  var lv20Start = beyond20.nivel_inicial || 20;
  var maxFaixaLv = Math.min(n, lv20Start - 1);
  var faixas = prog.faixas_de_progressao || [];

  for (var lv = startLv + 1; lv <= maxFaixaLv; lv++) {
    var resultEntry = null;
    var upgradeEntry = null;
    for (var i = 0; i < faixas.length; i++) {
      var f = faixas[i];
      if (lv >= f.nivel_inicial && lv <= f.nivel_final) {
        if (f.tipo_efeito === "estado_resultante") resultEntry = f;
        else if (f.tipo_efeito === "upgrade_dado_individual") upgradeEntry = f;
      }
    }
    if (resultEntry && resultEntry.configuracao_6b) {
      config = Object.assign({}, resultEntry.configuracao_6b);
    } else if (upgradeEntry) {
      var qty = upgradeEntry.quantidade_por_nivel || 1;
      var from = upgradeEntry.dado_origem;
      var to = upgradeEntry.dado_destino;
      if (config[from]) {
        config[from] -= qty;
        if (config[from] <= 0) delete config[from];
      }
      config[to] = (config[to] || 0) + qty;
    }
  }

  if (n >= lv20Start && beyond20.regra_dado_extra_inicial) {
    var cats = prog.categorias_dado_em_ordem || ["d4", "d6", "d8", "d10", "d12"];
    var rExtra = beyond20.regra_dado_extra_inicial;
    var rNovo = beyond20.regra_novo_dado_adicional || {};
    var gatilho1 = rExtra.nivel_gatilho || 20;
    var gatilho2 = rNovo.nivel_gatilho || 25;
    var cycleLen = Math.max(1, gatilho2 - gatilho1);
    var startIdx = Math.max(0, cats.indexOf(rExtra.dado_inicial || "d4"));
    var maxCat = rExtra.categoria_maxima || "d12";

    var offset = n - gatilho1;
    var fullExtra = Math.floor(offset / cycleLen);
    var step = offset % cycleLen;

    if (fullExtra > 0) {
      config[maxCat] = (config[maxCat] || 0) + fullExtra;
    }
    var extraDie = cats[Math.min(cats.length - 1, startIdx + step)];
    config[extraDie] = (config[extraDie] || 0) + 1;
  }

  return config;
};

OS.format6BConfig = function (config) {
  var cfg = config || OS.config6B || { d6: 6 };
  var keys = Object.keys(cfg).filter(function (k) { return cfg[k] > 0; });
  if (!keys.length) return "6d6";

  // Se já está no nível 19+ (6+ d12 com dado extra menor), exibe d12 primeiro
  if (cfg.d12 >= 6 && keys.length > 1) {
    var order20 = ["d12", "d4", "d6", "d8", "d10"];
    keys.sort(function (a, b) { return order20.indexOf(a) - order20.indexOf(b); });
  } else {
    var orderBase = ["d4", "d6", "d8", "d10", "d12"];
    keys.sort(function (a, b) { return orderBase.indexOf(a) - orderBase.indexOf(b); });
  }

  return keys.map(function (k) { return cfg[k] + k; }).join(" + ");
};

OS.getSmallest6BDie = function (nivel, config) {
  var n = parseInt(String(nivel || OS.getCurrentLevel()), 10) || 1;
  if (n >= 20) return "d12";
  var cfg = config || OS.config6B || OS.calculate6BConfig(n);
  var order = ["d6", "d8", "d10", "d12"];
  for (var i = 0; i < order.length; i++) {
    if (cfg[order[i]] > 0) return order[i];
  }
  return "d6";
};

OS.getExtra6BDiceCount = function (nivel, config) {
  var n = parseInt(String(nivel || OS.getCurrentLevel()), 10) || 1;
  var cfg = config || OS.config6B || OS.calculate6BConfig(n);
  var prog = OS.getGameData ? OS.getGameData("progressao_6b") : null;
  var baseCount = (prog && prog.quantidade_dados_6b) || 6;
  var total = Object.keys(cfg).reduce(function (acc, k) {
    return acc + (cfg[k] || 0);
  }, 0);
  return Math.max(0, total - baseCount);
};

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

OS.update6BForLevel = function (nivel) {
  if (OS.freeEdit) {
    var elFree = OS.$("config-6b");
    if (elFree && String(elFree.value || "").trim()) {
      var parsed = OS.parse6BConfigString(elFree.value);
      if (Object.keys(parsed).length) {
        OS.config6B = parsed;
      }
    }
    return OS.config6B;
  }
  var n = parseInt(String(nivel !== undefined ? nivel : OS.getCurrentLevel()), 10);
  if (isNaN(n) || n < 1) n = 1;
  OS.config6B = OS.calculate6BConfig(n);
  var el = OS.$("config-6b");
  if (el) {
    el.value = OS.format6BConfig(OS.config6B);
  }
  return OS.config6B;
};

/* ─── 2 & 3. REM e Limite do Repertório (reservatorio_energia_mistica.json) ─── */

/**
 * Calcula o limite de magias no repertório a partir de reservatorio_energia_mistica.json:
 * menor dado do 6B + nível de Misticismo (+4 por dado extra de 6B a partir do nível 20).
 */
OS.getSpellRepertorioLimit = function () {
  var nivel = OS.getCurrentLevel();
  var misticismo = getMisticismoLevel();
  var cfg = OS.config6B || OS.calculate6BConfig(nivel);
  var menorDado = OS.getSmallest6BDie(nivel, cfg);

  var remData = OS.getGameData ? OS.getGameData("reservatorio_energia_mistica") : null;
  var base = 2;
  if (remData && remData.repertorio_de_magias && Array.isArray(remData.repertorio_de_magias.tabela_por_dado_6b)) {
    var tabela = remData.repertorio_de_magias.tabela_por_dado_6b;
    for (var i = 0; i < tabela.length; i++) {
      if (tabela[i].menor_dado_6b === menorDado) {
        var parsed = parseInt(String(tabela[i].formula || ""), 10);
        if (!isNaN(parsed)) base = parsed;
        break;
      }
    }
  } else {
    var fallbackMap = { d6: 2, d8: 4, d10: 6, d12: 10 };
    base = fallbackMap[menorDado] || 2;
  }

  var extraDice = OS.getExtra6BDiceCount(nivel, cfg);
  var bonusPerExtra = 4;
  if (remData && remData.repertorio_de_magias && remData.repertorio_de_magias.regra_nivel_20) {
    var m = String(remData.repertorio_de_magias.regra_nivel_20).match(/\+(\d+)/);
    if (m) bonusPerExtra = parseInt(m[1], 10);
  }

  return base + misticismo + extraDice * bonusPerExtra;
};

/**
 * Calcula o REM Máximo efetivo:
 * - Para personagens vivos (não-Veteranos): REM base (calculateRemMax(nivel))
 * - Para personagens Veteranos (veteranos.json): REM base + Nível de Terror atual da cena
 */
OS.getEffectiveRemMax = function (nivel) {
  var lv = nivel;
  if (lv === undefined || lv === null) {
    var nivelEl = OS.$("nivel");
    var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
    lv = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
  }
  if (isNaN(lv) || lv < 0) lv = 0;
  var baseRem = calculateRemMax(lv);
  var isVet = !!(OS.isVeterano || (OS.$("is-veterano") && OS.$("is-veterano").checked));
  var terror = isVet && OS.getSceneTerrorLevel ? OS.getSceneTerrorLevel() : 0;
  return baseRem + Math.max(0, terror);
};

/**
 * Atualiza #rem-total, #rem-atual e o indicador da aba Magias.
 */
OS.recalcRem = function (options) {
  options = options || {};
  var nivelEl = OS.$("nivel");
  var remTotalEl = OS.$("rem-total");
  var remAtualEl = OS.$("rem-atual");

  if (OS.freeEdit) {
    OS.updateMagiasStatusBar();
    var freeMax = remTotalEl ? parseInt(String(remTotalEl.value || 0), 10) : 0;
    var freeAtual = remAtualEl ? parseInt(String(remAtualEl.value || 0), 10) : 0;
    if (isNaN(freeMax)) freeMax = 0;
    if (isNaN(freeAtual)) freeAtual = 0;
    return { remAtual: freeAtual, remMax: freeMax };
  }

  var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
  var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
  if (isNaN(nivel) || nivel < 0) nivel = 0;

  var remMax = OS.getEffectiveRemMax(nivel);
  if (remTotalEl) remTotalEl.value = String(remMax);

  if (options.resetSpent) {
    OS.remSpent = 0;
  }

  var novoAtual = Math.max(0, remMax - (OS.remSpent || 0));
  if (remAtualEl) {
    remAtualEl.value = String(novoAtual);
  }

  OS.updateMagiasStatusBar();
  return { remAtual: novoAtual, remMax: remMax };
};

/**
 * Executa o Descanso Longo: zera fadiga (se houver) e recupera REM igual ao nível de Misticismo.
 */
OS.performLongRest = function () {
  if (OS.getConditionDegree && OS.getConditionDegree("Fatigado") > 0) {
    if (OS.removeCondition) {
      OS.removeCondition("Fatigado");
    }
  } else if (OS.applyFatiguePenalty) {
    OS.applyFatiguePenalty();
  }

  var remAtualEl = OS.$("rem-atual");
  var remTotalEl = OS.$("rem-total");
  var nivelEl = OS.$("nivel");

  var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
  var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
  if (isNaN(nivel) || nivel < 0) nivel = 0;

  var misticismo = getMisticismoLevel();
  var remMax = OS.getEffectiveRemMax(nivel);
  var remAtual = remAtualEl ? parseInt(String(remAtualEl.value || 0), 10) : 0;
  if (isNaN(remAtual)) remAtual = 0;

  var novoRem = remAtual + misticismo;
  if (novoRem > remMax) novoRem = remMax;

  OS.remSpent = Math.max(0, remMax - novoRem);
  if (remTotalEl) remTotalEl.value = String(remMax);
  if (remAtualEl) {
    remAtualEl.value = String(novoRem);
    if (OS.flashField) OS.flashField(remAtualEl);
  }

  OS.updateMagiasStatusBar();
  var fb = OS.$("magias-use-feedback");
  if (fb) {
    fb.textContent = "Descanso Longo: +" + misticismo + " REM recuperado (" + novoRem + "/" + remMax + ").";
  }

  OS.scheduleSave();
};

OS.parseSpellCost = function (custoRaw) {
  if (typeof custoRaw === "number" && !isNaN(custoRaw)) return Math.max(0, custoRaw);
  var m = String(custoRaw || "").match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 1;
};

/* ─── Sistema de Buffs de Magias (magias_buffs.json) ─────────── */

var BUFF_DICE_CATEGORIES = ["d4", "d6", "d8", "d10", "d12"];

function normalizeSkillToken(s) {
  return normalizeStr(s).replace(/[^a-z0-9]+/g, "");
}

OS.getSpellBuffsCatalog = function () {
  var data = OS.getGameData ? OS.getGameData("magias_buffs") : null;
  return (data && Array.isArray(data.buffs)) ? data.buffs : [];
};

OS.findSpellBuffDefinition = function (spellName, caminho) {
  var needle = normalizeStr(spellName).trim();
  if (!needle) return null;
  var camNeedle = caminho ? normalizeStr(caminho).trim() : "";
  var list = OS.getSpellBuffsCatalog();
  if (camNeedle) {
    for (var i = 0; i < list.length; i++) {
      if (
        normalizeStr(list[i].nome).trim() === needle &&
        normalizeStr(list[i].caminho).trim() === camNeedle
      ) {
        return list[i];
      }
    }
  }
  for (var j = 0; j < list.length; j++) {
    if (normalizeStr(list[j].nome).trim() === needle) {
      return list[j];
    }
  }
  return null;
};

OS.findCatalogSpellMinCost = function (spellName, caminho) {
  var needle = normalizeStr(spellName).trim();
  var camNeedle = caminho ? normalizeStr(caminho).trim() : "";
  var lista = OS.getGameData ? OS.getGameData("lista_magias") : null;
  var porCam = (lista && lista.magias_por_caminho) || {};
  var keys = Object.keys(porCam);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (camNeedle && normalizeStr(k).trim() !== camNeedle) continue;
    var arr = porCam[k] || [];
    for (var j = 0; j < arr.length; j++) {
      if (normalizeStr(arr[j].nome).trim() === needle) {
        return Math.max(1, OS.parseSpellCost(arr[j].custo));
      }
    }
  }
  return 1;
};

OS.classifyBuffTargetMode = function (alvoRaw) {
  var a = normalizeStr(alvoRaw || "");
  if (a.indexOf("escolha") >= 0) return "escolha";
  if (a.indexOf("proprio") >= 0 && a.indexOf("aliado") >= 0) return "proprio_e_aliados";
  if (a.indexOf("aliado") >= 0) return "aliado";
  return "proprio";
};

OS.rollBuffDiceExpr = function (diceExpr) {
  var expr = String(diceExpr || "").trim().toLowerCase();
  var m = expr.match(/^(\d*)d(\d+)$/);
  if (!m) return { total: 0, parts: [], label: expr };
  var count = m[1] ? parseInt(m[1], 10) : 1;
  var sides = parseInt(m[2], 10);
  var dieName = "d" + sides;
  var total = 0;
  var parts = [];
  for (var i = 0; i < count; i++) {
    var r = OS.generateDiceResult
      ? OS.generateDiceResult(dieName)
      : (((Math.random() * sides) | 0) + 1);
    parts.push(r);
    total += r;
  }
  return {
    total: total,
    parts: parts,
    label: count + dieName + "(" + parts.join("+") + ")"
  };
};

OS.calculateScaledBuffEffect = function (buffDef, minCost, costSpent) {
  var minC = Math.max(1, parseInt(String(minCost || 1), 10) || 1);
  var cost = Math.max(minC, parseInt(String(costSpent !== undefined ? costSpent : minC), 10) || minC);
  var vb = String((buffDef && buffDef.valor_base) || "");

  if (buffDef && buffDef.escala_com_custo) {
    var regra = normalizeStr(buffDef.regra_escala || "");
    if (buffDef.tipo_efeito === "buff_iniciativa" || /2\s*x\s*o\s*custo/.test(regra)) {
      return {
        costSpent: cost,
        flatValue: 2 * cost,
        diceExpr: null,
        scaledDie: null
      };
    }

    var maxDie = String(buffDef.categoria_maxima || "d12").toLowerCase();
    var maxIdx = BUFF_DICE_CATEGORIES.indexOf(maxDie);
    if (maxIdx < 0) maxIdx = BUFF_DICE_CATEGORIES.length - 1;

    var maxPtsMatch = regra.match(/maximo\s+d\d+\s+com\s+(\d+)\s+pontos/);
    var maxPts = maxPtsMatch ? parseInt(maxPtsMatch[1], 10) : (minC * (maxIdx + 1));

    var catIdx = 0;
    if (maxPts === minC * (maxIdx + 1)) {
      catIdx = Math.min(maxIdx, Math.max(0, Math.floor(cost / minC) - 1));
    } else if (cost >= maxPts) {
      catIdx = maxIdx;
    } else {
      catIdx = Math.min(Math.max(0, maxIdx - 1), Math.max(0, cost - minC));
    }

    var die = BUFF_DICE_CATEGORIES[catIdx];
    return {
      costSpent: cost,
      flatValue: 0,
      diceExpr: "1" + die,
      scaledDie: die
    };
  }

  var dieMatch = vb.match(/\+?(\d*d\d+)/i);
  if (dieMatch) {
    var rawD = dieMatch[1].toLowerCase();
    if (rawD.charAt(0) === "d") rawD = "1" + rawD;
    return {
      costSpent: cost,
      flatValue: 0,
      diceExpr: rawD,
      scaledDie: rawD.replace(/^\d+/, "")
    };
  }

  var flatMatch = vb.match(/^\s*\+(\d+)/);
  return {
    costSpent: cost,
    flatValue: flatMatch ? parseInt(flatMatch[1], 10) : 0,
    diceExpr: null,
    scaledDie: null
  };
};

OS.formatActiveBuffEffectText = function (entry) {
  if (!entry) return "";
  if (entry.isReactiveDamageDecay) {
    if (entry.flatValue !== entry.initialFlatValue) {
      return "+" + entry.flatValue + " de defesa (atual — base: " + entry.valor_base + ")";
    }
    return "+" + entry.flatValue + " de defesa";
  }

  if (entry.escala_com_custo) {
    if (entry.tipo_efeito === "buff_iniciativa") {
      return "+" + entry.flatValue + " de iniciativa (" + entry.costSpent + " pts gastos — " + entry.valor_base + ")";
    }
    if (entry.tipo_efeito === "buff_pericia" && entry.diceExpr) {
      var pList = Array.isArray(entry.pericias_afetadas) ? entry.pericias_afetadas.join(", ") : "";
      return "+" + entry.diceExpr + " extra em " + pList + " (" + entry.costSpent + " pts gastos)";
    }
    if (entry.tipo_efeito === "buff_ataque" && entry.diceExpr) {
      var restTxt = entry.restricao ? " — " + entry.restricao : "";
      return "+" + entry.diceExpr + " de dano elementar elétrico" + restTxt + " (" + entry.costSpent + " pts gastos)";
    }
    if (entry.tipo_efeito === "buff_defesa" && entry.diceExpr) {
      return "+" + entry.diceExpr + " de proteção na defesa (" + entry.costSpent + " pts gastos — bônus atual: +" + entry.flatValue + ")";
    }
  }

  if (entry.tipo_efeito === "buff_defesa" && entry.diceExpr) {
    return entry.valor_base + " (bônus atual: +" + entry.flatValue + ")";
  }

  if (entry.tipo_efeito === "buff_pericia") {
    var perTxt = Array.isArray(entry.pericias_afetadas) && entry.pericias_afetadas.length
      ? " em " + entry.pericias_afetadas.join(", ")
      : "";
    var baseTxt = entry.valor_base + perTxt;
    if (entry.additionalAttackDice) {
      baseTxt += " | +" + entry.additionalAttackDice + " de dano necrótico corpo a corpo";
    }
    return baseTxt;
  }

  return entry.valor_base || "";
};

OS.buildActiveBuffEntry = function (buffDef, options) {
  options = options || {};
  var minCost = Math.max(1, parseInt(String(options.minCost || 1), 10) || 1);
  var calc = OS.calculateScaledBuffEffect(buffDef, minCost, options.cost);

  var flatVal = calc.flatValue;
  var rolledDef = null;
  if (buffDef.tipo_efeito === "buff_defesa" && calc.diceExpr) {
    if (typeof options.forcedDefenseRoll === "number" && !isNaN(options.forcedDefenseRoll)) {
      rolledDef = options.forcedDefenseRoll;
    } else {
      rolledDef = OS.rollBuffDiceExpr(calc.diceExpr).total;
    }
    flatVal = rolledDef;
  }

  var addAtkDice = null;
  var addAtkRestr = null;
  if (buffDef.efeito_adicional) {
    var addM = String(buffDef.efeito_adicional).match(/\+?(\d*d\d+)/i);
    if (addM) {
      addAtkDice = addM[1].toLowerCase();
      if (addAtkDice.charAt(0) === "d") addAtkDice = "1" + addAtkDice;
    }
    if (/corpo\s*a\s*corpo/i.test(buffDef.efeito_adicional)) {
      addAtkRestr = "apenas golpes corpo a corpo";
    }
  }

  var durTexto = "Sustentado";
  if (buffDef.nota_ambiguidade) {
    var customDur = options.durationText !== undefined ? String(options.durationText || "").trim() : "";
    durTexto = customDur || "Até o fim do combate";
  } else if (buffDef.duracao && buffDef.duracao.texto) {
    durTexto = String(buffDef.duracao.texto);
  }

  var normVb = normalizeStr(buffDef.valor_base || "");
  var isNext6B = buffDef.tipo_efeito === "bonus_proximo_ataque" && normVb.indexOf("rolagem do 6b") >= 0;

  var entry = {
    id: uid(),
    nome: buffDef.nome,
    caminho: buffDef.caminho || "",
    tipo_efeito: buffDef.tipo_efeito,
    alvo: buffDef.alvo || "proprio",
    valor_base: buffDef.valor_base || "",
    escala_com_custo: !!buffDef.escala_com_custo,
    regra_escala: buffDef.regra_escala || null,
    pericias_afetadas: Array.isArray(buffDef.pericias_afetadas) ? buffDef.pericias_afetadas.slice() : [],
    restricao: buffDef.restricao || null,
    nota_ambiguidade: !!buffDef.nota_ambiguidade,
    minCost: minCost,
    costSpent: calc.costSpent,
    flatValue: flatVal,
    initialFlatValue: flatVal,
    rolledDefenseBonus: rolledDef,
    diceExpr: calc.diceExpr,
    scaledDie: calc.scaledDie,
    additionalAttackDice: addAtkDice,
    additionalAttackRestriction: addAtkRestr,
    isReactiveDamageDecay: !!(buffDef.efeito_reativo),
    isNext6BRoll: isNext6B,
    duracaoTexto: durTexto
  };

  entry.effectText = OS.formatActiveBuffEffectText(entry);
  return entry;
};

OS.getVisibleModalBuffs = function () {
  var list = Array.isArray(OS.activeBuffs) ? OS.activeBuffs : [];
  return list.filter(function (b) {
    return b && b.tipo_efeito !== "bonus_proximo_ataque";
  });
};

OS.updateBuffButtonUI = function () {
  var badge = OS.$("btn-buffs-badge");
  if (!badge) return;
  var count = OS.getVisibleModalBuffs().length;
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
    badge.removeAttribute("hidden");
  } else {
    badge.textContent = "0";
    badge.hidden = true;
    badge.setAttribute("hidden", "");
  }
};

OS.activateSpellBuff = function (buffDef, options) {
  if (!buffDef) return null;
  if (!Array.isArray(OS.activeBuffs)) OS.activeBuffs = [];

  var entry = OS.buildActiveBuffEntry(buffDef, options);
  var normName = normalizeStr(entry.nome).trim();

  // Regra pilha_de_efeitos: duas instâncias da mesma magia não acumulam — recastar substitui a anterior
  var replaced = false;
  for (var i = 0; i < OS.activeBuffs.length; i++) {
    if (normalizeStr(OS.activeBuffs[i].nome).trim() === normName) {
      if (OS._pendingBuffDeactivations) {
        delete OS._pendingBuffDeactivations[OS.activeBuffs[i].id];
      }
      OS.activeBuffs[i] = entry;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    OS.activeBuffs.push(entry);
  }

  OS.updateBuffButtonUI();
  if (OS.updateStatsFields) OS.updateStatsFields(true);
  if (OS.renderBuffsModalList) OS.renderBuffsModalList();
  OS.scheduleSave();
  return entry;
};

OS.getActiveBuffDefenseBonus = function () {
  if (!Array.isArray(OS.activeBuffs)) return 0;
  var sum = 0;
  for (var i = 0; i < OS.activeBuffs.length; i++) {
    var b = OS.activeBuffs[i];
    if (b && b.tipo_efeito === "buff_defesa" && typeof b.flatValue === "number") {
      sum += b.flatValue;
    }
  }
  return sum;
};

OS.getActiveBuffInitiativeBonus = function () {
  if (!Array.isArray(OS.activeBuffs)) return 0;
  var sum = 0;
  for (var i = 0; i < OS.activeBuffs.length; i++) {
    var b = OS.activeBuffs[i];
    if (b && b.tipo_efeito === "buff_iniciativa" && typeof b.flatValue === "number") {
      sum += b.flatValue;
    }
  }
  return sum;
};

OS.doesBuffAffectSkill = function (buffEntry, skillKey, skillName) {
  if (!buffEntry || !Array.isArray(buffEntry.pericias_afetadas) || !buffEntry.pericias_afetadas.length) {
    return false;
  }
  var keyClean = normalizeSkillToken(String(skillKey || "").replace(/^pericia-/, "").replace(/^combate-/, ""));
  var nameClean = normalizeSkillToken(skillName || "");
  for (var i = 0; i < buffEntry.pericias_afetadas.length; i++) {
    var targetTok = normalizeSkillToken(buffEntry.pericias_afetadas[i]);
    if (targetTok && (targetTok === keyClean || targetTok === nameClean)) {
      return true;
    }
  }
  return false;
};

OS.evaluateSkillRollBuffs = function (skillKey, skillName) {
  var list = Array.isArray(OS.activeBuffs) ? OS.activeBuffs : [];
  var totalBonus = 0;
  var items = [];

  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (!b) continue;

    var applies = false;
    if (b.tipo_efeito === "buff_geral") {
      applies = true;
    } else if (b.tipo_efeito === "buff_pericia" && OS.doesBuffAffectSkill(b, skillKey, skillName)) {
      applies = true;
    }
    if (!applies) continue;

    if (b.diceExpr) {
      var rolled = OS.rollBuffDiceExpr(b.diceExpr);
      totalBonus += rolled.total;
      items.push({
        nome: b.nome,
        value: rolled.total,
        detail: b.nome + " (" + rolled.label + " = +" + rolled.total + ")"
      });
    } else if (typeof b.flatValue === "number" && b.flatValue !== 0) {
      totalBonus += b.flatValue;
      var sign = b.flatValue >= 0 ? "+" : "";
      items.push({
        nome: b.nome,
        value: b.flatValue,
        detail: b.nome + " (" + sign + b.flatValue + ")"
      });
    }
  }

  return {
    total: totalBonus,
    items: items
  };
};

OS.matchesAttackRestriction = function (restricaoRaw, attackCtx) {
  if (!restricaoRaw) return true;
  var r = normalizeStr(restricaoRaw);
  var ctx = attackCtx || {};
  if (r.indexOf("desarmad") >= 0) {
    return !!ctx.isUnarmed;
  }
  if (r.indexOf("corpo a corpo") >= 0) {
    return !!ctx.isMelee;
  }
  if (r.indexOf("projetil") >= 0 || r.indexOf("disparad") >= 0 || r.indexOf("arremessad") >= 0) {
    return !!ctx.isProjectile;
  }
  return true;
};

OS.evaluateAndConsumeAttackBuffs = function (attackCtx) {
  if (!Array.isArray(OS.activeBuffs)) OS.activeBuffs = [];
  var ctx = attackCtx || {};
  var totalBonus = 0;
  var items = [];
  var consumedIds = [];

  for (var i = 0; i < OS.activeBuffs.length; i++) {
    var b = OS.activeBuffs[i];
    if (!b) continue;

    if (b.tipo_efeito === "buff_geral") {
      if (b.diceExpr) {
        var rG = OS.rollBuffDiceExpr(b.diceExpr);
        totalBonus += rG.total;
        items.push({ nome: b.nome, value: rG.total, consumed: false, detail: b.nome + " (" + rG.label + " = +" + rG.total + ")" });
      } else if (b.flatValue) {
        totalBonus += b.flatValue;
        items.push({ nome: b.nome, value: b.flatValue, consumed: false, detail: b.nome + " (+" + b.flatValue + ")" });
      }
    } else if (b.tipo_efeito === "buff_ataque") {
      if (OS.matchesAttackRestriction(b.restricao, ctx)) {
        if (b.diceExpr) {
          var rA = OS.rollBuffDiceExpr(b.diceExpr);
          totalBonus += rA.total;
          items.push({ nome: b.nome, value: rA.total, consumed: false, detail: b.nome + " (" + rA.label + " = +" + rA.total + ")" });
        } else if (b.flatValue) {
          totalBonus += b.flatValue;
          items.push({ nome: b.nome, value: b.flatValue, consumed: false, detail: b.nome + " (+" + b.flatValue + ")" });
        }
      }
    } else if (b.tipo_efeito === "buff_pericia" && b.additionalAttackDice) {
      if (OS.matchesAttackRestriction(b.additionalAttackRestriction, ctx)) {
        var rAdd = OS.rollBuffDiceExpr(b.additionalAttackDice);
        totalBonus += rAdd.total;
        items.push({ nome: b.nome, value: rAdd.total, consumed: false, detail: b.nome + " (" + rAdd.label + " = +" + rAdd.total + ")" });
      }
    } else if (b.tipo_efeito === "bonus_proximo_ataque" && !b.isNext6BRoll) {
      if (OS.matchesAttackRestriction(b.restricao, ctx)) {
        if (b.diceExpr) {
          var rNext = OS.rollBuffDiceExpr(b.diceExpr);
          totalBonus += rNext.total;
          items.push({ nome: b.nome, value: rNext.total, consumed: true, detail: b.nome + " [consumido] (" + rNext.label + " = +" + rNext.total + ")" });
        } else if (b.flatValue) {
          totalBonus += b.flatValue;
          items.push({ nome: b.nome, value: b.flatValue, consumed: true, detail: b.nome + " [consumido] (+" + b.flatValue + ")" });
        }
        consumedIds.push(b.id);
      }
    }
  }

  if (consumedIds.length > 0) {
    OS.activeBuffs = OS.activeBuffs.filter(function (b) {
      return b && consumedIds.indexOf(b.id) === -1;
    });
    OS.updateBuffButtonUI();
    if (OS.renderBuffsModalList) OS.renderBuffsModalList();
    OS.scheduleSave();
  }

  return {
    total: totalBonus,
    items: items,
    consumedIds: consumedIds
  };
};

OS.consumeNext6BRollBuffs = function () {
  if (!Array.isArray(OS.activeBuffs) || !OS.activeBuffs.length) return 0;
  var bonusPerDie = 0;
  var consumedIds = [];

  for (var i = 0; i < OS.activeBuffs.length; i++) {
    var b = OS.activeBuffs[i];
    if (b && b.tipo_efeito === "bonus_proximo_ataque" && b.isNext6BRoll) {
      bonusPerDie += (b.flatValue || 0);
      consumedIds.push(b.id);
    }
  }

  if (consumedIds.length > 0) {
    OS.activeBuffs = OS.activeBuffs.filter(function (b) {
      return b && consumedIds.indexOf(b.id) === -1;
    });
    OS.updateBuffButtonUI();
    if (OS.renderBuffsModalList) OS.renderBuffsModalList();
    OS.scheduleSave();
  }

  return bonusPerDie;
};

OS.onCharacterDamageSuffered = function (damagePoints) {
  if (OS._suppressDamageHook) return false;
  if (!Array.isArray(OS.activeBuffs) || !OS.activeBuffs.length) return false;

  var pts = Math.max(1, parseInt(String(damagePoints || 1), 10) || 1);
  var changed = false;

  for (var p = 0; p < pts; p++) {
    for (var i = OS.activeBuffs.length - 1; i >= 0; i--) {
      var b = OS.activeBuffs[i];
      if (b && b.isReactiveDamageDecay) {
        b.flatValue = Math.max(0, (b.flatValue || 0) - 1);
        changed = true;
        if (b.flatValue <= 0) {
          if (OS._pendingBuffDeactivations) {
            delete OS._pendingBuffDeactivations[b.id];
          }
          OS.activeBuffs.splice(i, 1);
        } else {
          b.effectText = OS.formatActiveBuffEffectText(b);
        }
      }
    }
  }

  if (changed) {
    OS.updateBuffButtonUI();
    if (OS.updateStatsFields) OS.updateStatsFields(true);
    if (OS.renderBuffsModalList) OS.renderBuffsModalList();
    OS.scheduleSave();
  }
  return changed;
};

/* ─── Modal de Parâmetros de Cast de Buff (#buff-cast-modal) ─── */

OS.updateBuffCastPreviewUI = function () {
  var ctx = OS._buffCastContext;
  if (!ctx) return;

  var costInp = OS.$("buff-cast-cost-input");
  var durInp = OS.$("buff-cast-duration-input");
  var previewEl = OS.$("buff-cast-preview");
  var hintEl = OS.$("buff-cast-hint");
  var confirmBtn = OS.$("buff-cast-confirm");

  var rawCost = costInp ? parseInt(String(costInp.value || ""), 10) : ctx.minCost;
  var validCost = !isNaN(rawCost) && rawCost >= ctx.minCost && rawCost <= ctx.remAtual;

  if (hintEl) {
    if (isNaN(rawCost) || rawCost < ctx.minCost) {
      hintEl.textContent = "O custo mínimo de " + ctx.spell.nome + " é " + ctx.minCost + " REM.";
    } else if (rawCost > ctx.remAtual) {
      hintEl.textContent = "REM insuficiente (disponível: " + ctx.remAtual + " REM).";
    } else {
      hintEl.textContent = "";
    }
  }
  if (confirmBtn) confirmBtn.disabled = !validCost;

  if (previewEl) {
    var previewCost = validCost ? rawCost : Math.max(ctx.minCost, isNaN(rawCost) ? ctx.minCost : rawCost);
    var calc = OS.calculateScaledBuffEffect(ctx.buffDef, ctx.minCost, previewCost);
    var effectSummary = ctx.buffDef.valor_base || "";
    if (ctx.buffDef.escala_com_custo) {
      if (ctx.buffDef.tipo_efeito === "buff_iniciativa") {
        effectSummary = "+" + calc.flatValue + " em Iniciativa";
      } else if (calc.diceExpr) {
        effectSummary = "+" + calc.diceExpr + (ctx.buffDef.pericias_afetadas ? " em " + ctx.buffDef.pericias_afetadas.join(", ") : "");
      }
    }
    var durSummary = ctx.buffDef.nota_ambiguidade
      ? ((durInp && durInp.value.trim()) || "Até o fim do combate")
      : ((ctx.buffDef.duracao && ctx.buffDef.duracao.texto) || "Sustentado");
    previewEl.textContent = "Efeito calculado (" + previewCost + " REM): " + effectSummary + " | Duração: " + durSummary;
  }
};

OS.openBuffCastModal = function (spell, buffDef, minCost, remAtual) {
  var modal = OS.$("buff-cast-modal");
  if (!modal || !spell || !buffDef) return false;

  var targetMode = OS.classifyBuffTargetMode(buffDef.alvo);
  OS._buffCastContext = {
    spell: spell,
    buffDef: buffDef,
    minCost: minCost,
    remAtual: remAtual,
    targetMode: targetMode
  };

  var titleEl = OS.$("buff-cast-title");
  var subEl = OS.$("buff-cast-sub");
  var costWrap = OS.$("buff-cast-cost-wrap");
  var costLabel = OS.$("buff-cast-cost-label");
  var costInp = OS.$("buff-cast-cost-input");
  var targetWrap = OS.$("buff-cast-target-wrap");
  var targetSel = OS.$("buff-cast-target-select");
  var durWrap = OS.$("buff-cast-duration-wrap");
  var durInp = OS.$("buff-cast-duration-input");

  if (titleEl) titleEl.textContent = "Lançar " + spell.nome;
  if (subEl) {
    subEl.textContent = buffDef.regra_escala
      ? "Regra de escala: " + buffDef.regra_escala
      : (buffDef.valor_base || "");
  }

  if (costWrap && costInp) {
    costInp.min = String(minCost);
    costInp.max = String(Math.max(minCost, remAtual));
    costInp.value = String(minCost);
    costInp.readOnly = !buffDef.escala_com_custo;
    if (costLabel) {
      costLabel.textContent = buffDef.escala_com_custo
        ? "Pontos de magia gastos (mín. " + minCost + ", REM atual " + remAtual + "):"
        : "Custo de magia fixo:";
    }
  }

  if (targetWrap && targetSel) {
    if (targetMode === "escolha") {
      targetWrap.hidden = false;
      targetWrap.removeAttribute("hidden");
      targetSel.value = "proprio";
    } else {
      targetWrap.hidden = true;
      targetWrap.setAttribute("hidden", "");
    }
  }

  if (durWrap && durInp) {
    if (buffDef.nota_ambiguidade) {
      durWrap.hidden = false;
      durWrap.removeAttribute("hidden");
      durInp.value = "Até o fim do combate";
    } else {
      durWrap.hidden = true;
      durWrap.setAttribute("hidden", "");
    }
  }

  OS.updateBuffCastPreviewUI();
  modal.classList.add("open");
  return true;
};

OS.closeBuffCastModal = function () {
  var modal = OS.$("buff-cast-modal");
  if (modal) modal.classList.remove("open");
  OS._buffCastContext = null;
};

OS.confirmBuffCastModal = function () {
  var ctx = OS._buffCastContext;
  if (!ctx) return false;

  var costInp = OS.$("buff-cast-cost-input");
  var targetSel = OS.$("buff-cast-target-select");
  var durInp = OS.$("buff-cast-duration-input");

  var cost = costInp ? parseInt(String(costInp.value || ""), 10) : ctx.minCost;
  if (isNaN(cost) || cost < ctx.minCost || cost > ctx.remAtual) {
    OS.updateBuffCastPreviewUI();
    return false;
  }

  var chosenTarget = ctx.targetMode === "escolha" && targetSel
    ? targetSel.value
    : (ctx.targetMode === "aliado" ? "aliado" : "proprio");
  var chosenDuration = ctx.buffDef.nota_ambiguidade && durInp
    ? (durInp.value.trim() || "Até o fim do combate")
    : undefined;

  var spellId = ctx.spell.id;
  OS.closeBuffCastModal();
  return OS.useSpell(spellId, {
    cost: cost,
    target: chosenTarget,
    durationText: chosenDuration
  });
};

/* ─── Modal de Buffs Ativos (#buffs-modal) ───────────────────── */

OS.populateAllyReceiveBuffSelect = function () {
  var sel = OS.$("buff-ally-select");
  var costWrap = OS.$("buff-ally-cost-wrap");
  var costInp = OS.$("buff-ally-cost-input");
  if (!sel) return;

  var prev = sel.value;
  sel.innerHTML = "";
  var catalog = OS.getSpellBuffsCatalog().filter(function (b) {
    var mode = OS.classifyBuffTargetMode(b.alvo);
    return mode === "aliado" || mode === "escolha" || mode === "proprio_e_aliados";
  });

  catalog.forEach(function (b) {
    var opt = document.createElement("option");
    opt.value = b.nome;
    opt.textContent = b.nome + " (" + b.caminho + " — " + b.valor_base + ")";
    sel.appendChild(opt);
  });

  if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) {
    sel.value = prev;
  }

  var selectedDef = OS.findSpellBuffDefinition(sel.value);
  if (costWrap && costInp) {
    if (selectedDef && selectedDef.escala_com_custo) {
      var minC = OS.findCatalogSpellMinCost(selectedDef.nome, selectedDef.caminho);
      costWrap.hidden = false;
      costWrap.removeAttribute("hidden");
      costInp.min = String(minC);
      if ((parseInt(costInp.value, 10) || 0) < minC) {
        costInp.value = String(minC);
      }
    } else {
      costWrap.hidden = true;
      costWrap.setAttribute("hidden", "");
    }
  }
};

OS.receiveAllyBuffFromModal = function () {
  var sel = OS.$("buff-ally-select");
  var costInp = OS.$("buff-ally-cost-input");
  var hintEl = OS.$("buffs-modal-hint");
  if (!sel || !sel.value) return null;

  var buffDef = OS.findSpellBuffDefinition(sel.value);
  if (!buffDef) return null;

  var minC = OS.findCatalogSpellMinCost(buffDef.nome, buffDef.caminho);
  var cost = buffDef.escala_com_custo && costInp
    ? Math.max(minC, parseInt(String(costInp.value || minC), 10) || minC)
    : minC;

  var created = OS.activateSpellBuff(buffDef, {
    minCost: minC,
    cost: cost
  });

  if (hintEl && created) {
    hintEl.textContent = "✦ Buff recebido de aliado ativado nesta ficha: " + created.nome + " (sem descontar REM local).";
  }
  return created;
};

OS.renderBuffsModalList = function () {
  var listEl = OS.$("buffs-modal-list");
  var confirmBtn = OS.$("buffs-modal-confirm");
  var hintEl = OS.$("buffs-modal-hint");
  if (!listEl) return;

  var visible = OS.getVisibleModalBuffs();
  var pendingMap = OS._pendingBuffDeactivations || {};
  var pendingCount = 0;

  listEl.innerHTML = "";

  if (!visible.length) {
    var empty = document.createElement("div");
    empty.className = "buff-empty-msg";
    empty.textContent = "Nenhum buff ativo no momento.";
    listEl.appendChild(empty);
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  visible.forEach(function (b) {
    var isPending = !!pendingMap[b.id];
    if (isPending) pendingCount += 1;

    var card = document.createElement("div");
    card.className = "buff-active-card" + (isPending ? " buff-pending-removal" : "");
    card.dataset.buffId = b.id;
    card.dataset.buffNome = b.nome;

    var info = document.createElement("div");
    info.className = "buff-card-info";

    var header = document.createElement("div");
    header.className = "buff-card-header";

    var title = document.createElement("span");
    title.className = "buff-card-title";
    title.textContent = b.nome;
    header.appendChild(title);

    if (b.caminho) {
      var pathBadge = document.createElement("span");
      pathBadge.className = "buff-card-path";
      pathBadge.textContent = b.caminho;
      header.appendChild(pathBadge);
    }

    if (isPending) {
      var pendTag = document.createElement("span");
      pendTag.className = "buff-card-pending-tag";
      pendTag.textContent = "Desativação pendente";
      header.appendChild(pendTag);
    }

    info.appendChild(header);

    var effect = document.createElement("div");
    effect.className = "buff-card-effect";
    effect.textContent = "Efeito: " + OS.formatActiveBuffEffectText(b);
    info.appendChild(effect);

    var dur = document.createElement("div");
    dur.className = "buff-card-duration";
    dur.textContent = "Duração: " + (b.duracaoTexto || "Sustentado");
    info.appendChild(dur);

    card.appendChild(info);

    var btnDeact = document.createElement("button");
    btnDeact.type = "button";
    btnDeact.className = "btn btn-secondary btn-small buff-deactivate-btn" + (isPending ? " marked-for-removal" : "");
    btnDeact.dataset.buffId = b.id;
    btnDeact.setAttribute("aria-pressed", isPending ? "true" : "false");
    btnDeact.textContent = isPending ? "Desativar ✓" : "Desativar";
    btnDeact.addEventListener("click", function () {
      OS.togglePendingBuffDeactivation(b.id);
    });
    card.appendChild(btnDeact);

    listEl.appendChild(card);
  });

  if (confirmBtn) {
    confirmBtn.disabled = pendingCount === 0;
  }
  if (hintEl) {
    hintEl.textContent = pendingCount > 0
      ? pendingCount + " buff(s) marcado(s) para desativação. Clique em Confirmar para aplicar."
      : "";
  }
};

OS.togglePendingBuffDeactivation = function (buffId) {
  if (!buffId) return;
  if (!OS._pendingBuffDeactivations) OS._pendingBuffDeactivations = {};
  if (OS._pendingBuffDeactivations[buffId]) {
    delete OS._pendingBuffDeactivations[buffId];
  } else {
    OS._pendingBuffDeactivations[buffId] = true;
  }
  OS.renderBuffsModalList();
};

OS.openBuffsModal = function () {
  var modal = OS.$("buffs-modal");
  if (!modal) return;
  OS._pendingBuffDeactivations = {};
  var hintEl = OS.$("buffs-modal-hint");
  if (hintEl) hintEl.textContent = "";
  OS.populateAllyReceiveBuffSelect();
  OS.renderBuffsModalList();
  modal.classList.add("open");
};

OS.closeBuffsModal = function () {
  var modal = OS.$("buffs-modal");
  // Fechar sem confirmar descarta qualquer marcação pendente de desativação
  OS._pendingBuffDeactivations = {};
  if (modal) modal.classList.remove("open");
};

OS.confirmBuffDeactivations = function () {
  var pending = OS._pendingBuffDeactivations || {};
  var idsToRemove = Object.keys(pending).filter(function (k) { return !!pending[k]; });
  if (!idsToRemove.length) return false;

  if (Array.isArray(OS.activeBuffs)) {
    OS.activeBuffs = OS.activeBuffs.filter(function (b) {
      return b && idsToRemove.indexOf(b.id) === -1;
    });
  }
  OS._pendingBuffDeactivations = {};
  OS.updateBuffButtonUI();
  if (OS.updateStatsFields) OS.updateStatsFields(true);
  OS.renderBuffsModalList();
  OS.scheduleSave();
  OS.closeBuffsModal();
  return true;
};

/**
 * Usa uma magia do repertório, descontando seu custo em pontos de energia mística do REM atual
 * e ativando o buff correspondente se existir em magias_buffs.json.
 */
OS.useSpell = function (spellId, options) {
  var spell = OS.knownSpells.find(function (s) { return s.id === spellId; });
  if (!spell) return false;

  var remAtualEl = OS.$("rem-atual");
  var nivelEl = OS.$("nivel");
  var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
  var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
  if (isNaN(nivel) || nivel < 0) nivel = 0;

  var remMax = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivel) : calculateRemMax(nivel);
  if (remAtualEl && String(remAtualEl.value || "").trim() === "") {
    OS.recalcRem();
  }

  var remAtual = remAtualEl ? parseInt(String(remAtualEl.value || 0), 10) : 0;
  if (isNaN(remAtual)) remAtual = 0;

  var minCost = Math.max(1, OS.parseSpellCost(spell.custo));
  var buffDef = OS.findSpellBuffDefinition(spell.nome, spell.caminho);
  var fb = OS.$("magias-use-feedback");

  if (buffDef && !options) {
    var targetModePrompt = OS.classifyBuffTargetMode(buffDef.alvo);
    var needsPrompt = !!(
      buffDef.escala_com_custo ||
      buffDef.nota_ambiguidade ||
      targetModePrompt === "escolha"
    );
    if (needsPrompt) {
      if (remAtual < minCost) {
        if (fb) {
          fb.textContent = "⚠ REM insuficiente para " + spell.nome + " (custo mínimo: " + minCost + ", REM atual: " + remAtual + "/" + remMax + ").";
        }
        return false;
      }
      return OS.openBuffCastModal(spell, buffDef, minCost, remAtual);
    }
  }

  var requestedCost = (options && options.cost !== undefined)
    ? parseInt(String(options.cost), 10)
    : minCost;
  if (isNaN(requestedCost) || requestedCost < minCost) {
    requestedCost = minCost;
  }

  if (remAtual < requestedCost) {
    if (fb) {
      fb.textContent = "⚠ REM insuficiente para " + spell.nome + " (custo: " + requestedCost + ", REM atual: " + remAtual + "/" + remMax + ").";
    }
    return false;
  }

  var cost = requestedCost;
  var novoRem = Math.max(0, remAtual - cost);
  OS.remSpent = Math.max(0, remMax - novoRem);

  if (remAtualEl) {
    remAtualEl.value = String(novoRem);
    if (OS.flashField) OS.flashField(remAtualEl);
  }

  OS.updateMagiasStatusBar();

  var buffFeedbackSuffix = "";
  if (buffDef) {
    var targetMode = OS.classifyBuffTargetMode(buffDef.alvo);
    var resolvedTarget = (options && options.target)
      ? options.target
      : (targetMode === "aliado" ? "aliado" : "proprio");

    if (resolvedTarget === "aliado") {
      buffFeedbackSuffix = " Buff com alvo aliado (" + buffDef.alvo + "): ative-o na ficha do aliado pelo botão Buff.";
    } else {
      var createdBuff = OS.activateSpellBuff(buffDef, {
        minCost: minCost,
        cost: cost,
        durationText: options && options.durationText,
        forcedDefenseRoll: options && options.forcedDefenseRoll
      });
      if (createdBuff) {
        buffFeedbackSuffix = " Buff ativo: " + createdBuff.effectText + ".";
        if (targetMode === "proprio_e_aliados") {
          buffFeedbackSuffix += " (Aliados na área podem ativá-lo pelo botão Buff em suas fichas.)";
        }
      }
    }
  }

  if (fb) {
    fb.textContent = "✦ " + spell.nome + " usada (-" + cost + " REM). REM atual: " + novoRem + "/" + remMax + "." + buffFeedbackSuffix;
  }

  OS.scheduleSave();
  return true;
};

/* ─── Renderização do Repertório e Status de Magias ──────────── */

OS.updateMagiasStatusBar = function () {
  var remAtualEl = OS.$("rem-atual");
  var remTotalEl = OS.$("rem-total");
  var remDisp = OS.$("magias-rem-display");
  if (remDisp) {
    var a = (remAtualEl && remAtualEl.value !== "") ? remAtualEl.value : "0";
    var t = (remTotalEl && remTotalEl.value !== "") ? remTotalEl.value : "0";
    remDisp.textContent = a + " / " + t;
  }

  var limit = OS.getSpellRepertorioLimit();
  var count = OS.knownSpells.length;
  var limitDisp = OS.$("magias-limit-display");
  if (limitDisp) {
    limitDisp.textContent = count + " / " + limit;
    limitDisp.classList.toggle("limit-exceeded", count > limit);
  }

  var alertEl = OS.$("magias-limit-alert");
  if (alertEl) {
    if (count > limit) {
      alertEl.textContent =
        "⚠ Limite do repertório ultrapassado: " +
        count +
        " magias conhecidas de um limite de " +
        limit +
        " (menor dado 6B: " +
        OS.getSmallest6BDie() +
        ", Misticismo: " +
        getMisticismoLevel() +
        ").";
      alertEl.removeAttribute("hidden");
    } else {
      alertEl.textContent = "";
      alertEl.setAttribute("hidden", "");
    }
  }
};

OS.renderMagiasRepertorio = function () {
  OS.updateMagiasStatusBar();

  var container = OS.$("magias-item-list");
  if (!container) return;

  if (!OS.knownSpells.length) {
    container.innerHTML = '<p class="inv-empty">Nenhuma magia no repertório.</p>';
    return;
  }

  container.innerHTML = "";
  OS.knownSpells.forEach(function (spell) {
    var row = document.createElement("div");
    row.className = "inv-item-row magia-item-row";
    row.dataset.spellId = spell.id;

    var costNum = OS.parseSpellCost(spell.custo);
    var useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "inv-item-name-btn magia-use-btn";
    useBtn.title = "Clicar para usar magia (desconta " + costNum + " REM)";

    var titleSpan = document.createElement("span");
    titleSpan.className = "magia-row-name";
    titleSpan.textContent = spell.nome;
    useBtn.appendChild(titleSpan);

    var metaSpan = document.createElement("span");
    metaSpan.className = "magia-row-meta";
    metaSpan.textContent =
      (spell.caminho ? spell.caminho + " · " : "") +
      "Custo: " + (spell.custo || costNum) + " · Usar";
    useBtn.appendChild(metaSpan);

    useBtn.addEventListener("click", function () {
      OS.useSpell(spell.id);
    });

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "inv-item-del-btn";
    delBtn.title = "Remover magia do repertório";
    delBtn.setAttribute("aria-label", "Remover " + spell.nome);
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      OS.removeSpellFromRepertorio(spell.id);
    });

    row.appendChild(useBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
};

OS.addSpellToRepertorio = function (spellData, caminho) {
  if (!spellData || !spellData.nome) return null;

  var entry = Object.assign({}, spellData, {
    id: uid(),
    caminho: caminho || spellData.caminho || ""
  });

  OS.knownSpells.push(entry);
  OS.renderMagiasRepertorio();
  OS.scheduleSave();
  return entry;
};

OS.removeSpellFromRepertorio = function (spellId) {
  OS.knownSpells = OS.knownSpells.filter(function (s) { return s.id !== spellId; });
  OS.renderMagiasRepertorio();
  OS.scheduleSave();
};

/* ─── 1. Catálogo de Magias (popup) ──────────────────────────── */

function getCaminhosOrder() {
  var lista = OS.getGameData ? OS.getGameData("lista_magias") : null;
  var map = (lista && lista.magias_por_caminho) || {};
  return ["Todos"].concat(Object.keys(map)).concat(["Criados"]);
}

function findCaminhoDescription(caminhoKey) {
  if (!caminhoKey || caminhoKey === "Todos" || caminhoKey === "Criados") return "";
  var data = OS.getGameData ? OS.getGameData("caminhos_magia") : null;
  var list = (data && data.caminhos) || [];
  var needle = normalizeStr(caminhoKey);
  for (var i = 0; i < list.length; i++) {
    if (normalizeStr(list[i].nome).indexOf(needle) >= 0) {
      return list[i].descricao || "";
    }
  }
  return "";
}

function getFilteredSpells() {
  var filter = normalizeStr(magiasState.filterText.trim());
  var out = [];

  if (magiasState.activeCaminho === "Criados") {
    var created = Array.isArray(OS.customSpells) ? OS.customSpells : [];
    created.forEach(function (sp) {
      if (!filter || normalizeStr(sp.nome).indexOf(filter) >= 0) {
        out.push({ caminho: sp.caminho || "Criados", spell: sp });
      }
    });
    return out;
  }

  var lista = OS.getGameData ? OS.getGameData("lista_magias") : null;
  var porCaminho = (lista && lista.magias_por_caminho) || {};
  var caminhos = magiasState.activeCaminho === "Todos"
    ? Object.keys(porCaminho)
    : [magiasState.activeCaminho];

  caminhos.forEach(function (cam) {
    var arr = porCaminho[cam] || [];
    arr.forEach(function (sp) {
      if (!filter || normalizeStr(sp.nome).indexOf(filter) >= 0) {
        out.push({ caminho: cam, spell: sp });
      }
    });
  });

  return out;
}

function renderMagiasCaminhoTabs() {
  var container = OS.$("magias-caminho-tabs");
  if (!container) return;
  container.innerHTML = "";

  getCaminhosOrder().forEach(function (cam) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-tab-btn" + (magiasState.activeCaminho === cam ? " active" : "");
    btn.textContent = cam;
    btn.dataset.caminho = cam;
    btn.addEventListener("click", function () {
      magiasState.activeCaminho = cam;
      magiasState.selectedSpell = null;
      magiasState.selectedCaminho = null;
      renderMagiasCaminhoTabs();
      renderMagiasCaminhoDesc();
      renderMagiasCatalogList();
      renderMagiasCatalogDetail();
      updateMagiasConfirmBtn();
    });
    container.appendChild(btn);
  });
}

function renderMagiasCaminhoDesc() {
  var descEl = OS.$("magias-caminho-desc");
  if (!descEl) return;
  var desc = findCaminhoDescription(magiasState.activeCaminho);
  if (desc) {
    descEl.textContent = desc;
    descEl.removeAttribute("hidden");
  } else {
    descEl.textContent = "";
    descEl.setAttribute("hidden", "");
  }
}

function renderMagiasCatalogList() {
  var container = OS.$("magias-catalog-list");
  if (!container) return;
  container.innerHTML = "";

  var entries = getFilteredSpells();
  if (!entries.length) {
    container.innerHTML = '<p class="catalog-empty">Nenhuma magia encontrada.</p>';
    return;
  }

  entries.forEach(function (entry) {
    var sp = entry.spell;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-item-btn" + (magiasState.selectedSpell === sp ? " active" : "");

    var nameSpan = document.createElement("span");
    nameSpan.className = "catalog-item-name";
    nameSpan.textContent = sp.nome;
    btn.appendChild(nameSpan);

    var costSpan = document.createElement("span");
    costSpan.className = "catalog-item-price";
    costSpan.textContent = entry.caminho;
    btn.appendChild(costSpan);

    btn.addEventListener("click", function () {
      magiasState.selectedSpell = sp;
      magiasState.selectedCaminho = entry.caminho;
      renderMagiasCatalogList();
      renderMagiasCatalogDetail();
      updateMagiasConfirmBtn();
    });

    container.appendChild(btn);
  });
}

function renderMagiasCatalogDetail() {
  var container = OS.$("magias-catalog-detail");
  if (!container) return;

  var sp = magiasState.selectedSpell;
  if (!sp) {
    container.innerHTML = '<p class="catalog-detail-empty">Selecione uma magia para ver os atributos.</p>';
    return;
  }

  var html = '<h4 class="catalog-detail-title">' + esc(sp.nome) + "</h4>";

  if (magiasState.selectedCaminho) {
    html +=
      '<div class="catalog-attr"><span class="catalog-attr-label">Caminho</span> <span class="catalog-attr-val">' +
      esc(magiasState.selectedCaminho) +
      "</span></div>";
  }

  SPELL_ATTR_LABELS.forEach(function (pair) {
    var key = pair[0];
    var label = pair[1];
    var val = sp[key];
    if (isEmptyVal(val)) return;
    html +=
      '<div class="catalog-attr"><span class="catalog-attr-label">' +
      esc(label) +
      '</span> <span class="catalog-attr-val">' +
      esc(val) +
      "</span></div>";
  });

  if (sp.efeitos && typeof sp.efeitos === "object") {
    var efKeys = Object.keys(sp.efeitos).filter(function (k) {
      return !isEmptyVal(sp.efeitos[k]);
    });
    if (efKeys.length) {
      html += '<div class="magias-efeitos-section"><p class="catalog-variants-label">Efeitos</p>';
      html += '<table class="magias-efeitos-table"><tbody>';
      efKeys.forEach(function (k) {
        html +=
          "<tr><th>" +
          esc(formatEfeitoKey(k)) +
          "</th><td>" +
          esc(sp.efeitos[k]) +
          "</td></tr>";
      });
      html += "</tbody></table></div>";
    }
  }

  container.innerHTML = html;
}

function updateMagiasConfirmBtn() {
  var btn = OS.$("magias-catalog-confirm");
  if (!btn) return;
  if (magiasState.readOnly) {
    btn.disabled = true;
    btn.hidden = true;
    btn.setAttribute("hidden", "");
    btn.style.display = "none";
  } else {
    btn.hidden = false;
    btn.removeAttribute("hidden");
    btn.style.display = "";
    btn.disabled = !magiasState.selectedSpell;
  }
}

function toggleCreateSpellForm(show) {
  var form = OS.$("magias-create-form");
  if (!form) return;
  var shouldShow = show !== undefined ? show : form.hasAttribute("hidden");
  if (shouldShow) {
    form.removeAttribute("hidden");
  } else {
    form.setAttribute("hidden", "");
  }
}

async function handleSaveCreatedSpell() {
  var nomeEl = OS.$("create-spell-nome");
  var nome = nomeEl ? String(nomeEl.value || "").trim() : "";
  var hint = OS.$("magias-catalog-hint");

  if (!nome) {
    if (hint) {
      hint.textContent = "Informe o nome da magia para criar.";
      hint.classList.add("limit-exceeded");
    }
    return;
  }

  var caminhoEl = OS.$("create-spell-caminho");
  var acoesEl = OS.$("create-spell-acoes");
  var custoEl = OS.$("create-spell-custo");
  var alcanceEl = OS.$("create-spell-alcance");
  var areaEl = OS.$("create-spell-area");
  var resistenciaEl = OS.$("create-spell-resistencia");
  var duracaoEl = OS.$("create-spell-duracao");
  var descricaoEl = OS.$("create-spell-descricao");
  var efCritEl = OS.$("create-spell-ef-critico");
  var efSucEl = OS.$("create-spell-ef-sucesso");
  var efFalEl = OS.$("create-spell-ef-falha");
  var efFalCritEl = OS.$("create-spell-ef-falha-critica");

  var efeitos = {};
  if (efCritEl && efCritEl.value.trim()) efeitos.sucesso_critico = efCritEl.value.trim();
  if (efSucEl && efSucEl.value.trim()) efeitos.sucesso = efSucEl.value.trim();
  if (efFalEl && efFalEl.value.trim()) efeitos.falha = efFalEl.value.trim();
  if (efFalCritEl && efFalCritEl.value.trim()) efeitos.falha_critica = efFalCritEl.value.trim();

  var newSpell = {
    nome: nome,
    caminho: caminhoEl ? caminhoEl.value : "Gerais",
    acoes: acoesEl ? acoesEl.value.trim() || "1 ação" : "1 ação",
    custo: custoEl ? custoEl.value.trim() || "1 ponto de energia mística" : "1 ponto de energia mística",
    alcance: alcanceEl ? alcanceEl.value.trim() || "Pessoal" : "Pessoal",
    area: areaEl ? areaEl.value.trim() || "Alvo único" : "Alvo único",
    resistencia: resistenciaEl ? resistenciaEl.value.trim() || "Nenhuma" : "Nenhuma",
    duracao: duracaoEl ? duracaoEl.value.trim() || "Instantânea" : "Instantânea",
    descricao: descricaoEl ? descricaoEl.value.trim() || "" : "",
    efeitos: efeitos
  };

  if (OS.loadCustomSpells) {
    await OS.loadCustomSpells();
  }
  if (!Array.isArray(OS.customSpells)) OS.customSpells = [];
  OS.customSpells = OS.customSpells.filter(function (s) {
    return String(s.nome || "").trim().toLowerCase() !== nome.toLowerCase();
  });
  OS.customSpells.push(newSpell);

  if (OS.saveCustomSpells) {
    await OS.saveCustomSpells();
  }

  [nomeEl, acoesEl, custoEl, alcanceEl, areaEl, resistenciaEl, duracaoEl, descricaoEl, efCritEl, efSucEl, efFalEl, efFalCritEl].forEach(function (inp) {
    if (inp) inp.value = "";
  });

  toggleCreateSpellForm(false);
  magiasState.activeCaminho = "Criados";
  magiasState.selectedSpell = newSpell;
  magiasState.selectedCaminho = newSpell.caminho || "Criados";
  renderMagiasCaminhoTabs();
  renderMagiasCaminhoDesc();
  renderMagiasCatalogList();
  renderMagiasCatalogDetail();
  updateMagiasConfirmBtn();

  if (hint) {
    hint.classList.remove("limit-exceeded");
    hint.textContent = "✓ Magia \"" + nome + "\" criada e salva em magias_criadas.json.";
  }
}

OS.openMagiasCatalogModal = function (options) {
  var overlay = OS.$("magias-catalog-modal");
  if (!overlay) return;

  var isReadOnly = !!(options && typeof options === "object" && options.readOnly === true);
  magiasState.readOnly = isReadOnly;
  magiasState.selectedSpell = null;
  magiasState.selectedCaminho = null;
  magiasState.filterText = "";
  if (!magiasState.activeCaminho) magiasState.activeCaminho = "Todos";

  var subEl = overlay.querySelector(".modal-sub");
  if (subEl) {
    subEl.textContent = isReadOnly
      ? "Modo somente consulta — consulte os caminhos e atributos das magias."
      : "Consulte uma magia por caminho e adicione-a ao repertório.";
  }

  var searchEl = OS.$("magias-catalog-search");
  if (searchEl) searchEl.value = "";

  var hint = OS.$("magias-catalog-hint");
  if (hint) {
    hint.textContent = "";
    hint.classList.remove("limit-exceeded");
  }

  toggleCreateSpellForm(false);
  updateMagiasConfirmBtn();

  Promise.all([
    OS.loadGameData ? OS.loadGameData() : Promise.resolve(),
    OS.loadCustomSpells ? OS.loadCustomSpells() : Promise.resolve()
  ])
    .then(function () {
      renderMagiasCaminhoTabs();
      renderMagiasCaminhoDesc();
      renderMagiasCatalogList();
      renderMagiasCatalogDetail();
      updateMagiasConfirmBtn();
    })
    .catch(function (err) {
      console.error("[magiasUI] erro ao carregar dados de magia:", err);
    });

  overlay.classList.add("open");
};

OS.closeMagiasCatalogModal = function () {
  var overlay = OS.$("magias-catalog-modal");
  if (overlay) overlay.classList.remove("open");
  magiasState.readOnly = false;
  updateMagiasConfirmBtn();
};

function handleConfirmAddSpell() {
  if (magiasState.readOnly) return;
  if (!magiasState.selectedSpell) return;
  var added = OS.addSpellToRepertorio(magiasState.selectedSpell, magiasState.selectedCaminho);
  if (!added) return;

  var limit = OS.getSpellRepertorioLimit();
  var count = OS.knownSpells.length;
  var hint = OS.$("magias-catalog-hint");
  if (hint) {
    if (count > limit) {
      hint.textContent =
        "✓ " + added.nome + " adicionada — ⚠ Limite do repertório ultrapassado (" + count + "/" + limit + ")!";
      hint.classList.add("limit-exceeded");
    } else {
      hint.textContent = "✓ " + added.nome + " adicionada ao repertório (" + count + "/" + limit + ").";
      hint.classList.remove("limit-exceeded");
    }
  }
}

/* ─── 5. Subida de Nível (pontos_pericia.json) ───────────────── */

OS.getLevelUpDieInfo = function (currentLevel) {
  var lv = parseInt(String(currentLevel !== undefined ? currentLevel : OS.getCurrentLevel()), 10);
  if (isNaN(lv) || lv < 1) lv = 1;
  var targetLv = lv + 1;

  var ppData = OS.getGameData ? OS.getGameData("pontos_pericia") : null;
  var tabela =
    (ppData &&
      ppData.ganhando_pontos_por_nivel &&
      ppData.ganhando_pontos_por_nivel.tabela_dado_por_faixa_de_nivel) ||
    [];

  var matched = null;
  for (var i = 0; i < tabela.length; i++) {
    var row = tabela[i];
    if (targetLv >= row.nivel_min && (row.nivel_max === null || targetLv <= row.nivel_max)) {
      matched = row;
      break;
    }
  }

  var dadoRolado = (matched && matched.dado_rolado) || (targetLv <= 6 ? "1d6" : targetLv <= 12 ? "1d8" : targetLv <= 18 ? "1d10" : "1d12");
  var die = dadoRolado.replace(/^1/, "");

  return {
    currentLevel: lv,
    targetLevel: targetLv,
    dadoRolado: dadoRolado,
    die: die,
    nivelMin: matched ? matched.nivel_min : 1,
    nivelMax: matched ? matched.nivel_max : null
  };
};

OS.openLevelUpModal = function () {
  var modal = OS.$("levelup-roll-modal");
  if (!modal) return;

  OS.loadGameData().then(function () {
    var info = OS.getLevelUpDieInfo(OS.getCurrentLevel());
    OS._levelUpState = {
      currentLevel: info.currentLevel,
      targetLevel: info.targetLevel,
      dadoRolado: info.dadoRolado,
      die: info.die,
      rolledPoints: null
    };

    var titleEl = OS.$("levelup-modal-title");
    if (titleEl) {
      titleEl.textContent = "Subir de Nível — Nível " + info.currentLevel + " → " + info.targetLevel;
    }

    var subEl = OS.$("levelup-modal-sub");
    if (subEl) {
      var rangeTxt = info.nivelMax ? (info.nivelMin + " a " + info.nivelMax) : (info.nivelMin + "+");
      subEl.textContent = "Nível atual " + info.currentLevel + " (faixa " + rangeTxt + "): role " + info.dadoRolado + " para ganhar pontos de perícia.";
    }

    var dieLabel = OS.$("levelup-die-label");
    if (dieLabel) dieLabel.textContent = info.dadoRolado;

    var rollBtn = OS.$("btn-levelup-roll");
    if (rollBtn) {
      rollBtn.textContent = "Rolar " + info.dadoRolado;
      rollBtn.disabled = false;
    }

    var resEl = OS.$("levelup-roll-result");
    if (resEl) resEl.textContent = "—";

    var hintEl = OS.$("levelup-modal-hint");
    if (hintEl) hintEl.textContent = "Role o dado para determinar os pontos de perícia.";

    var confirmBtn = OS.$("levelup-roll-confirm");
    if (confirmBtn) confirmBtn.disabled = true;

    modal.classList.add("open");
  });
};

OS.closeLevelUpModal = function () {
  var modal = OS.$("levelup-roll-modal");
  if (modal) modal.classList.remove("open");
};

OS.rollLevelUpDie = function () {
  if (!OS._levelUpState) return 0;
  var pts = OS.generateDiceResult(OS._levelUpState.die);
  OS._levelUpState.rolledPoints = pts;

  var resEl = OS.$("levelup-roll-result");
  if (resEl) resEl.textContent = String(pts);

  var hintEl = OS.$("levelup-modal-hint");
  if (hintEl) {
    hintEl.textContent = "Resultado: " + pts + " ponto(s) de perícia para distribuir.";
  }

  var confirmBtn = OS.$("levelup-roll-confirm");
  if (confirmBtn) confirmBtn.disabled = false;

  return pts;
};

OS.confirmLevelUpRoll = function () {
  if (!OS._levelUpState || !OS._levelUpState.rolledPoints) return;
  var pts = OS._levelUpState.rolledPoints;
  var targetLevel = OS._levelUpState.targetLevel;
  OS.closeLevelUpModal();
  if (OS.openLevelUpSkillPointsModal) {
    OS.openLevelUpSkillPointsModal(pts, targetLevel);
  }
};

/* ─── Persistência (save / load / clear) ─────────────────────── */

OS.collectMagiasState = function () {
  if (OS.freeEdit) {
    var cfgEl = OS.$("config-6b");
    if (cfgEl && String(cfgEl.value || "").trim()) {
      var parsed = OS.parse6BConfigString(cfgEl.value);
      if (Object.keys(parsed).length) {
        OS.config6B = Object.assign({}, parsed);
      }
    }
  }
  return {
    knownSpells: OS.knownSpells.map(function (s) { return Object.assign({}, s); }),
    config6B: Object.assign({}, OS.config6B || { d6: 6 }),
    remSpent: OS.remSpent || 0,
    activeBuffs: Array.isArray(OS.activeBuffs)
      ? OS.activeBuffs.map(function (b) { return Object.assign({}, b); })
      : []
  };
};

OS.applyMagiasState = function (state) {
  state = state || {};
  OS.knownSpells = Array.isArray(state.knownSpells)
    ? state.knownSpells.map(function (s) { return Object.assign({}, s); })
    : [];
  OS.activeBuffs = Array.isArray(state.activeBuffs)
    ? state.activeBuffs.map(function (b) { return Object.assign({}, b); })
    : [];
  OS._pendingBuffDeactivations = {};
  OS.updateBuffButtonUI();

  var rawNivel = state.nivel !== undefined ? String(state.nivel).trim() : "";
  var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
  if (isNaN(nivel) || nivel < 0) nivel = 0;

  var isExplicitNoOwn6B = !!(
    OS.freeEdit &&
    (state.hasOwn6B === false ||
      state["has-own-6b"] === false ||
      (state.own6B && typeof state.own6B === "object" && state.own6B.enabled === false))
  );

  if (isExplicitNoOwn6B) {
    OS.config6B = {};
    var cfgDisabledEl = OS.$("config-6b");
    if (cfgDisabledEl) cfgDisabledEl.value = "";
  } else if (OS.freeEdit && state["config-6b"] !== undefined && String(state["config-6b"]).trim() !== "") {
    var cfgFreeEl = OS.$("config-6b");
    if (cfgFreeEl) cfgFreeEl.value = String(state["config-6b"]);
    var parsedCfg = OS.parse6BConfigString(state["config-6b"]);
    if (Object.keys(parsedCfg).length) {
      OS.config6B = Object.assign({}, parsedCfg);
    } else if (state.config6B && typeof state.config6B === "object" && Object.keys(state.config6B).length) {
      OS.config6B = Object.assign({}, state.config6B);
    }
  } else if (state.config6B && typeof state.config6B === "object" && Object.keys(state.config6B).length) {
    OS.config6B = Object.assign({}, state.config6B);
    var cfgEl = OS.$("config-6b");
    if (cfgEl) {
      cfgEl.value = state["config-6b"] ? String(state["config-6b"]) : OS.format6BConfig(OS.config6B);
    }
  } else if (OS.freeEdit && state["config-6b"] !== undefined) {
    var cfgFreeFallback = OS.$("config-6b");
    if (cfgFreeFallback) cfgFreeFallback.value = String(state["config-6b"]);
    var parsedFallback = OS.parse6BConfigString(state["config-6b"]);
    if (Object.keys(parsedFallback).length) {
      OS.config6B = parsedFallback;
    }
  } else if (!OS.freeEdit) {
    OS.update6BForLevel(nivel || 1);
  }

  var remTotalEl = OS.$("rem-total");
  var remAtualEl = OS.$("rem-atual");

  if (OS.freeEdit) {
    if (remTotalEl) {
      remTotalEl.value = state["rem-total"] !== undefined ? String(state["rem-total"]) : "";
    }
    if (remAtualEl) {
      remAtualEl.value = state["rem-atual"] !== undefined ? String(state["rem-atual"]) : "";
    }
    OS.remSpent = typeof state.remSpent === "number" && !isNaN(state.remSpent) ? Math.max(0, state.remSpent) : 0;
    OS.renderMagiasRepertorio();
    return;
  }

  var remMax = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivel) : calculateRemMax(nivel);
  if (remTotalEl) remTotalEl.value = String(remMax);

  if (typeof state.remSpent === "number" && !isNaN(state.remSpent)) {
    OS.remSpent = Math.max(0, state.remSpent);
    if (remAtualEl) remAtualEl.value = String(Math.max(0, remMax - OS.remSpent));
  } else if (state["rem-atual"] !== undefined && String(state["rem-atual"]).trim() !== "") {
    var savedAtual = parseInt(String(state["rem-atual"]), 10);
    if (!isNaN(savedAtual)) {
      if (remAtualEl) remAtualEl.value = String(savedAtual);
      OS.remSpent = Math.max(0, remMax - savedAtual);
    } else {
      OS.remSpent = 0;
      if (remAtualEl) remAtualEl.value = String(remMax);
    }
  } else {
    OS.remSpent = 0;
    if (remAtualEl) remAtualEl.value = String(remMax);
  }

  OS.renderMagiasRepertorio();
};

OS.clearMagiasState = function (options) {
  options = options || {};
  OS.knownSpells = [];
  OS.activeBuffs = [];
  OS._pendingBuffDeactivations = {};
  OS.remSpent = 0;
  OS.updateBuffButtonUI();
  if (options.freeEdit || OS.freeEdit) {
    OS.config6B = {};
    var cfgEl = OS.$("config-6b");
    var remTEl = OS.$("rem-total");
    var remAEl = OS.$("rem-atual");
    if (cfgEl) cfgEl.value = "";
    if (remTEl) remTEl.value = "";
    if (remAEl) remAEl.value = "";
    OS.renderMagiasRepertorio();
    return;
  }
  OS.update6BForLevel(1);
  OS.recalcRem({ resetSpent: true });
  OS.renderMagiasRepertorio();
};

OS.sync6BAndRemUI = function (options) {
  if (OS.freeEdit) {
    OS.update6BForLevel();
    OS.updateMagiasStatusBar();
    OS.renderMagiasRepertorio();
    if (OS.renderFateTokens) OS.renderFateTokens();
    return;
  }
  OS.update6BForLevel(OS.getCurrentLevel());
  OS.recalcRem(options);
  OS.renderMagiasRepertorio();
  if (OS.renderFateTokens) OS.renderFateTokens();
};

/* ─── Bind de eventos ────────────────────────────────────────── */

OS.bindMagiasUI = function () {
  var btnOpenCat = OS.$("btn-magias-catalogo");
  if (btnOpenCat) {
    btnOpenCat.addEventListener("click", OS.openMagiasCatalogModal);
  }

  var btnCancelCat = OS.$("magias-catalog-cancel");
  if (btnCancelCat) {
    btnCancelCat.addEventListener("click", OS.closeMagiasCatalogModal);
  }

  var btnConfirmCat = OS.$("magias-catalog-confirm");
  if (btnConfirmCat) {
    btnConfirmCat.addEventListener("click", handleConfirmAddSpell);
  }

  var btnCreateSpell = OS.$("btn-magias-create-spell");
  if (btnCreateSpell) {
    btnCreateSpell.addEventListener("click", function () {
      toggleCreateSpellForm();
    });
  }

  var btnCancelCreateSpell = OS.$("btn-cancel-created-spell");
  if (btnCancelCreateSpell) {
    btnCancelCreateSpell.addEventListener("click", function () {
      toggleCreateSpellForm(false);
    });
  }

  var btnSaveCreateSpell = OS.$("btn-save-created-spell");
  if (btnSaveCreateSpell) {
    btnSaveCreateSpell.addEventListener("click", function () {
      handleSaveCreatedSpell();
    });
  }

  var catOverlay = OS.$("magias-catalog-modal");
  if (catOverlay) {
    catOverlay.addEventListener("click", function (e) {
      if (e.target === catOverlay) OS.closeMagiasCatalogModal();
    });
  }

  var searchEl = OS.$("magias-catalog-search");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      magiasState.filterText = searchEl.value;
      magiasState.selectedSpell = null;
      magiasState.selectedCaminho = null;
      renderMagiasCatalogList();
      renderMagiasCatalogDetail();
      updateMagiasConfirmBtn();
    });
  }

  var btnLongRestMagias = OS.$("btn-magias-descanso-longo");
  if (btnLongRestMagias) {
    btnLongRestMagias.addEventListener("click", function () {
      OS.performLongRest();
    });
  }

  var btnLevelUp = OS.$("btn-level-up");
  if (btnLevelUp) {
    btnLevelUp.addEventListener("click", OS.openLevelUpModal);
  }

  var btnRollLv = OS.$("btn-levelup-roll");
  if (btnRollLv) {
    btnRollLv.addEventListener("click", OS.rollLevelUpDie);
  }

  var btnCancelLv = OS.$("levelup-roll-cancel");
  if (btnCancelLv) {
    btnCancelLv.addEventListener("click", OS.closeLevelUpModal);
  }

  var btnConfirmLv = OS.$("levelup-roll-confirm");
  if (btnConfirmLv) {
    btnConfirmLv.addEventListener("click", OS.confirmLevelUpRoll);
  }

  var lvOverlay = OS.$("levelup-roll-modal");
  if (lvOverlay) {
    lvOverlay.addEventListener("click", function (e) {
      if (e.target === lvOverlay) OS.closeLevelUpModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var mCat = OS.$("magias-catalog-modal");
      if (mCat && mCat.classList.contains("open")) OS.closeMagiasCatalogModal();
      var mLv = OS.$("levelup-roll-modal");
      if (mLv && mLv.classList.contains("open")) OS.closeLevelUpModal();
      var mBuffs = OS.$("buffs-modal");
      if (mBuffs && mBuffs.classList.contains("open")) OS.closeBuffsModal();
      var mCast = OS.$("buff-cast-modal");
      if (mCast && mCast.classList.contains("open")) OS.closeBuffCastModal();
    }
  });

  // Eventos do modal de Buffs Ativos (#buffs-modal) e Cast de Buff (#buff-cast-modal)
  var btnBuffs = OS.$("btn-buffs");
  if (btnBuffs) {
    btnBuffs.addEventListener("click", OS.openBuffsModal);
  }
  var btnBuffsClose = OS.$("buffs-modal-close");
  if (btnBuffsClose) {
    btnBuffsClose.addEventListener("click", OS.closeBuffsModal);
  }
  var btnBuffsConfirm = OS.$("buffs-modal-confirm");
  if (btnBuffsConfirm) {
    btnBuffsConfirm.addEventListener("click", OS.confirmBuffDeactivations);
  }
  var buffsOverlay = OS.$("buffs-modal");
  if (buffsOverlay) {
    buffsOverlay.addEventListener("click", function (e) {
      if (e.target === buffsOverlay) OS.closeBuffsModal();
    });
  }
  var allySel = OS.$("buff-ally-select");
  if (allySel) {
    allySel.addEventListener("change", OS.populateAllyReceiveBuffSelect);
  }
  var btnApplyAlly = OS.$("btn-apply-ally-buff");
  if (btnApplyAlly) {
    btnApplyAlly.addEventListener("click", OS.receiveAllyBuffFromModal);
  }

  var castCostInp = OS.$("buff-cast-cost-input");
  if (castCostInp) {
    castCostInp.addEventListener("input", OS.updateBuffCastPreviewUI);
    castCostInp.addEventListener("change", OS.updateBuffCastPreviewUI);
  }
  var castDurInp = OS.$("buff-cast-duration-input");
  if (castDurInp) {
    castDurInp.addEventListener("input", OS.updateBuffCastPreviewUI);
  }
  var btnCastCancel = OS.$("buff-cast-cancel");
  if (btnCastCancel) {
    btnCastCancel.addEventListener("click", OS.closeBuffCastModal);
  }
  var btnCastConfirm = OS.$("buff-cast-confirm");
  if (btnCastConfirm) {
    btnCastConfirm.addEventListener("click", OS.confirmBuffCastModal);
  }
  var castOverlay = OS.$("buff-cast-modal");
  if (castOverlay) {
    castOverlay.addEventListener("click", function (e) {
      if (e.target === castOverlay) OS.closeBuffCastModal();
    });
  }

  OS.updateBuffButtonUI();

  var nivelEl = OS.$("nivel");
  if (nivelEl) {
    nivelEl.addEventListener("input", function () {
      OS.sync6BAndRemUI();
    });
    nivelEl.addEventListener("change", function () {
      OS.sync6BAndRemUI();
    });
  }

  var remAtualEl = OS.$("rem-atual");
  if (remAtualEl) {
    remAtualEl.addEventListener("input", function () {
      var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
      var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
      if (isNaN(nivel) || nivel < 0) nivel = 0;
      var remMax = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivel) : calculateRemMax(nivel);
      var val = parseInt(String(remAtualEl.value || 0), 10);
      if (!isNaN(val)) {
        OS.remSpent = Math.max(0, remMax - val);
      }
      OS.updateMagiasStatusBar();
    });
  }

  var cfg6bEl = OS.$("config-6b");
  if (cfg6bEl) {
    var onCfg6bChange = function () {
      if (OS.freeEdit) {
        var rawCfgText = String(cfg6bEl.value || "").trim();
        if (typeof OS.setOwn6BComposition === "function") {
          if (rawCfgText) {
            OS.setOwn6BComposition(rawCfgText, {
              preserveConfigInput: true,
              markExplicit: true
            });
          } else if (OS.hasOwn6B === true) {
            OS.setOwn6BComposition("", {
              preserveConfigInput: true,
              skipSave: true
            });
          }
        } else {
          var parsed = OS.parse6BConfigString(rawCfgText);
          if (Object.keys(parsed).length) {
            OS.config6B = parsed;
          }
        }
        OS.updateMagiasStatusBar();
        if (typeof OS.syncUsedChambersVisual === "function") {
          OS.syncUsedChambersVisual(true);
        }
        if (typeof OS.updateReloadButtonState === "function") {
          OS.updateReloadButtonState();
        }
      }
    };
    cfg6bEl.addEventListener("input", onCfg6bChange);
    cfg6bEl.addEventListener("change", onCfg6bChange);
  }

  var remTotalInp = OS.$("rem-total");
  if (remTotalInp) {
    remTotalInp.addEventListener("input", function () {
      if (OS.freeEdit) {
        OS.updateMagiasStatusBar();
      }
    });
  }

  var misticismoCbs = document.querySelectorAll("input[name^='pericia-misticismo-']");
  misticismoCbs.forEach(function (cb) {
    cb.addEventListener("change", function () {
      OS.sync6BAndRemUI();
    });
  });

  OS.sync6BAndRemUI();
};
