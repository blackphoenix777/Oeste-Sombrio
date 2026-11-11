/**
 * Inventário estruturado — lista de itens com borda, popup de detalhes, botão equipar,
 * exibição categorizada na aba Ficha (Corpo a Corpo, À Distância, Vestuário),
 * botão individual de rolagem por arma equipada e tracker de munição com recarga automática.
 */
import { OS } from "./app.js";
import {
  DEFAULT_BACKPACK_CAPACITY,
  roundVolume,
  formatVolume,
  normalizeStorageLocation,
  normalizeItemKey,
  isAnimalItem,
  isHorseItem,
  getMountSlotType,
  getContainerCapacityFromItem,
  getItemVolumeInfo,
  getItemVolume,
  volumeOcupado,
  volumeLivre,
  podeReceberItem,
  describeCapacityBlock,
  transferItemStack,
  calculateLooseLoadCapacity,
  doesItemCountAsLooseLoad,
  countLooseLoadItems,
  evaluateOverloadState,
  getAtletismoLevel
} from "./rules/index.js";

/* ─── grupos que permitem equipar (Armas, Vestuário e Equipamentos de Montaria — nunca Animais nem Kits) ── */
var EQUIPPABLE_GROUPS = ["armas", "vestuario", "equipamentos_de_montaria"];
var EQUIPPABLE_LIST_IDS = ["equipamentos_de_montaria"];

/* Armas que constam simultaneamente em armas_corpo_a_corpo.json e arcos_e_bestas.json */
var DUAL_USE_WEAPON_NAMES = [
  "lança de combate",
  "lâminas curtas",
  "faca de caça",
  "machete",
  "arma improvisada",
  "picareta",
  "machadinha",
  "machado"
];

/* prefixo das linhas geradas na área de equipamentos */
var EQUIP_LINE_PREFIX = "⚙ ";

/* campos do JSON usados como nome do item (não entram nos atributos) */
var NAME_KEYS = ["nome", "kit", "mutagenico"];

/* atributos omitidos na linha da área de equipamentos (continuam no popup) */
var EQUIP_LINE_SKIP = ["preco", "descricao", "mutagenico"];

var GROUP_LABELS = {
  "armas": "Armas",
  "equipamentos": "Equipamentos",
  "vestuario": "Vestuário",
  "animais e equipamentos": "Animais & Montaria",
  "equipamentos_de_montaria": "Equipamentos de Montaria",
  "itens": "Itens",
  "criados": "Criados"
};

var ATTR_LABELS = {
  preco: "Preço",
  volume: "Volume",
  capacidade_volumes: "Capacidade (volumes)",
  dano: "Dano",
  alcance: "Alcance",
  recarga: "Recarga",
  tambor: "Tambor",
  municao: "Munição",
  modelo: "Modelo",
  raio: "Raio",
  duracao: "Duração",
  duracao_maxima: "Duração máxima",
  resistencia: "Resistência",
  protecao: "Proteção",
  vantagem: "Vantagem",
  desvantagem: "Desvantagem",
  detalhes: "Detalhes",
  descricao: "Descrição",
  efeitos: "Efeitos",
  peso: "Peso",
  capacidade: "Capacidade",
  estagio_1: "Estágio 1",
  estagio_2: "Estágio 2",
  estagio_3: "Estágio 3",
  estagio_4: "Estágio 4",
  mutagenico: "Tônico mutagênico"
};

OS.inventoryItems = [];
OS.firstPurchaseDiscountUsed = false;

/* ─── helpers de dinheiro (itens_e_equipamentos.json) ────────── */

OS.calculateInitialMoney = function (nivel) {
  var lv = parseInt(String(nivel !== undefined ? nivel : (OS.getCurrentLevel ? OS.getCurrentLevel() : 1)), 10);
  if (isNaN(lv) || lv < 1) lv = 1;
  var ieData = OS.getGameData ? OS.getGameData("itens_e_equipamentos") : null;
  var base =
    (ieData && ieData.dinheiro_inicial && ieData.dinheiro_inicial.valor_inicial_nivel_1) || 10;
  var extra =
    (ieData && ieData.dinheiro_inicial && ieData.dinheiro_inicial.valor_extra_por_nivel_adicional) || 5;
  return base + Math.max(0, lv - 1) * extra;
};

OS.parseItemPrice = function (rawPreco) {
  if (
    rawPreco === null ||
    rawPreco === undefined ||
    rawPreco === "" ||
    rawPreco === "X" ||
    rawPreco === "x"
  ) {
    return 0;
  }
  if (typeof rawPreco === "number") {
    return isNaN(rawPreco) || rawPreco < 0 ? 0 : rawPreco;
  }
  var s = String(rawPreco).trim();
  if (!s || s.toUpperCase() === "X") return 0;
  var centMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*¢/);
  if (centMatch) {
    var cents = parseFloat(centMatch[1].replace(",", "."));
    return isNaN(cents) ? 0 : Math.round(cents) / 100;
  }
  var numMatch = s.match(/(\d+(?:[.,]\d+)?)/);
  if (numMatch) {
    var val = parseFloat(numMatch[1].replace(",", "."));
    return isNaN(val) ? 0 : val;
  }
  return 0;
};

OS.getCharacterMoney = function () {
  var el = document.getElementById("dinheiro");
  if (!el) return 0;
  var raw = String(el.value || "").replace("$", "").replace(",", ".").trim();
  var val = parseFloat(raw);
  return isNaN(val) ? 0 : Math.round(val * 100) / 100;
};

OS.setCharacterMoney = function (amount) {
  var clean = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
  var el = document.getElementById("dinheiro");
  if (el) {
    el.value = String(clean);
  }
  var badge = document.getElementById("catalog-money-display");
  if (badge) {
    badge.textContent = "Saldo: $" + clean;
  }
  return clean;
};

/* ─── helpers gerais ─────────────────────────────────────────── */

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

function attrLabel(key) {
  if (ATTR_LABELS[key]) return ATTR_LABELS[key];
  var s = String(key || "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listIdToLabel(id) {
  return (id || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function isEquippable(invItem) {
  if (!invItem) return false;
  if (isAnimalItem(invItem)) return false;
  if (normalizeItemKey(invItem.listId) === "kits") return false;
  if (getMountSlotType(invItem) !== null) return true;
  if (EQUIPPABLE_GROUPS.indexOf(invItem.group) >= 0) return true;
  if (EQUIPPABLE_LIST_IDS.indexOf(invItem.listId) >= 0) return true;
  return false;
}
OS.isItemEquippable = isEquippable;

function getItemName(itemData) {
  return itemData.nome || itemData.kit || itemData.mutagenico || "(item)";
}

function getWeaponMaxAmmo(invItem) {
  var attrs = (invItem && invItem.attrs) || {};
  var raw = attrs.tambor !== undefined && attrs.tambor !== null && attrs.tambor !== ""
    ? attrs.tambor
    : attrs.municao;
  var n = parseInt(String(raw || ""), 10);
  return !isNaN(n) && n > 0 ? n : 1;
}

function ensureWeaponAmmoInitialized(invItem) {
  if (!invItem || invItem.group !== "armas") return;
  var maxAmmo = getWeaponMaxAmmo(invItem);
  if (typeof invItem.ammoMax !== "number" || invItem.ammoMax <= 0) {
    invItem.ammoMax = maxAmmo;
  }
  if (
    typeof invItem.ammoCurrent !== "number" ||
    invItem.ammoCurrent <= 0 ||
    invItem.ammoCurrent > invItem.ammoMax
  ) {
    invItem.ammoCurrent = invItem.ammoMax;
  }
  if (typeof invItem.autoReloadCount !== "number") {
    invItem.autoReloadCount = 0;
  }
}

function isWeaponInBothCatalogLists(itemName) {
  var needle = String(itemName || "").trim().toLowerCase();
  if (!needle) return false;
  if (DUAL_USE_WEAPON_NAMES.indexOf(needle) >= 0) return true;

  var cat = OS.equipCatalog;
  if (!cat || !cat.loaded || !cat.byId) return false;

  var inMelee = false;
  var inRanged = false;
  var meleeRec = cat.byId["armas_corpo_a_corpo"];
  if (meleeRec) {
    var mItems = getRecordItems(meleeRec);
    inMelee = mItems.some(function (it) {
      return it && String(getItemName(it)).trim().toLowerCase() === needle;
    });
  }
  var rangedIds = [
    "arcos_e_bestas",
    "explosivos_e_armas_de_arremesso",
    "pistolas",
    "revolveres",
    "rifles",
    "escopetas",
    "espingardas_de_repeticao",
    "armas_estranhas"
  ];
  for (var i = 0; i < rangedIds.length; i++) {
    var rec = cat.byId[rangedIds[i]];
    if (!rec) continue;
    var rItems = getRecordItems(rec);
    if (
      rItems.some(function (it) {
        return it && String(getItemName(it)).trim().toLowerCase() === needle;
      })
    ) {
      inRanged = true;
      break;
    }
  }
  return inMelee && inRanged;
}

/**
 * Extrai o alcance em metros a partir da string de alcance do JSON (ex: "15m/10q", "90m/80q", "(15m/10q) ou (30m/20q)").
 */
OS.parseWeaponRangeMeters = function (alcanceRaw) {
  if (alcanceRaw === null || alcanceRaw === undefined || alcanceRaw === "") return 0;
  if (typeof alcanceRaw === "number") return isNaN(alcanceRaw) ? 0 : alcanceRaw;
  var s = String(alcanceRaw);
  var matches = [];
  var re = /(\d+(?:[.,]\d+)?)\s*m\b/gi;
  var m;
  while ((m = re.exec(s)) !== null) {
    var val = parseFloat(m[1].replace(",", "."));
    if (!isNaN(val)) matches.push(val);
  }
  if (matches.length > 0) {
    return Math.max.apply(null, matches);
  }
  var numMatch = s.match(/(\d+(?:[.,]\d+)?)/);
  if (numMatch) {
    var fallback = parseFloat(numMatch[1].replace(",", "."));
    if (!isNaN(fallback)) return fallback;
  }
  return 0;
};

/**
 * Classifica uma arma à distância em "arma_curta" (10 a 30m / <= 30m) ou "arma_longa" (> 30m)
 * derivando do campo alcance já existente no JSON.
 */
OS.classifyRangedWeaponByAlcance = function (invItem) {
  var attrs = (invItem && invItem.attrs) || {};
  var rawAlcance = attrs.alcance || attrs.raio || "";
  if (!rawAlcance && invItem && invItem.name) {
    var found = findCatalogItemByName(invItem.name);
    if (found && found.item) {
      rawAlcance = found.item.alcance || found.item.raio || "";
    }
  }
  var meters = OS.parseWeaponRangeMeters(rawAlcance);
  if (meters > 30) {
    return "arma_longa";
  }
  return "arma_curta";
};

/**
 * Obtém o valor numérico de proteção de um item de vestuário a partir do campo protecao extraído no JSON.
 */
OS.getVestuarioProtectionValue = function (invItem) {
  if (!invItem) return 0;
  var attrs = invItem.attrs || {};
  if (attrs.protecao !== undefined && attrs.protecao !== null && attrs.protecao !== "") {
    var parsed = parseInt(String(attrs.protecao).replace(/[^\d-]/g, ""), 10);
    if (!isNaN(parsed)) return parsed;
  }
  var found = findCatalogItemByName(invItem.name);
  if (found && found.item && found.item.protecao !== undefined && found.item.protecao !== null) {
    var catProt = parseInt(String(found.item.protecao).replace(/[^\d-]/g, ""), 10);
    if (!isNaN(catProt)) {
      if (invItem.attrs) invItem.attrs.protecao = catProt;
      return catProt;
    }
  }
  return 0;
};

OS.getTotalProtection = function () {
  var total = 0;
  (OS.inventoryItems || []).forEach(function (invItem) {
    if (!invItem || !invItem.equipped || invItem.group !== "vestuario") return;
    var val = OS.getVestuarioProtectionValue(invItem);
    var qty = Math.max(1, parseInt(invItem.qty, 10) || 1);
    total += val * qty;
  });
  return total;
};

/**
 * Determina em quais blocos da aba Ficha um item equipado deve aparecer:
 * - "vestuario" -> ["vestuario"] (bloco PROTEÇÃO)
 * - "armas" -> ["corpo_a_corpo"], ["arma_curta"], ["arma_longa"]
 *   ou ["corpo_a_corpo", "arma_curta" | "arma_longa"] para armas de uso duplo.
 */
OS.getEquippedCategories = function (invItem) {
  if (!invItem || !invItem.equipped || !isEquippable(invItem)) return [];
  if (invItem.group === "vestuario") {
    return ["vestuario"];
  }
  if (invItem.group === "armas") {
    var attrs = invItem.attrs || {};
    var alcance = String(attrs.alcance || "").toLowerCase();
    var subtipo = String(attrs.subtipo || attrs.uso || invItem.listId || "").toLowerCase();

    var hasMeleeAlcance =
      alcance.indexOf("corpo-a-corpo") >= 0 ||
      alcance.indexOf("corpo a corpo") >= 0 ||
      alcance.indexOf("c.a.c") >= 0;
    var hasRangedAlcance =
      /\d+\s*(m|q)\b/i.test(alcance) ||
      alcance.indexOf("distância") >= 0 ||
      alcance.indexOf("distancia") >= 0 ||
      alcance.indexOf("arremesso") >= 0;

    var rangedSlot = OS.classifyRangedWeaponByAlcance(invItem);

    if (
      subtipo === "ambos" ||
      (hasMeleeAlcance && hasRangedAlcance) ||
      isWeaponInBothCatalogLists(invItem.name)
    ) {
      return ["corpo_a_corpo", rangedSlot];
    }

    if (invItem.listId === "armas_corpo_a_corpo" || subtipo === "corpo_a_corpo" || hasMeleeAlcance) {
      return ["corpo_a_corpo"];
    }

    return [rangedSlot];
  }
  return [];
};

/**
 * Copia todos os atributos simples do item do JSON (sem alterar o original).
 */
function collectAttrs(itemData, parentData) {
  var attrs = {};
  if (parentData) {
    var parentName = parentData.mutagenico || parentData.nome;
    if (parentName) attrs.mutagenico = parentName;
  }
  Object.keys(itemData).forEach(function (k) {
    if (NAME_KEYS.indexOf(k) >= 0 || k === "id" || k === "group" || k === "listId") return;
    var v = itemData[k];
    if (isEmptyVal(v) || typeof v === "object") return;
    attrs[k] = v;
  });
  if (parentData && !isEmptyVal(parentData.descricao) && isEmptyVal(attrs.descricao)) {
    attrs.descricao = parentData.descricao;
  }
  return attrs;
}

/* ─── rolagem de dano de arma equipada ───────────────────────── */

OS.rollWeaponDamageString = function (danoStr) {
  var s = String(danoStr || "d6").trim();
  var diceRegex = /(\d*)d(\d+)/gi;
  var match;
  var total = 0;
  var parts = [];
  var foundAny = false;

  while ((match = diceRegex.exec(s)) !== null) {
    foundAny = true;
    var count = parseInt(match[1] || "1", 10) || 1;
    var sides = parseInt(match[2] || "6", 10) || 6;
    var dieName = "d" + sides;
    for (var i = 0; i < count; i++) {
      var r = OS.generateDiceResult ? OS.generateDiceResult(dieName) : (((Math.random() * sides) | 0) + 1);
      total += r;
      parts.push("1" + dieName + "(" + r + ")");
    }
  }

  if (!foundAny) {
    var fallback = OS.generateDiceResult ? OS.generateDiceResult("d6") : (((Math.random() * 6) | 0) + 1);
    total = fallback;
    parts.push("1d6(" + fallback + ")");
  }

  var plusRegex = /\+\s*(\d+)(?!\s*d)/gi;
  var plusMatch;
  while ((plusMatch = plusRegex.exec(s)) !== null) {
    var addVal = parseInt(plusMatch[1], 10) || 0;
    if (addVal > 0) {
      total += addVal;
      parts.push(String(addVal));
    }
  }

  var minusMatch = s.match(/-\s*(\d+)/);
  if (minusMatch) {
    var sub = parseInt(minusMatch[1], 10) || 0;
    total -= sub;
    if (sub > 0) {
      parts.push("-" + sub);
    }
  }
  if (/min\s*1/i.test(s) || total < 1) {
    total = Math.max(1, total);
  }

  return {
    total: total,
    label: parts.join(" + ")
  };
};

OS.getCombatSkillInfoForSlot = function (slotCategory) {
  var map = {
    arma_curta: { skillKey: "combate-arma-curta", label: "Arma curta" },
    arma_longa: { skillKey: "combate-arma-longa", label: "Arma longa" },
    corpo_a_corpo: { skillKey: "combate-corpo-a-corpo", label: "Corpo a corpo" }
  };
  var entry = map[slotCategory] || map.arma_curta;
  var rowEl = document.querySelector('.skill-row[data-skill-key="' + entry.skillKey + '"]');
  var dice = rowEl && OS.getSelectedDice ? OS.getSelectedDice(rowEl) : [];
  return {
    skillKey: entry.skillKey,
    label: entry.label,
    rowEl: rowEl,
    dice: dice
  };
};

OS.rollCombatSkillForWeapon = function (slotCategory, optOverrideDie) {
  var info = OS.getCombatSkillInfoForSlot(slotCategory);
  var dice = (optOverrideDie ? [optOverrideDie] : info.dice) || [];
  if (dice.length > 0) {
    var rolled = OS.rollSelectedDiceDetailed
      ? OS.rollSelectedDiceDetailed(dice)
      : { results: OS.rollSelectedDice ? OS.rollSelectedDice(dice) : [OS.generateDiceResult(dice[0])], details: [] };
    var highest = OS.getHighestRoll ? OS.getHighestRoll(rolled.results) : Math.max.apply(null, rolled.results);
    var parts = [];
    for (var i = 0; i < dice.length; i++) {
      parts.push("1" + dice[i] + "(" + rolled.results[i] + ")");
    }
    return {
      total: highest,
      label: info.label + " [" + parts.join(" · ") + " -> " + highest + "]",
      skillLabel: info.label,
      dice: dice.slice(),
      results: rolled.results.slice(),
      details: rolled.details || [],
      rowEl: info.rowEl
    };
  }
  // Perícia não treinada: 1d4 - 2 (sem explosão) conforme sistema_de_testes.json
  var rawD4 = OS.generateDiceResult ? OS.generateDiceResult("d4") : (((Math.random() * 4) | 0) + 1);
  var untrainedTotal = rawD4 - 2;
  return {
    total: untrainedTotal,
    label: info.label + " [1d4(" + rawD4 + ")-2 = " + untrainedTotal + "]",
    skillLabel: info.label,
    dice: ["d4-2"],
    results: [untrainedTotal],
    details: [],
    rowEl: info.rowEl
  };
};

var UNARMED_PSEUDO_WEAPON = {
  id: "__unarmed__",
  name: "Ataque Desarmado",
  group: "armas",
  equipped: true,
  isUnarmed: true,
  attrs: { dano: "0", alcance: "corpo-a-corpo" },
  lastWeaponRollText: "",
  lastMeleeRollText: "",
  lastRangedRollText: ""
};
OS.unarmedPseudoWeapon = UNARMED_PSEUDO_WEAPON;
OS.naturalAttackRollResults = OS.naturalAttackRollResults || {};

OS.parseEquipmentAttackLines = function (equipText, sheetData) {
  var rawText =
    equipText !== undefined && equipText !== null
      ? String(equipText)
      : document.getElementById("equipamentos")
      ? String(document.getElementById("equipamentos").value || "")
      : "";
  var d = sheetData || {};
  var armaCurtaName = String(
    d["arma-curta-arma"] ||
      (document.getElementById("arma-curta-arma") && document.getElementById("arma-curta-arma").value) ||
      ""
  )
    .trim()
    .toLowerCase();
  var armaLongaName = String(
    d["arma-longa-arma"] ||
      (document.getElementById("arma-longa-arma") && document.getElementById("arma-longa-arma").value) ||
      ""
  )
    .trim()
    .toLowerCase();
  var corpoACorpoName = String(
    d["corpo-a-corpo-arma"] ||
      (document.getElementById("corpo-a-corpo-arma") && document.getElementById("corpo-a-corpo-arma").value) ||
      ""
  )
    .trim()
    .toLowerCase();

  var lines = rawText
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);

  var attacks = [];
  lines.forEach(function (rawLine, idx) {
    var hasGearPrefix = rawLine.indexOf("⚙") === 0;
    var hasPericiaOrDano = /per[íi]cia\s*d\d+|dano[:\s]*\d*d\d+/i.test(rawLine);
    if (!hasGearPrefix && !hasPericiaOrDano) return;

    var clean = rawLine.replace(/^⚙\s*/, "").trim();
    var dashSplit = clean.split(/\s*(?:—|–|\s-\s)\s*/);
    var name = (dashSplit[0] || clean).trim();
    var rest = dashSplit.slice(1).join(" — ").trim();

    var skillMatch = rawLine.match(/per[íi]cia[:\s]*(d\d+)/i);
    var skillDie = skillMatch ? skillMatch[1].toLowerCase() : "";

    var dmgMatch = rawLine.match(/dano[:\s]*((?:\d*d\d+)(?:\s*[+-]\s*\d+)?)/i);
    var damageExpr = dmgMatch ? dmgMatch[1].replace(/\s+/g, " ").trim() : "d6";

    var lowerName = name.toLowerCase();
    var slotCategory = "corpo_a_corpo";
    if (armaLongaName && lowerName === armaLongaName) {
      slotCategory = "arma_longa";
    } else if (armaCurtaName && lowerName === armaCurtaName) {
      slotCategory = "arma_curta";
    } else if (corpoACorpoName && lowerName === corpoACorpoName) {
      slotCategory = "corpo_a_corpo";
    } else if (/espingarda|rifle|arco|besta|arma\s*longa|carabina/i.test(lowerName)) {
      slotCategory = "arma_longa";
    } else if (/pistola|rev[óo]lver|arma\s*curta|lan[çc]amento|arremesso|escopeta/i.test(lowerName)) {
      slotCategory = "arma_curta";
    }

    var naturalKey = "natural-" + idx;
    var savedRoll =
      (d.sceneAttackRolls && d.sceneAttackRolls[naturalKey]) ||
      (d.skillRollResults && d.skillRollResults[naturalKey]) ||
      (OS.naturalAttackRollResults && OS.naturalAttackRollResults[naturalKey]);
    var rollTxt = savedRoll
      ? typeof savedRoll === "string"
        ? savedRoll
        : savedRoll.text || ""
      : "";

    attacks.push({
      id: "__natural_" + idx + "__",
      naturalIndex: idx,
      naturalKey: naturalKey,
      name: name,
      rawLine: rawLine,
      restText: rest,
      group: "armas",
      equipped: true,
      isNaturalAttack: true,
      slotCategory: slotCategory,
      naturalSkillDie: skillDie,
      damageExpr: damageExpr,
      attrs: {
        dano: damageExpr,
        alcance:
          slotCategory === "corpo_a_corpo"
            ? "corpo-a-corpo"
            : slotCategory === "arma_longa"
            ? "50m"
            : "15m"
      },
      lastWeaponRoll: savedRoll && typeof savedRoll === "object" ? savedRoll.total : undefined,
      lastWeaponRollText: rollTxt,
      lastMeleeRollText: slotCategory === "corpo_a_corpo" ? rollTxt : "",
      lastRangedRollText: slotCategory !== "corpo_a_corpo" ? rollTxt : ""
    });
  });

  return attacks;
};

OS.getNaturalAttackById = function (invId) {
  if (!invId || String(invId).indexOf("__natural_") !== 0) return null;
  var list = OS.parseEquipmentAttackLines();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === invId) return list[i];
  }
  return null;
};

OS.ensureFichaChambersReadyForWeaponRoll = function () {
  var hasAvailable = false;
  var allZero = true;
  for (var i = 0; i < 6; i++) {
    var val = OS.chamberValueAt ? OS.chamberValueAt(i) : 0;
    if (val > 0) {
      allZero = false;
      if (!OS.usedChambers || OS.usedChambers.indexOf(i) < 0) {
        hasAvailable = true;
      }
    }
  }
  if (!hasAvailable && (allZero || OS.freeEdit)) {
    var cfgEl = document.getElementById("config-6b");
    var rawCfg = cfgEl && cfgEl.value ? String(cfgEl.value).trim() : "";
    var parsedFromInput =
      rawCfg && OS.parse6BConfigString ? OS.parse6BConfigString(rawCfg) : {};
    var cfgObj =
      OS.freeEdit && Object.keys(parsedFromInput).length
        ? parsedFromInput
        : OS.config6B && typeof OS.config6B === "object" && Object.keys(OS.config6B).length
        ? OS.config6B
        : Object.keys(parsedFromInput).length
        ? parsedFromInput
        : { d6: 6 };
    var dicePool = [];
    ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
      var n = parseInt(String(cfgObj[die] || 0), 10) || 0;
      for (var k = 0; k < n; k++) dicePool.push(die);
    });
    if (!dicePool.length) dicePool = ["d6"];
    OS.usedChambers = [];
    for (var c = 0; c < 6; c++) {
      var inp = document.getElementById("chamber-" + c);
      if (!inp) continue;
      if (c < dicePool.length) {
        var sides = parseInt(dicePool[c].slice(1), 10) || 6;
        var r = Math.floor(Math.random() * sides) + 1;
        inp.value = String(r);
        inp.setAttribute("data-original-val", String(r));
      } else {
        inp.value = "0";
        inp.setAttribute("data-original-val", "0");
      }
      if (OS.applyChamberValue) OS.applyChamberValue(inp);
    }
    if (OS.syncUsedChambersVisual) OS.syncUsedChambersVisual(true);
    if (OS.updateReloadButtonState) OS.updateReloadButtonState();
  }
};

OS.executeConfirmedWeaponRoll = function (invId, slotCategory, selectedChambers) {
  var isPseudoUnarmed = invId === "__unarmed__";
  var isNaturalAttack = typeof invId === "string" && invId.indexOf("__natural_") === 0;
  var invItem = isPseudoUnarmed
    ? UNARMED_PSEUDO_WEAPON
    : isNaturalAttack
    ? OS.getNaturalAttackById(invId)
    : OS.inventoryItems.find(function (i) { return i.id === invId; });
  if (!invItem || !invItem.equipped || invItem.group !== "armas") return null;

  // Regra obrigatória: escolher pelo menos 1 valor do 6B para confirmar a rolagem da arma
  if (!Array.isArray(selectedChambers) || selectedChambers.length < 1) {
    return null;
  }

  var isUnarmed = !!(isPseudoUnarmed || invItem.isUnarmed || /desarmad/i.test(invItem.name || ""));
  if (!isPseudoUnarmed && !isNaturalAttack) {
    ensureWeaponAmmoInitialized(invItem);
  }

  var cats = isPseudoUnarmed
    ? ["corpo_a_corpo"]
    : isNaturalAttack
    ? [invItem.slotCategory || "corpo_a_corpo"]
    : OS.getEquippedCategories(invItem);
  var resolvedSlot = isPseudoUnarmed
    ? "corpo_a_corpo"
    : slotCategory || (cats.length ? cats[0] : "arma_curta");
  var isMeleeSlot = resolvedSlot === "corpo_a_corpo";
  var autoReloaded = false;

  var chamberBonus = OS.calculateChamberBonus ? OS.calculateChamberBonus(selectedChambers) : 0;
  var chamberValues = selectedChambers.map(function (idx) {
    return OS.chamberValueAt ? OS.chamberValueAt(idx) : 0;
  });

  if (OS.consumeCylinderChambers) {
    OS.consumeCylinderChambers(selectedChambers);
  }
  if (OS.updateReloadButtonState) {
    OS.updateReloadButtonState();
  }

  if (!isMeleeSlot && !isPseudoUnarmed && !isNaturalAttack) {
    invItem.ammoCurrent -= 1;
    if (invItem.ammoCurrent <= 0) {
      invItem.ammoCurrent = invItem.ammoMax;
      invItem.autoReloadCount = (invItem.autoReloadCount || 0) + 1;
      autoReloaded = true;
    }
    invItem._justReloaded = autoReloaded;
  }

  var skillRoll = OS.rollCombatSkillForWeapon(
    resolvedSlot,
    isNaturalAttack && invItem.naturalSkillDie ? invItem.naturalSkillDie : undefined
  );
  var danoStr = isPseudoUnarmed ? "Desarmado" : String((invItem.attrs && invItem.attrs.dano) || invItem.damageExpr || "d6");
  var dmgRoll = isPseudoUnarmed
    ? { total: 0, label: "Desarmado (0)" }
    : OS.rollWeaponDamageString(danoStr);

  var attackBuffEval = OS.evaluateAndConsumeAttackBuffs
    ? OS.evaluateAndConsumeAttackBuffs({
        isUnarmed: isUnarmed,
        isMelee: isMeleeSlot,
        isProjectile: !isMeleeSlot,
        slotCategory: resolvedSlot,
        weaponName: invItem.name
      })
    : { total: 0, items: [], consumedIds: [] };
  var attackBuffBonus = attackBuffEval.total || 0;

  var finalTotal = skillRoll.total + dmgRoll.total + chamberBonus + attackBuffBonus;

  invItem.lastSkillRollPart = skillRoll.total;
  invItem.lastDamageRollPart = dmgRoll.total;
  invItem.lastChamberBonusPart = chamberBonus;
  invItem.lastBuffBonusPart = attackBuffBonus;
  invItem.lastWeaponRoll = finalTotal;

  var rollText =
    "Perícia " +
    skillRoll.total +
    (isPseudoUnarmed ? "" : (" + Dano " + dmgRoll.label + "(" + dmgRoll.total + ")")) +
    (attackBuffBonus ? (" + Buffs(+" + attackBuffBonus + ")") : "") +
    " + 6B(+" +
    chamberBonus +
    ") = " +
    finalTotal;

  if (isMeleeSlot) {
    invItem.lastMeleeRollText = rollText;
    invItem.lastWeaponRollText = rollText;
  } else {
    invItem.lastRangedRollText = rollText + (autoReloaded ? " (Recarregado!)" : "");
    invItem.lastWeaponRollText = invItem.lastRangedRollText;
  }

  if (isNaturalAttack && invItem.naturalKey) {
    OS.naturalAttackRollResults[invItem.naturalKey] = {
      text: invItem.lastWeaponRollText,
      total: finalTotal,
      rolled: true
    };
  }

  if (skillRoll.rowEl) {
    var rowOut = skillRoll.rowEl.querySelector(".roll-result");
    if (rowOut) {
      rowOut.textContent = invItem.name + ": " + invItem.lastWeaponRollText;
      rowOut.classList.add("rolled");
      rowOut.hidden = false;
      rowOut.removeAttribute("hidden");
    }
  }

  OS.lastSkillRollContext = {
    rowEl: skillRoll.rowEl || null,
    outEl: skillRoll.rowEl ? skillRoll.rowEl.querySelector(".roll-result") : null,
    skillKey: (skillRoll.rowEl && skillRoll.rowEl.getAttribute("data-skill-key")) || "",
    skillName: invItem.name + " (" + skillRoll.skillLabel + ")",
    dice: skillRoll.dice,
    results: skillRoll.results,
    baseResult: skillRoll.total + dmgRoll.total,
    bonus: chamberBonus,
    buffBonus: attackBuffBonus,
    buffItems: attackBuffEval.items || [],
    total: finalTotal
  };

  // Rolagens de combate (armas) não usam nem exibem o bloco de Dificuldade do Teste geral
  if (OS.syncTestCalcModalPlacement) {
    OS.syncTestCalcModalPlacement("roll-modal-test-calc-slot", false);
  }

  // Exibir resumo detalhado no #roll-modal reaproveitado
  var rollModal = document.getElementById("roll-modal");
  if (rollModal) {
    var titleEl = document.getElementById("roll-modal-title");
    var subEl = document.getElementById("roll-modal-sub");
    var detailsEl = document.getElementById("roll-modal-details");
    var totalEl = document.getElementById("roll-modal-total");
    var totalLabel = rollModal.querySelector(".roll-total-label");
    if (titleEl) titleEl.textContent = invItem.name + " — " + skillRoll.skillLabel;
    if (subEl) subEl.textContent = isPseudoUnarmed
      ? "Perícia + Valores do 6B" + (attackBuffBonus ? " + Buffs" : "")
      : "Perícia + Dano da Arma + Valores do 6B" + (attackBuffBonus ? " + Buffs" : "");
    if (totalLabel) totalLabel.textContent = "Resultado Final";
    if (totalEl) totalEl.textContent = String(finalTotal);
    if (detailsEl) {
      var buffLinesHtml = "";
      if (attackBuffEval.items && attackBuffEval.items.length) {
        for (var bIdx = 0; bIdx < attackBuffEval.items.length; bIdx++) {
          buffLinesHtml +=
            '<div class="roll-line">Buff — ' + esc(attackBuffEval.items[bIdx].detail) + '</div>';
        }
      }
      var dmgLineHtml = isPseudoUnarmed
        ? '<div class="roll-line">Dano Base (Desarmado): <strong>0</strong></div>'
        : '<div class="roll-line">Dano da Arma (' + esc(danoStr) + '): <strong>' + dmgRoll.total + '</strong> (' + esc(dmgRoll.label) + ')</div>';
      detailsEl.innerHTML =
        '<div class="roll-line">Perícia (' + esc(skillRoll.skillLabel) + '): <strong>' + skillRoll.total + '</strong></div>' +
        dmgLineHtml +
        buffLinesHtml +
        '<div class="roll-line">Câmaras 6B (' + chamberValues.map(function (v) { return "+" + v; }).join(", ") + '): <strong>+' + chamberBonus + '</strong></div>' +
        '<div class="roll-line roll-line-best">Total Final: <strong>' + finalTotal + '</strong></div>';
    }
    rollModal.classList.add("open");
  }

  OS.renderInventory();
  OS.scheduleSave();

  return {
    total: finalTotal,
    skillRoll: skillRoll.total,
    damageRoll: dmgRoll.total,
    buffBonus: attackBuffBonus,
    buffItems: attackBuffEval.items || [],
    consumedBuffIds: attackBuffEval.consumedIds || [],
    chamberBonus: chamberBonus,
    selectedChambers: selectedChambers.slice(),
    ammoCurrent: isPseudoUnarmed || isNaturalAttack ? null : invItem.ammoCurrent,
    ammoMax: isPseudoUnarmed || isNaturalAttack ? null : invItem.ammoMax,
    autoReloaded: autoReloaded,
    autoReloadCount: isPseudoUnarmed || isNaturalAttack ? 0 : invItem.autoReloadCount,
    isUnarmed: isUnarmed,
    isNaturalAttack: isNaturalAttack,
    rollText: invItem.lastWeaponRollText
  };
};

OS.rollEquippedWeapon = function (invId, slotCategory, optSelectedChambers) {
  var isPseudoUnarmed = invId === "__unarmed__";
  var isNaturalAttack = typeof invId === "string" && invId.indexOf("__natural_") === 0;
  var invItem = isPseudoUnarmed
    ? UNARMED_PSEUDO_WEAPON
    : isNaturalAttack
    ? OS.getNaturalAttackById(invId)
    : OS.inventoryItems.find(function (i) { return i.id === invId; });
  if (!invItem || !invItem.equipped || invItem.group !== "armas") return null;

  if (!isPseudoUnarmed && !isNaturalAttack) {
    ensureWeaponAmmoInitialized(invItem);
  }

  if (OS.ensureFichaChambersReadyForWeaponRoll) {
    OS.ensureFichaChambersReadyForWeaponRoll();
  }

  var cats = isPseudoUnarmed
    ? ["corpo_a_corpo"]
    : isNaturalAttack
    ? [invItem.slotCategory || "corpo_a_corpo"]
    : OS.getEquippedCategories(invItem);
  var resolvedSlot = isPseudoUnarmed
    ? "corpo_a_corpo"
    : slotCategory || (cats.length ? cats[0] : "arma_curta");

  if (Array.isArray(optSelectedChambers)) {
    if (optSelectedChambers.length < 1) {
      return null;
    }
    return OS.executeConfirmedWeaponRoll(invId, resolvedSlot, optSelectedChambers);
  }

  var skillInfo = OS.getCombatSkillInfoForSlot(resolvedSlot);
  var effectiveDice =
    isNaturalAttack && invItem.naturalSkillDie ? [invItem.naturalSkillDie] : skillInfo.dice;
  var danoStr = isPseudoUnarmed
    ? "0 (Desarmado)"
    : String((invItem.attrs && invItem.attrs.dano) || invItem.damageExpr || "d6");

  if (OS.openWeaponChamberSelectionModal) {
    OS.openWeaponChamberSelectionModal(
      invItem,
      resolvedSlot,
      skillInfo.label,
      effectiveDice,
      danoStr
    );
  }
  return null;
};

OS.rollUnarmedAttack = function (optSelectedChambers) {
  return OS.rollEquippedWeapon("__unarmed__", "corpo_a_corpo", optSelectedChambers);
};

/* ─── renderização dos itens equipados na aba Ficha ──────────── */

OS.renderFichaEquippedItems = function () {
  var containers = {
    arma_curta: document.getElementById("ficha-equip-arma-curta"),
    arma_longa: document.getElementById("ficha-equip-arma-longa"),
    corpo_a_corpo: document.getElementById("ficha-equip-corpo-a-corpo"),
    vestuario: document.getElementById("ficha-equip-vestuario")
  };

  var naturalAttacks =
    !Array.isArray(OS.inventoryItems) || OS.inventoryItems.length === 0
      ? OS.parseEquipmentAttackLines()
      : [];

  Object.keys(containers).forEach(function (catKey) {
    var container = containers[catKey];
    if (!container) return;

    var itemsInCat = OS.inventoryItems.filter(function (invItem) {
      if (!invItem || !invItem.equipped) return false;
      var cats = OS.getEquippedCategories(invItem);
      return cats.indexOf(catKey) >= 0;
    });

    if (naturalAttacks.length && catKey !== "vestuario") {
      naturalAttacks.forEach(function (nat) {
        if (nat.slotCategory === catKey) {
          itemsInCat.push(nat);
        }
      });
    }

    if (!itemsInCat.length && catKey !== "corpo_a_corpo") {
      container.innerHTML = '<p class="inv-empty ficha-equip-empty">Nenhum item equipado.</p>';
      return;
    }

    container.innerHTML = "";

    if (catKey === "corpo_a_corpo") {
      var unarmedRow = document.createElement("div");
      unarmedRow.className = "inv-item-row inv-item-equipped ficha-equip-row ficha-weapon-clickable ficha-unarmed-row";
      unarmedRow.id = "ficha-unarmed-attack-row";
      unarmedRow.dataset.invId = "__unarmed__";
      unarmedRow.dataset.equipCategory = "corpo_a_corpo";
      unarmedRow.title = "Clique para rolar Ataque Desarmado (Perícia Corpo a corpo + 6B)";

      var unarmedBtn = document.createElement("button");
      unarmedBtn.type = "button";
      unarmedBtn.className = "inv-item-name-btn ficha-equip-name-btn ficha-weapon-roll-trigger";
      unarmedBtn.dataset.unarmed = "true";
      unarmedBtn.textContent = "Ataque Desarmado";
      unarmedBtn.title = unarmedRow.title;
      unarmedBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        OS.rollUnarmedAttack();
      });
      unarmedRow.addEventListener("click", function () {
        OS.rollUnarmedAttack();
      });
      unarmedRow.appendChild(unarmedBtn);

      var unarmedRollTxt =
        UNARMED_PSEUDO_WEAPON.lastMeleeRollText ||
        UNARMED_PSEUDO_WEAPON.lastWeaponRollText ||
        "";
      var unarmedResSpan = document.createElement("span");
      unarmedResSpan.className = "weapon-roll-result" + (unarmedRollTxt ? " rolled" : "");
      unarmedResSpan.id = "ficha-unarmed-roll-result";
      unarmedResSpan.dataset.invId = "__unarmed__";
      unarmedResSpan.dataset.rollKey = "weapon-__unarmed__";
      unarmedResSpan.textContent = unarmedRollTxt;
      if (!unarmedRollTxt) {
        unarmedResSpan.hidden = true;
        unarmedResSpan.setAttribute("hidden", "");
      }
      unarmedRow.appendChild(unarmedResSpan);

      container.appendChild(unarmedRow);
    }
    itemsInCat.forEach(function (invItem) {
      var isNatural = !!invItem.isNaturalAttack;
      if (invItem.group === "armas" && !isNatural) {
        ensureWeaponAmmoInitialized(invItem);
      }

      var isWeapon = invItem.group === "armas";
      var row = document.createElement("div");
      row.className =
        "inv-item-row inv-item-equipped ficha-equip-row" +
        (isWeapon ? " ficha-weapon-clickable" : "") +
        (isNatural ? " ficha-natural-attack-row" : "");
      row.dataset.invId = invItem.id;
      row.dataset.itemId = invItem.id;
      row.dataset.equipCategory = catKey;

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className =
        "inv-item-name-btn ficha-equip-name-btn" +
        (isWeapon ? " ficha-weapon-roll-trigger" : "");
      var nameText = isNatural
        ? (invItem.rawLine || ("⚙ " + invItem.name))
        : invItem.name + (invItem.qty > 1 ? " (x" + invItem.qty + ")" : "");
      nameBtn.textContent = nameText;

      if (isWeapon) {
        var weaponDano = (invItem.attrs && invItem.attrs.dano) || invItem.damageExpr || "d6";
        var rollTitle = "Clique para rolar " + invItem.name + " (Perícia + Dano " + weaponDano + " + 6B)";
        nameBtn.title = rollTitle;
        row.title = rollTitle;
        nameBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          OS.rollEquippedWeapon(invItem.id, catKey);
        });
        row.addEventListener("click", function (e) {
          if (e.target && e.target.closest && e.target.closest(".ficha-unequip-btn")) return;
          OS.rollEquippedWeapon(invItem.id, catKey);
        });
      } else {
        nameBtn.title = "Clique para desequipar " + invItem.name;
        nameBtn.addEventListener("click", function () {
          toggleEquip(invItem.id);
        });
      }
      row.appendChild(nameBtn);

      if (isWeapon) {
        // No bloco de armas corpo a corpo (ou ataque natural) NÃO exibe munição; apenas em arma_curta e arma_longa
        if (catKey !== "corpo_a_corpo" && !isNatural) {
          var ammoSpan = document.createElement("span");
          ammoSpan.className = "weapon-ammo-tracker";
          ammoSpan.dataset.invId = invItem.id;
          ammoSpan.dataset.ammoCurrent = String(invItem.ammoCurrent);
          ammoSpan.dataset.ammoMax = String(invItem.ammoMax);
          ammoSpan.textContent =
            "Munição: " +
            invItem.ammoCurrent +
            "/" +
            invItem.ammoMax +
            (invItem._justReloaded ? " (Recarregado!)" : "");
          row.appendChild(ammoSpan);
        }

        var itemRollTxt =
          catKey === "corpo_a_corpo"
            ? (invItem.lastMeleeRollText || invItem.lastWeaponRollText || "")
            : (invItem.lastRangedRollText || invItem.lastWeaponRollText || "");
        var resSpan = document.createElement("span");
        resSpan.className = "weapon-roll-result" + (itemRollTxt ? " rolled" : "");
        resSpan.dataset.invId = invItem.id;
        resSpan.dataset.equipCategory = catKey;
        if (isNatural && invItem.naturalKey) {
          resSpan.dataset.rollKey = invItem.naturalKey;
        }
        resSpan.textContent = itemRollTxt;
        if (!itemRollTxt) {
          resSpan.hidden = true;
          resSpan.setAttribute("hidden", "");
        }
        row.appendChild(resSpan);
      } else if (invItem.group === "vestuario") {
        var protVal = OS.getVestuarioProtectionValue(invItem);
        var protSpan = document.createElement("span");
        protSpan.className = "vestuario-prot-badge";
        protSpan.dataset.protVal = String(protVal);
        protSpan.textContent = "Proteção: +" + protVal;
        row.appendChild(protSpan);
      }

      if (isNatural) {
        var natRollBtn = document.createElement("button");
        natRollBtn.type = "button";
        natRollBtn.className = "btn btn-secondary btn-small weapon-roll-btn";
        natRollBtn.dataset.invId = invItem.id;
        natRollBtn.textContent = "🎲 Rolar";
        natRollBtn.title = "Rolar " + invItem.name;
        natRollBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          OS.rollEquippedWeapon(invItem.id, catKey);
        });
        row.appendChild(natRollBtn);
      } else {
        var unequipBtn = document.createElement("button");
        unequipBtn.type = "button";
        unequipBtn.className = "inv-item-del-btn ficha-unequip-btn";
        unequipBtn.title = "Desequipar " + invItem.name;
        unequipBtn.setAttribute("aria-label", "Desequipar " + invItem.name);
        unequipBtn.textContent = "✕";
        unequipBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleEquip(invItem.id);
        });
        row.appendChild(unequipBtn);
      }

      container.appendChild(row);
    });
  });

  // Atualiza o total de proteção no bloco PROTEÇÃO e no campo #protecao
  var totalProt = OS.getTotalProtection();
  var totalEl = document.getElementById("protecao-total-value");
  if (totalEl) {
    totalEl.textContent = String(totalProt);
  }
  var protInput = document.getElementById("protecao");
  if (protInput) {
    protInput.value = String(totalProt);
  }
};

/* ─── API central de Volumes, Mochila, Montaria e Carga Solta ─ */

OS.roundVolume = roundVolume;
OS.formatVolume = formatVolume;
OS.isAnimalItem = isAnimalItem;
OS.isHorseItem = isHorseItem;
OS.getMountSlotType = getMountSlotType;
OS.doesItemCountAsLooseLoad = doesItemCountAsLooseLoad;

OS.getItemVolumeInfo = function (item) {
  return getItemVolumeInfo(item, findCatalogItemByName);
};

OS.getItemVolume = function (item) {
  return getItemVolume(item, findCatalogItemByName);
};

OS.countOwnedHorses = function () {
  var total = 0;
  (OS.inventoryItems || []).forEach(function (it) {
    if (it && isHorseItem(it)) {
      total += Math.max(1, parseInt(it.qty, 10) || 1);
    }
  });
  return total;
};

OS.hasActiveHorse = function () {
  return OS.countOwnedHorses() > 0;
};

OS.getEquippedMountItem = function (slotType) {
  if (!OS.hasActiveHorse()) return null;
  var list = OS.inventoryItems || [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (it && it.equipped && getMountSlotType(it) === slotType) {
      return it;
    }
  }
  return null;
};

OS.getEquippedSaddlebag = function () {
  return OS.getEquippedMountItem("alforge");
};

OS.getEquippedSaddlebagCapacity = function () {
  var bag = OS.getEquippedSaddlebag();
  return bag ? getContainerCapacityFromItem(bag) : 0;
};

OS.getBackpackCapacity = function () {
  var owned = (OS.inventoryItems || []).find(function (it) {
    return it && normalizeItemKey(it.name) === "mochila";
  });
  if (owned) {
    var ownedCap = getContainerCapacityFromItem(owned);
    if (ownedCap > 0) return ownedCap;
  }
  var found = findCatalogItemByName("Mochila");
  if (found && found.item) {
    var catCap = getContainerCapacityFromItem(found.item);
    if (catCap > 0) return catCap;
  }
  return DEFAULT_BACKPACK_CAPACITY;
};

OS.getContainerItems = function (locationKey) {
  var loc = normalizeStorageLocation(locationKey);
  return (OS.inventoryItems || []).filter(function (it) {
    return it && normalizeStorageLocation(it.storageLocation) === loc;
  });
};

OS.getContainerObject = function (containerOrKey) {
  if (containerOrKey && typeof containerOrKey === "object" && !Array.isArray(containerOrKey)) {
    return containerOrKey;
  }
  if (Array.isArray(containerOrKey)) {
    return { label: "Container", capacidade_volumes: 0, items: containerOrKey };
  }
  if (containerOrKey === "mochila") {
    return {
      id: "mochila",
      label: "Mochila",
      capacidade_volumes: OS.getBackpackCapacity(),
      items: OS.getContainerItems("mochila")
    };
  }
  if (containerOrKey === "alforge") {
    var bag = OS.getEquippedSaddlebag();
    return {
      id: "alforge",
      label: bag ? bag.name : "Alforje do Cavalo",
      capacidade_volumes: OS.hasActiveHorse() ? OS.getEquippedSaddlebagCapacity() : 0,
      items: OS.getContainerItems("alforge")
    };
  }
  return {
    id: "solto",
    label: "Inventário",
    capacidade_volumes: Infinity,
    items: OS.getContainerItems("solto")
  };
};

OS.volumeOcupado = function (containerOrKey) {
  return volumeOcupado(OS.getContainerObject(containerOrKey), findCatalogItemByName);
};

OS.volumeLivre = function (containerOrKey) {
  return volumeLivre(OS.getContainerObject(containerOrKey), findCatalogItemByName);
};

OS.podeReceberItem = function (containerOrKey, item, qtyOverride) {
  return podeReceberItem(
    OS.getContainerObject(containerOrKey),
    item,
    qtyOverride,
    findCatalogItemByName
  );
};

OS.describeCapacityBlock = function (containerOrKey, item, qtyOverride) {
  return describeCapacityBlock(
    OS.getContainerObject(containerOrKey),
    item,
    qtyOverride,
    findCatalogItemByName
  );
};

OS.getAtletismoPoints = function () {
  return getAtletismoLevel();
};

OS.getLooseLoadCapacity = function () {
  var ieData = OS.getGameData ? OS.getGameData("itens_e_equipamentos") : null;
  var rc = (ieData && ieData.regras_de_carga) || {};
  var base = typeof rc.capacidade_base_itens === "number" ? rc.capacidade_base_itens : 2;
  var bonus =
    rc.bonus_por_ponto_de_atletismo &&
    typeof rc.bonus_por_ponto_de_atletismo.itens_adicionais_por_ponto === "number"
      ? rc.bonus_por_ponto_de_atletismo.itens_adicionais_por_ponto
      : 2;
  return calculateLooseLoadCapacity(OS.getAtletismoPoints(), base, bonus);
};

OS.getLooseLoadCount = function () {
  return countLooseLoadItems(OS.inventoryItems);
};

OS.getOverloadPenalties = function () {
  var ieData = OS.getGameData ? OS.getGameData("itens_e_equipamentos") : null;
  var rules = (ieData && ieData.regras_de_carga && ieData.regras_de_carga.efeito_de_sobrecarga) || {};
  return evaluateOverloadState(OS.getLooseLoadCount(), OS.getLooseLoadCapacity(), rules);
};

OS.isCharacterOverloaded = function () {
  return OS.getOverloadPenalties().overloaded;
};

var storageFeedbackTimer = null;
OS.showStorageFeedback = function (msg, isError) {
  var fb = document.getElementById("inv-storage-feedback");
  if (fb) {
    fb.textContent = msg || "";
    fb.classList.toggle("is-error", !!isError);
  }
  var transferHint = document.getElementById("transfer-modal-hint");
  var transferOverlay = document.getElementById("transfer-storage-modal");
  if (transferHint && transferOverlay && transferOverlay.classList.contains("open")) {
    transferHint.textContent = msg || "";
    transferHint.classList.toggle("catalog-error", !!isError);
  }
  if (storageFeedbackTimer) clearTimeout(storageFeedbackTimer);
  if (msg && !isError) {
    storageFeedbackTimer = setTimeout(function () {
      if (fb && fb.textContent === msg) fb.textContent = "";
      if (transferHint && transferHint.textContent === msg) transferHint.textContent = "";
    }, 3000);
  }
};

/* ─── barras de capacidade e renderização dos containers ────── */

OS.updateStorageStatusBars = function () {
  var ov = OS.getOverloadPenalties();
  var bpCap = OS.getBackpackCapacity();
  var bpUsed = OS.volumeOcupado("mochila");
  var bpFree = Math.max(0, OS.volumeLivre("mochila"));

  var hasHorse = OS.hasActiveHorse();
  var eqBag = OS.getEquippedSaddlebag();
  var bagCap = hasHorse ? OS.getEquippedSaddlebagCapacity() : 0;
  var bagUsed = OS.volumeOcupado("alforge");
  var bagFree = Math.max(0, OS.volumeLivre("alforge"));

  var looseEl = document.getElementById("inv-loose-load-display");
  if (looseEl) {
    looseEl.textContent = ov.looseCount + " / " + ov.capacity + " itens";
    looseEl.classList.toggle("over-limit", !!ov.overloaded);
  }

  var invOvAlert = document.getElementById("inv-overload-alert");
  if (invOvAlert) {
    if (ov.overloaded) {
      invOvAlert.textContent =
        "Sobrecarregado (" +
        ov.looseCount +
        "/" +
        ov.capacity +
        " itens soltos): -" +
        ov.defensePenalty +
        " na Defesa, -" +
        ov.bonusActionsLost +
        " ações bônus de Iniciativa e -" +
        ov.movementPenaltyMeters +
        "m de movimento por ação.";
      invOvAlert.removeAttribute("hidden");
    } else {
      invOvAlert.textContent = "";
      invOvAlert.setAttribute("hidden", "");
    }
  }

  var bpText = formatVolume(bpUsed) + " / " + formatVolume(bpCap) + " volumes";
  var topBpEl = document.getElementById("inv-backpack-vol-display");
  if (topBpEl) {
    topBpEl.textContent = bpText;
    topBpEl.classList.toggle("over-limit", bpUsed > bpCap);
  }
  var barBpEl = document.getElementById("mochila-bar-display");
  if (barBpEl) {
    barBpEl.textContent = bpText;
    barBpEl.classList.toggle("over-limit", bpUsed > bpCap);
  }
  var freeBpEl = document.getElementById("mochila-free-display");
  if (freeBpEl) {
    freeBpEl.textContent = formatVolume(bpFree) + " volumes";
  }

  var topBagEl = document.getElementById("inv-saddlebag-vol-display");
  if (topBagEl) {
    if (!hasHorse) {
      topBagEl.textContent = "Sem cavalo";
      topBagEl.classList.remove("over-limit");
    } else if (!eqBag) {
      topBagEl.textContent = "Sem alforje";
      topBagEl.classList.remove("over-limit");
    } else {
      topBagEl.textContent = formatVolume(bagUsed) + " / " + formatVolume(bagCap) + " volumes";
      topBagEl.classList.toggle("over-limit", bagUsed > bagCap);
    }
  }

  var barBagEl = document.getElementById("alforge-bar-display");
  if (barBagEl) {
    barBagEl.textContent = formatVolume(bagUsed) + " / " + formatVolume(bagCap) + " volumes";
    barBagEl.classList.toggle("over-limit", bagUsed > bagCap);
  }
  var freeBagEl = document.getElementById("alforge-free-display");
  if (freeBagEl) {
    freeBagEl.textContent = formatVolume(bagFree) + " volumes";
  }

  var canTransfer = !!(hasHorse && eqBag && bagCap > 0);
  var btnTransferTop = document.getElementById("btn-open-transfer-modal");
  if (btnTransferTop) btnTransferTop.disabled = !canTransfer;
  var btnTransferMount = document.getElementById("btn-montaria-transfer");
  if (btnTransferMount) btnTransferMount.disabled = !canTransfer;

  var trMochilaVol = document.getElementById("transfer-mochila-vol");
  if (trMochilaVol) trMochilaVol.textContent = bpText;
  var trAlforgeVol = document.getElementById("transfer-alforge-vol");
  if (trAlforgeVol) {
    trAlforgeVol.textContent = eqBag
      ? formatVolume(bagUsed) + " / " + formatVolume(bagCap) + " volumes"
      : "Sem alforje equipado";
  }
  var trAlforgeTitle = document.getElementById("transfer-alforge-title");
  if (trAlforgeTitle) {
    trAlforgeTitle.textContent = eqBag ? eqBag.name : "Alforje do Cavalo";
  }
};

function buildVolumeBadge(invItem) {
  var badge = document.createElement("span");
  var info = OS.getItemVolumeInfo(invItem);
  if (info.isExempt) {
    badge.className = "inv-vol-badge inv-vol-exempt";
    badge.textContent = "Companheiro / Montaria";
    return badge;
  }
  var qty = Math.max(1, parseInt(invItem.qty, 10) || 1);
  var totalVol = roundVolume(info.volume * qty);
  badge.className = "inv-vol-badge" + (info.isFallback ? " inv-vol-fallback" : "");
  badge.dataset.unitVolume = String(info.volume);
  badge.dataset.totalVolume = String(totalVol);
  badge.dataset.isFallback = info.isFallback ? "1" : "0";
  badge.textContent =
    "Vol: " + formatVolume(totalVol) + (info.isFallback ? " (padrão)" : "");
  return badge;
}

function buildQtySelectorIfStack(invItem) {
  if (!invItem || invItem.qty <= 1 || isAnimalItem(invItem)) return null;
  var inp = document.createElement("input");
  inp.type = "number";
  inp.className = "inv-transfer-qty-input";
  inp.min = "1";
  inp.max = String(invItem.qty);
  inp.step = "1";
  inp.value = String(invItem.qty);
  inp.title = "Quantidade a mover (1 a " + invItem.qty + ")";
  inp.setAttribute("aria-label", "Quantidade de " + invItem.name + " para mover");
  inp.addEventListener("click", function (e) {
    e.stopPropagation();
  });
  return inp;
}

function readRowMoveQty(qtyInput, invItem) {
  var maxQ = Math.max(1, parseInt(invItem.qty, 10) || 1);
  if (!qtyInput) return maxQ;
  var val = parseInt(qtyInput.value, 10);
  if (isNaN(val) || val < 1) return 1;
  return Math.min(maxQ, val);
}

function getInvContainer() {
  return document.getElementById("inv-item-list");
}

function isUpgradableItem(invItem) {
  if (!invItem || isAnimalItem(invItem)) return false;
  var g = String(invItem.group || "").toLowerCase();
  if (g === "armas" || g === "equipamentos" || g === "vestuario" || g === "itens" || g === "criados") {
    return true;
  }
  return invItem.attrs && Object.keys(invItem.attrs).length > 0;
}
OS.isItemUpgradable = isUpgradableItem;

OS.renderBackpackPanel = function () {
  var listEl = document.getElementById("mochila-item-list");
  if (!listEl) return;
  var items = OS.getContainerItems("mochila");
  if (!items.length) {
    listEl.innerHTML = '<p class="inv-empty">Mochila vazia.</p>';
    return;
  }
  listEl.innerHTML = "";
  var canSendToAlforge = !!(OS.hasActiveHorse() && OS.getEquippedSaddlebag());

  items.forEach(function (invItem) {
    var row = document.createElement("div");
    row.className = "inv-item-row";
    row.dataset.invId = invItem.id;
    row.dataset.storageLocation = "mochila";

    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "inv-item-name-btn";
    nameBtn.textContent = invItem.name + (invItem.qty > 1 ? " (x" + invItem.qty + ")" : "");
    nameBtn.title = "Ver detalhes";
    nameBtn.addEventListener("click", function () {
      openInvDetailModal(invItem.id);
    });
    row.appendChild(nameBtn);

    if (invItem.upgraded) {
      var upgBadge = document.createElement("span");
      upgBadge.className = "inv-upgraded-badge";
      upgBadge.textContent = "Aprimorado";
      row.appendChild(upgBadge);
    }

    row.appendChild(buildVolumeBadge(invItem));
    var qtyInput = buildQtySelectorIfStack(invItem);
    if (qtyInput) row.appendChild(qtyInput);

    if (canSendToAlforge) {
      var toBagBtn = document.createElement("button");
      toBagBtn.type = "button";
      toBagBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-move-to-alforge";
      toBagBtn.dataset.invId = invItem.id;
      toBagBtn.textContent = "→ Alforje";
      toBagBtn.title = "Transferir para o Alforje do Cavalo";
      toBagBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        OS.moveInventoryItem(invItem.id, "alforge", readRowMoveQty(qtyInput, invItem));
      });
      row.appendChild(toBagBtn);
    }

    var outBtn = document.createElement("button");
    outBtn.type = "button";
    outBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-remove-from-mochila";
    outBtn.dataset.invId = invItem.id;
    outBtn.textContent = "Retirar";
    outBtn.title = "Retirar da mochila para o inventário solto";
    outBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      OS.moveInventoryItem(invItem.id, "solto", readRowMoveQty(qtyInput, invItem));
    });
    row.appendChild(outBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "inv-item-del-btn";
    delBtn.title = "Excluir item";
    delBtn.setAttribute("aria-label", "Remover " + invItem.name);
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", function () {
      removeInventoryItem(invItem.id);
    });
    row.appendChild(delBtn);

    listEl.appendChild(row);
  });
};

OS.renderMountPanel = function () {
  var lockedMsg = document.getElementById("montaria-locked-msg");
  var activePanel = document.getElementById("montaria-active-panel");
  if (!lockedMsg || !activePanel) return;

  var horseCount = OS.countOwnedHorses();
  if (horseCount <= 0) {
    lockedMsg.removeAttribute("hidden");
    activePanel.setAttribute("hidden", "");
    return;
  }

  lockedMsg.setAttribute("hidden", "");
  activePanel.removeAttribute("hidden");

  var horseNameEl = document.getElementById("montaria-horse-name");
  if (horseNameEl) {
    horseNameEl.textContent = horseCount > 1 ? "Cavalo (x" + horseCount + ")" : "Cavalo";
  }

  var eqSela = OS.getEquippedMountItem("sela");
  var eqAlforge = OS.getEquippedSaddlebag();
  var eqBarda = OS.getEquippedMountItem("barda");

  var selaEl = document.getElementById("montaria-slot-sela");
  if (selaEl) selaEl.textContent = eqSela ? eqSela.name : "Nenhuma";

  var alforgeSlotEl = document.getElementById("montaria-slot-alforge");
  if (alforgeSlotEl) {
    alforgeSlotEl.textContent = eqAlforge
      ? eqAlforge.name + " (" + formatVolume(getContainerCapacityFromItem(eqAlforge)) + " vol.)"
      : "Nenhum";
  }

  var bardaEl = document.getElementById("montaria-slot-barda");
  if (bardaEl) bardaEl.textContent = eqBarda ? eqBarda.name : "Nenhuma";

  // Lista de equipamentos de montaria possuídos para equipar/desequipar no cavalo
  var gearListEl = document.getElementById("montaria-gear-list");
  if (gearListEl) {
    var mountGear = (OS.inventoryItems || []).filter(function (it) {
      return it && getMountSlotType(it) !== null;
    });
    if (!mountGear.length) {
      gearListEl.innerHTML =
        '<p class="inv-empty">Nenhum equipamento de montaria (Sela, Alforjes ou Barda) no inventário.</p>';
    } else {
      gearListEl.innerHTML = "";
      mountGear.forEach(function (gear) {
        var slotType = getMountSlotType(gear);
        var slotLabel = slotType === "sela" ? "Sela" : slotType === "alforge" ? "Alforje" : "Barda";
        var row = document.createElement("div");
        row.className = "inv-item-row" + (gear.equipped ? " inv-item-equipped" : "");
        row.dataset.invId = gear.id;
        row.dataset.mountSlot = slotType;

        var nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "inv-item-name-btn";
        var cap = slotType === "alforge" ? getContainerCapacityFromItem(gear) : 0;
        var labelTxt =
          "[" +
          slotLabel +
          "] " +
          gear.name +
          (gear.qty > 1 ? " (x" + gear.qty + ")" : "") +
          (cap > 0 ? " — Cap. " + formatVolume(cap) + " vol." : "");
        nameBtn.textContent = labelTxt;
        nameBtn.addEventListener("click", function () {
          openInvDetailModal(gear.id);
        });
        row.appendChild(nameBtn);

        if (gear.equipped) {
          var eqBadge = document.createElement("span");
          eqBadge.className = "inv-equipped-badge";
          eqBadge.textContent = "No Cavalo";
          row.appendChild(eqBadge);
        }

        var eqBtn = document.createElement("button");
        eqBtn.type = "button";
        eqBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-mount-equip";
        eqBtn.dataset.invId = gear.id;
        eqBtn.textContent = gear.equipped ? "Desequipar" : "Equipar no Cavalo";
        eqBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleEquip(gear.id);
        });
        row.appendChild(eqBtn);

        gearListEl.appendChild(row);
      });
    }
  }

  // Container de inventário do Alforje equipado
  var alforgePanel = document.getElementById("alforge-container-panel");
  var alforgeListEl = document.getElementById("alforge-item-list");
  if (!alforgePanel || !alforgeListEl) return;

  if (!eqAlforge) {
    alforgePanel.setAttribute("hidden", "");
    return;
  }

  alforgePanel.removeAttribute("hidden");
  var bagItems = OS.getContainerItems("alforge");
  if (!bagItems.length) {
    alforgeListEl.innerHTML = '<p class="inv-empty">Alforje vazio.</p>';
    return;
  }

  alforgeListEl.innerHTML = "";
  bagItems.forEach(function (invItem) {
    var row = document.createElement("div");
    row.className = "inv-item-row";
    row.dataset.invId = invItem.id;
    row.dataset.storageLocation = "alforge";

    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "inv-item-name-btn";
    nameBtn.textContent = invItem.name + (invItem.qty > 1 ? " (x" + invItem.qty + ")" : "");
    nameBtn.title = "Ver detalhes";
    nameBtn.addEventListener("click", function () {
      openInvDetailModal(invItem.id);
    });
    row.appendChild(nameBtn);

    row.appendChild(buildVolumeBadge(invItem));
    var qtyInput = buildQtySelectorIfStack(invItem);
    if (qtyInput) row.appendChild(qtyInput);

    var toBpBtn = document.createElement("button");
    toBpBtn.type = "button";
    toBpBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-move-to-mochila";
    toBpBtn.dataset.invId = invItem.id;
    toBpBtn.textContent = "→ Mochila";
    toBpBtn.title = "Transferir para a Mochila";
    toBpBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      OS.moveInventoryItem(invItem.id, "mochila", readRowMoveQty(qtyInput, invItem));
    });
    row.appendChild(toBpBtn);

    var outBtn = document.createElement("button");
    outBtn.type = "button";
    outBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-remove-from-alforge";
    outBtn.dataset.invId = invItem.id;
    outBtn.textContent = "Retirar";
    outBtn.title = "Retirar do alforje para o inventário solto";
    outBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      OS.moveInventoryItem(invItem.id, "solto", readRowMoveQty(qtyInput, invItem));
    });
    row.appendChild(outBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "inv-item-del-btn";
    delBtn.title = "Excluir item";
    delBtn.setAttribute("aria-label", "Remover " + invItem.name);
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", function () {
      removeInventoryItem(invItem.id);
    });
    row.appendChild(delBtn);

    alforgeListEl.appendChild(row);
  });
};

OS.renderTransferModal = function () {
  var leftList = document.getElementById("transfer-mochila-list");
  var rightList = document.getElementById("transfer-alforge-list");
  if (!leftList || !rightList) return;

  OS.updateStorageStatusBars();

  function renderSide(listEl, items, targetLocation, actionLabel, emptyMsg) {
    if (!items.length) {
      listEl.innerHTML = '<p class="inv-empty">' + emptyMsg + "</p>";
      return;
    }
    listEl.innerHTML = "";
    items.forEach(function (invItem) {
      if (isAnimalItem(invItem)) return;
      var row = document.createElement("div");
      row.className = "inv-item-row";
      row.dataset.invId = invItem.id;

      var qtyInput = buildQtySelectorIfStack(invItem);

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "inv-item-name-btn";
      nameBtn.textContent = invItem.name + (invItem.qty > 1 ? " (x" + invItem.qty + ")" : "");
      nameBtn.title = "Clique para transferir " + invItem.name;
      nameBtn.addEventListener("click", function () {
        OS.moveInventoryItem(invItem.id, targetLocation, readRowMoveQty(qtyInput, invItem));
      });
      row.appendChild(nameBtn);

      row.appendChild(buildVolumeBadge(invItem));
      if (qtyInput) row.appendChild(qtyInput);

      var moveBtn = document.createElement("button");
      moveBtn.type = "button";
      moveBtn.className = "btn btn-secondary btn-small inv-row-action-btn";
      moveBtn.dataset.invId = invItem.id;
      moveBtn.textContent = actionLabel;
      moveBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        OS.moveInventoryItem(invItem.id, targetLocation, readRowMoveQty(qtyInput, invItem));
      });
      row.appendChild(moveBtn);

      listEl.appendChild(row);
    });
  }

  renderSide(
    leftList,
    OS.getContainerItems("mochila"),
    "alforge",
    "→ Alforje",
    "Nenhum item na mochila."
  );
  renderSide(
    rightList,
    OS.getContainerItems("alforge"),
    "mochila",
    "← Mochila",
    "Nenhum item no alforje."
  );
};

OS.openTransferModal = function () {
  if (!OS.hasActiveHorse() || !OS.getEquippedSaddlebag()) {
    OS.showStorageFeedback(
      "É necessário possuir um Cavalo com um Alforje equipado para abrir a transferência.",
      true
    );
    return false;
  }
  var overlay = document.getElementById("transfer-storage-modal");
  if (!overlay) return false;
  var hint = document.getElementById("transfer-modal-hint");
  if (hint) {
    hint.textContent = "";
    hint.classList.remove("catalog-error");
  }
  OS.renderTransferModal();
  overlay.classList.add("open");
  overlay.removeAttribute("hidden");
  return true;
};

OS.closeTransferModal = function () {
  var overlay = document.getElementById("transfer-storage-modal");
  if (overlay) overlay.classList.remove("open");
};

OS.renderInventory = function () {
  var container = getInvContainer();
  var looseItems = OS.getContainerItems("solto");
  var canSendToAlforge = !!(OS.hasActiveHorse() && OS.getEquippedSaddlebag());

  if (container) {
    if (!looseItems.length) {
      container.innerHTML = "<p class=\"inv-empty\">Nenhum item solto no inventário.</p>";
    } else {
      container.innerHTML = "";
      looseItems.forEach(function (invItem) {
        var row = document.createElement("div");
        row.className = "inv-item-row" + (invItem.equipped ? " inv-item-equipped" : "");
        row.dataset.invId = invItem.id;
        row.dataset.storageLocation = "solto";

        var nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "inv-item-name-btn";
        var nameText = invItem.name;
        if (invItem.qty > 1) nameText += " (x" + invItem.qty + ")";
        nameBtn.textContent = nameText;
        nameBtn.title = invItem.equipped ? "Equipado — ver detalhes" : "Ver detalhes";
        nameBtn.addEventListener("click", function () {
          openInvDetailModal(invItem.id);
        });
        row.appendChild(nameBtn);

        if (invItem.upgraded) {
          var upgBadge = document.createElement("span");
          upgBadge.className = "inv-upgraded-badge";
          upgBadge.textContent = "Aprimorado";
          row.appendChild(upgBadge);
        }

        if (invItem.equipped) {
          var eqBadge = document.createElement("span");
          eqBadge.className = "inv-equipped-badge";
          eqBadge.textContent = getMountSlotType(invItem) ? "No Cavalo" : "Equipado";
          row.appendChild(eqBadge);
        }

        row.appendChild(buildVolumeBadge(invItem));

        var isAnimal = isAnimalItem(invItem);
        var mountSlot = getMountSlotType(invItem);
        var isEquippedAlforge = mountSlot === "alforge" && invItem.equipped;
        var qtyInput = !isAnimal && !isEquippedAlforge ? buildQtySelectorIfStack(invItem) : null;
        if (qtyInput) row.appendChild(qtyInput);

        // Itens de animais.json NUNCA exibem opção de guardar na mochila ou transferir pro alforje
        if (!isAnimal && !isEquippedAlforge) {
          var storeBpBtn = document.createElement("button");
          storeBpBtn.type = "button";
          storeBpBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-store-mochila";
          storeBpBtn.dataset.invId = invItem.id;
          storeBpBtn.textContent = "→ Mochila";
          storeBpBtn.title = "Guardar na Mochila";
          storeBpBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            OS.moveInventoryItem(invItem.id, "mochila", readRowMoveQty(qtyInput, invItem));
          });
          row.appendChild(storeBpBtn);

          if (canSendToAlforge) {
            var storeBagBtn = document.createElement("button");
            storeBagBtn.type = "button";
            storeBagBtn.className = "btn btn-secondary btn-small inv-row-action-btn btn-store-alforge";
            storeBagBtn.dataset.invId = invItem.id;
            storeBagBtn.textContent = "→ Alforje";
            storeBagBtn.title = "Guardar no Alforje do Cavalo";
            storeBagBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              OS.moveInventoryItem(invItem.id, "alforge", readRowMoveQty(qtyInput, invItem));
            });
            row.appendChild(storeBagBtn);
          }
        }

        if (isUpgradableItem(invItem)) {
          var upgBtn = document.createElement("button");
          upgBtn.type = "button";
          upgBtn.className = "btn btn-secondary btn-small btn-inv-upgrade";
          upgBtn.dataset.invId = invItem.id;
          upgBtn.textContent = "Aprimorar";
          upgBtn.title = "Aprimorar atributos de " + invItem.name;
          upgBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            OS.openUpgradeItemModal(invItem.id);
          });
          row.appendChild(upgBtn);
        }

        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "inv-item-del-btn";
        delBtn.title = "Remover item";
        delBtn.setAttribute("aria-label", "Remover " + invItem.name);
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", function () {
          removeInventoryItem(invItem.id);
        });
        row.appendChild(delBtn);

        container.appendChild(row);
      });
    }
  }

  OS.renderBackpackPanel();
  OS.renderMountPanel();
  OS.renderFichaEquippedItems();
  OS.updateStorageStatusBars();

  var transferOverlay = document.getElementById("transfer-storage-modal");
  if (transferOverlay && transferOverlay.classList.contains("open")) {
    OS.renderTransferModal();
  }

  if (OS.updateStatsFields) {
    OS.updateStatsFields(false);
  }
};

/* ─── mover item entre solto / mochila / alforje ─────────────── */

OS.moveInventoryItem = function (invId, targetLocation, moveQty) {
  var invItem = (OS.inventoryItems || []).find(function (i) { return i && i.id === invId; });
  if (!invItem) return { ok: false, error: "Item não encontrado." };

  var destLoc = normalizeStorageLocation(targetLocation);
  var srcLoc = normalizeStorageLocation(invItem.storageLocation);
  if (srcLoc === destLoc) {
    return { ok: true, item: invItem, movedQty: 0 };
  }

  if (isAnimalItem(invItem) && destLoc !== "solto") {
    var animalMsg = "Animais e montarias não podem ser guardados na mochila ou no alforje.";
    OS.showStorageFeedback(animalMsg, true);
    return { ok: false, error: animalMsg };
  }

  if (getMountSlotType(invItem) === "alforge" && invItem.equipped && destLoc !== "solto") {
    var eqBagMsg = "Desequipe o alforje vazio do cavalo antes de guardá-lo.";
    OS.showStorageFeedback(eqBagMsg, true);
    return { ok: false, error: eqBagMsg };
  }

  var totalQty = Math.max(1, parseInt(invItem.qty, 10) || 1);
  var qtyToMove =
    moveQty !== undefined && moveQty !== null
      ? Math.max(1, Math.min(totalQty, parseInt(moveQty, 10) || totalQty))
      : totalQty;

  if (destLoc === "alforge") {
    if (!OS.hasActiveHorse()) {
      var noHorseMsg = "Você precisa possuir um Cavalo no inventário para usar o alforje.";
      OS.showStorageFeedback(noHorseMsg, true);
      return { ok: false, error: noHorseMsg };
    }
    if (!OS.getEquippedSaddlebag()) {
      var noBagMsg = "Equipe um Alforje no Cavalo antes de guardar itens no alforje.";
      OS.showStorageFeedback(noBagMsg, true);
      return { ok: false, error: noBagMsg };
    }
  }

  if (destLoc === "mochila" || destLoc === "alforge") {
    if (!OS.podeReceberItem(destLoc, invItem, qtyToMove)) {
      var blockMsg = OS.describeCapacityBlock(destLoc, invItem, qtyToMove);
      OS.showStorageFeedback(blockMsg, true);
      return { ok: false, error: blockMsg };
    }
  }

  var wasEquipped = !!invItem.equipped;
  var res = transferItemStack(OS.inventoryItems, invId, destLoc, qtyToMove, uid);
  if (!res.ok) {
    OS.showStorageFeedback(res.reason || "Não foi possível mover o item.", true);
    return { ok: false, error: res.reason };
  }

  if (wasEquipped) {
    syncEquipamentosTextarea();
  }
  OS.renderInventory();
  syncInvTextarea();
  OS.scheduleSave();

  var destLabel =
    destLoc === "mochila"
      ? "Mochila"
      : destLoc === "alforge"
      ? "Alforje"
      : "Inventário Solto";
  OS.showStorageFeedback(
    "✓ " + invItem.name + (qtyToMove > 1 ? " (x" + qtyToMove + ")" : "") + " movido para " + destLabel + ".",
    false
  );
  return res;
};

/* ─── adicionar item (chamado pelo catalogModal) ────────────── */

OS.addInventoryItem = function (itemData, qty, group, listId, parentData, targetLocation) {
  if (!itemData) return null;
  qty = Math.max(1, parseInt(qty, 10) || 1);

  var itemName = getItemName(itemData);
  var foundCat = (!group || !listId) ? findCatalogItemByName(itemName) : null;
  var rawGroup = group || itemData.group || itemData.grupo || (foundCat && foundCat.record ? foundCat.record.group : "") || "";
  var normGroup = String(rawGroup).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  var resolvedGroup = normGroup || "";
  var resolvedListId = listId || itemData.listId || (foundCat && foundCat.record ? foundCat.record.id : "") || "";
  var mergedItemData = foundCat && foundCat.item ? Object.assign({}, foundCat.item, itemData) : itemData;

  var destLoc = normalizeStorageLocation(targetLocation);

  var invItem = {
    id: uid(),
    name: itemName,
    qty: qty,
    group: resolvedGroup,
    listId: resolvedListId,
    equipped: false,
    storageLocation: destLoc,
    attrs: collectAttrs(mergedItemData, parentData || (foundCat && foundCat.parent) || null)
  };

  if (isAnimalItem(invItem)) {
    invItem.storageLocation = "solto";
    if (destLoc !== "solto") {
      OS.showStorageFeedback("Animais e montarias ficam no inventário principal (isento de carga).", true);
      return null;
    }
  } else if (destLoc === "mochila" || destLoc === "alforge") {
    if (!OS.podeReceberItem(destLoc, invItem, qty)) {
      var err = OS.describeCapacityBlock(destLoc, invItem, qty);
      OS.showStorageFeedback(err, true);
      return null;
    }
  }

  if (invItem.group === "armas") {
    ensureWeaponAmmoInitialized(invItem);
  }

  OS.inventoryItems.push(invItem);
  OS.renderInventory();
  syncInvTextarea();
  OS.scheduleSave();
  return invItem;
};

/* ─── remover item ───────────────────────────────────────────── */

function removeInventoryItem(id) {
  var target = OS.inventoryItems.find(function (i) { return i.id === id; });
  if (!target) return { ok: false, error: "Item não encontrado." };

  if (isHorseItem(target)) {
    var removedHorses = Math.max(1, parseInt(target.qty, 10) || 1);
    var remainingHorses = OS.countOwnedHorses() - removedHorses;
    var alforgeItems = OS.getContainerItems("alforge");
    if (remainingHorses <= 0 && alforgeItems.length > 0) {
      var horseErr =
        "Não é possível remover o Cavalo enquanto houver itens guardados no alforje (" +
        formatVolume(OS.volumeOcupado("alforge")) +
        " vol. ocupados). Retire os itens do alforje primeiro.";
      OS.showStorageFeedback(horseErr, true);
      return { ok: false, error: horseErr };
    }
    if (remainingHorses <= 0) {
      // Desequipa equipamentos de montaria órfãos quando o último cavalo (com alforje vazio) é removido
      OS.inventoryItems.forEach(function (it) {
        if (it && it.equipped && getMountSlotType(it) !== null) {
          it.equipped = false;
        }
      });
    }
  }

  if (getMountSlotType(target) === "alforge" && target.equipped) {
    if (OS.getContainerItems("alforge").length > 0) {
      var bagDelErr =
        "Não é possível remover " +
        target.name +
        " enquanto houver itens guardados no alforje (" +
        formatVolume(OS.volumeOcupado("alforge")) +
        " vol. ocupados).";
      OS.showStorageFeedback(bagDelErr, true);
      return { ok: false, error: bagDelErr };
    }
  }

  OS.inventoryItems = OS.inventoryItems.filter(function (i) { return i.id !== id; });
  OS.renderInventory();
  syncInvTextarea();
  syncEquipamentosTextarea({ forceRebuild: !OS.freeEdit });
  OS.scheduleSave();
  return { ok: true };
}
OS.removeInventoryItem = removeInventoryItem;

/* ─── texto do inventário (textarea oculto, compatibilidade) ── */

function buildInventoryTextLine(invItem) {
  var parts = [invItem.name + (invItem.qty > 1 ? " (x" + invItem.qty + ")" : "")];
  var attrs = invItem.attrs || {};
  if (!isEmptyVal(attrs.preco)) parts.push(attrLabel("preco") + ": " + attrs.preco);
  var rest = [];
  Object.keys(attrs).forEach(function (k) {
    if (k === "preco" || isEmptyVal(attrs[k])) return;
    rest.push(attrLabel(k) + ": " + attrs[k]);
  });
  if (rest.length) parts.push(rest.join(" | "));
  return parts.join(" — ");
}

function syncInvTextarea() {
  var ta = document.getElementById("inventario");
  if (!ta) return;
  ta.value = OS.inventoryItems.map(buildInventoryTextLine).join("\n");
}

/* ─── migração de fichas antigas (texto livre no #inventario) ─ */

function getRecordItems(record) {
  var data = record && record.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.itens)) return data.itens;
  return [];
}

function findCatalogItemByName(name) {
  var needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;

  var cat = OS.equipCatalog;
  if (cat && cat.loaded && cat.byId) {
    var ids = Object.keys(cat.byId);
    for (var r = 0; r < ids.length; r++) {
      var record = cat.byId[ids[r]];
      var items = getRecordItems(record);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        if (Array.isArray(it.variantes)) {
          for (var v = 0; v < it.variantes.length; v++) {
            var variant = it.variantes[v];
            if (variant && String(variant.nome || "").trim().toLowerCase() === needle) {
              return { record: record, item: variant, parent: it };
            }
          }
        } else if (String(getItemName(it)).trim().toLowerCase() === needle) {
          return { record: record, item: it, parent: null };
        }
      }
    }
  }

  if (Array.isArray(OS.customItems)) {
    for (var c = 0; c < OS.customItems.length; c++) {
      var custom = OS.customItems[c];
      if (custom && String(getItemName(custom)).trim().toLowerCase() === needle) {
        return {
          record: { id: custom.listId || "itens_criados", group: custom.group || "equipamentos" },
          item: custom,
          parent: null
        };
      }
    }
  }

  return null;
}
OS.findCatalogItemByName = findCatalogItemByName;

function parseLegacyLine(line) {
  var segments = line.split(" — ");
  var head = segments.shift().trim();
  var qty = 1;
  var m = head.match(/^(.*?)\s*\(x(\d+)\)$/);
  if (m) {
    head = m[1].trim();
    qty = Math.max(1, parseInt(m[2], 10) || 1);
  }

  var found = findCatalogItemByName(head);
  if (found) {
    var itemObj = {
      id: uid(),
      name: getItemName(found.item),
      qty: qty,
      group: found.record.group || "",
      listId: found.record.id || "",
      equipped: false,
      storageLocation: "solto",
      attrs: collectAttrs(found.item, found.parent)
    };
    if (itemObj.group === "armas") ensureWeaponAmmoInitialized(itemObj);
    return itemObj;
  }

  var reverse = {};
  Object.keys(ATTR_LABELS).forEach(function (k) { reverse[ATTR_LABELS[k].toLowerCase()] = k; });
  var attrs = {};
  var extra = [];
  segments.join(" | ").split(" | ").forEach(function (piece) {
    piece = piece.trim();
    if (!piece) return;
    var sep = piece.indexOf(": ");
    var key = sep > 0 ? reverse[piece.slice(0, sep).trim().toLowerCase()] : null;
    if (key) {
      attrs[key] = piece.slice(sep + 2);
    } else {
      extra.push(piece);
    }
  });
  if (extra.length) {
    attrs.detalhes = (attrs.detalhes ? attrs.detalhes + " | " : "") + extra.join(" | ");
  }
  return {
    id: uid(),
    name: head || line.trim(),
    qty: qty,
    group: "",
    listId: "",
    equipped: false,
    storageLocation: "solto",
    attrs: attrs
  };
}

function migrateLegacyText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  return text
    .split("\n")
    .filter(function (l) { return l.trim(); })
    .map(parseLegacyLine);
}

function normalizeSavedItems(list) {
  var seen = {};
  var out = [];
  list.forEach(function (raw) {
    if (!raw || typeof raw !== "object") return;
    var name = String(raw.name || "").trim();
    if (!name) return;
    var id = raw.id ? String(raw.id) : uid();
    if (seen[id]) id = uid();
    seen[id] = true;
    var loc = normalizeStorageLocation(raw.storageLocation);
    var item = {
      id: id,
      name: name,
      qty: Math.max(1, parseInt(raw.qty, 10) || 1),
      group: String(raw.group || ""),
      listId: String(raw.listId || ""),
      equipped: false,
      storageLocation: loc,
      upgraded: !!raw.upgraded,
      originalAttrs: raw.originalAttrs && typeof raw.originalAttrs === "object" ? Object.assign({}, raw.originalAttrs) : null,
      attrs: raw.attrs && typeof raw.attrs === "object" ? Object.assign({}, raw.attrs) : {}
    };
    if (isAnimalItem(item)) {
      item.storageLocation = "solto";
    }
    item.equipped = !!raw.equipped && isEquippable(item) && item.storageLocation === "solto";
    if (item.group === "armas") {
      var maxAmmo = getWeaponMaxAmmo(item);
      item.ammoMax = typeof raw.ammoMax === "number" && raw.ammoMax > 0 ? raw.ammoMax : maxAmmo;
      item.ammoCurrent =
        typeof raw.ammoCurrent === "number" && raw.ammoCurrent > 0 && raw.ammoCurrent <= item.ammoMax
          ? raw.ammoCurrent
          : item.ammoMax;
      item.autoReloadCount = typeof raw.autoReloadCount === "number" ? raw.autoReloadCount : 0;
      if (typeof raw.lastWeaponRoll === "number") item.lastWeaponRoll = raw.lastWeaponRoll;
      item.lastWeaponRollText = typeof raw.lastWeaponRollText === "string" ? raw.lastWeaponRollText : "";
      item.lastMeleeRollText = typeof raw.lastMeleeRollText === "string" ? raw.lastMeleeRollText : "";
      item.lastRangedRollText = typeof raw.lastRangedRollText === "string" ? raw.lastRangedRollText : "";
    }
    out.push(item);
  });
  return out;
}

/* ─── modal de detalhes do item no inventário ───────────────── */

var detailModal = null;
var detailModalOverlay = null;
var detailItemId = null;

function buildDetailModal() {
  if (detailModal) return;

  detailModalOverlay = document.createElement("div");
  detailModalOverlay.className = "modal-overlay";
  detailModalOverlay.id = "inv-detail-modal";
  detailModalOverlay.setAttribute("role", "dialog");
  detailModalOverlay.setAttribute("aria-modal", "true");
  detailModalOverlay.setAttribute("aria-labelledby", "inv-detail-title");

  detailModal = document.createElement("div");
  detailModal.className = "modal-box modal-box-wide inv-detail-box";
  detailModal.innerHTML = [
    '<h3 class="modal-title" id="inv-detail-title">Detalhes do Item</h3>',
    '<div class="inv-detail-body" id="inv-detail-body"></div>',
    '<div class="modal-actions">',
    '  <button type="button" class="btn btn-secondary" id="inv-detail-close">Fechar</button>',
    '  <button type="button" class="btn btn-danger" id="inv-detail-equip" style="display:none">Equipar</button>',
    '</div>'
  ].join("");

  detailModalOverlay.appendChild(detailModal);
  document.body.appendChild(detailModalOverlay);

  document.getElementById("inv-detail-close").addEventListener("click", closeInvDetailModal);
  document.getElementById("inv-detail-equip").addEventListener("click", function () {
    if (!detailItemId) return;
    toggleEquip(detailItemId);
    openInvDetailModal(detailItemId);
  });
  detailModalOverlay.addEventListener("click", function (e) {
    if (e.target === detailModalOverlay) closeInvDetailModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && detailModalOverlay.classList.contains("open")) {
      closeInvDetailModal();
    }
  });
}

function attrRow(label, val, extraCls) {
  return '<div class="catalog-attr' + (extraCls || "") + '"><span class="catalog-attr-label">' +
    esc(label) + '</span> <span class="catalog-attr-val">' + esc(val) + '</span></div>';
}

function openInvDetailModal(id) {
  var invItem = OS.inventoryItems.find(function (i) { return i.id === id; });
  if (!invItem) return;

  buildDetailModal();
  detailItemId = id;

  var title = document.getElementById("inv-detail-title");
  if (title) title.textContent = invItem.name;

  var body = document.getElementById("inv-detail-body");
  if (body) {
    var attrs = invItem.attrs || {};
    var html = "";

    if (!isEmptyVal(attrs.descricao)) {
      html += '<p class="catalog-detail-desc">' + esc(attrs.descricao) + '</p>';
    }

    if (invItem.group) {
      var cat = GROUP_LABELS[invItem.group] || invItem.group;
      if (invItem.listId) cat += " › " + listIdToLabel(invItem.listId);
      html += attrRow("Categoria", cat);
    }

    var loc = normalizeStorageLocation(invItem.storageLocation);
    var locLabel = loc === "mochila" ? "Mochila" : loc === "alforge" ? "Alforje do Cavalo" : "Inventário (Solto)";
    html += attrRow("Localização", locLabel);

    html += attrRow("Quantidade", invItem.qty);

    var volInfo = OS.getItemVolumeInfo(invItem);
    if (volInfo.isExempt) {
      html += attrRow("Volume", "Isento (Companheiro / Montaria)");
    } else {
      var unitTxt = formatVolume(volInfo.volume) + (volInfo.isFallback ? " (padrão)" : "");
      if (invItem.qty > 1) {
        unitTxt += " · Total: " + formatVolume(roundVolume(volInfo.volume * invItem.qty));
      }
      html += attrRow("Volume", unitTxt);
    }

    if (!isEmptyVal(attrs.preco)) html += attrRow(attrLabel("preco"), attrs.preco);

    Object.keys(attrs).forEach(function (key) {
      if (key === "preco" || key === "descricao" || key === "volume") return;
      var val = attrs[key];
      if (isEmptyVal(val)) return;
      if (key === "capacidade_volumes") {
        val = formatVolume(val) + " volumes";
      }
      var cls = key === "vantagem" ? " catalog-vantagem" : key === "desvantagem" ? " catalog-desvantagem" : "";
      html += attrRow(attrLabel(key), val, cls);
    });

    if (invItem.equipped) {
      html += '<p class="inv-detail-equipped-badge">⚙ Equipado' + (getMountSlotType(invItem) ? ' no Cavalo' : '') + '</p>';
    }

    body.innerHTML = html;
  }

  var equipBtn = document.getElementById("inv-detail-equip");
  if (equipBtn) {
    var mountSlot = getMountSlotType(invItem);
    if (isEquippable(invItem) && (!mountSlot || OS.hasActiveHorse() || invItem.equipped)) {
      equipBtn.style.display = "";
      equipBtn.textContent = invItem.equipped
        ? "Desequipar"
        : mountSlot
        ? "Equipar no Cavalo"
        : "Equipar";
    } else {
      equipBtn.style.display = "none";
    }
  }

  detailModalOverlay.classList.add("open");
}

function closeInvDetailModal() {
  detailItemId = null;
  if (detailModalOverlay) detailModalOverlay.classList.remove("open");
}

/* ─── equipar / desequipar (personagem e montaria) ──────────── */

function toggleEquip(id) {
  var invItem = OS.inventoryItems.find(function (i) { return i.id === id; });
  if (!invItem || !isEquippable(invItem)) return { ok: false, error: "Item não equipável." };

  var mountSlot = getMountSlotType(invItem);
  var willEquip = !invItem.equipped;

  if (mountSlot !== null) {
    if (willEquip) {
      if (!OS.hasActiveHorse()) {
        var noHorseErr = "É necessário possuir um Cavalo no inventário para equipar " + invItem.name + ".";
        OS.showStorageFeedback(noHorseErr, true);
        return { ok: false, error: noHorseErr };
      }

      if (mountSlot === "alforge") {
        var currentAlforgeVol = OS.volumeOcupado("alforge");
        var newCap = getContainerCapacityFromItem(invItem);
        if (currentAlforgeVol > newCap) {
          var excess = roundVolume(currentAlforgeVol - newCap);
          var swapErr =
            "Não é possível equipar " +
            invItem.name +
            " (cap. " +
            formatVolume(newCap) +
            " vol.): o alforje atual contém " +
            formatVolume(currentAlforgeVol) +
            " vol. (faltam " +
            formatVolume(excess) +
            " vol. para caber).";
          OS.showStorageFeedback(swapErr, true);
          return { ok: false, error: swapErr };
        }
      }

      // Se a linha tiver qty > 1, separa 1 unidade para equipar no cavalo
      if (invItem.qty > 1) {
        invItem.qty -= 1;
        var singleGear = Object.assign({}, invItem, {
          id: uid(),
          qty: 1,
          equipped: false,
          storageLocation: "solto",
          attrs: Object.assign({}, invItem.attrs || {}),
          originalAttrs: invItem.originalAttrs ? Object.assign({}, invItem.originalAttrs) : null
        });
        OS.inventoryItems.push(singleGear);
        invItem = singleGear;
        detailItemId = singleGear.id;
      }

      // Desequipa qualquer item anterior ocupando o mesmo slot no cavalo
      OS.inventoryItems.forEach(function (other) {
        if (other && other.id !== invItem.id && other.equipped && getMountSlotType(other) === mountSlot) {
          other.equipped = false;
        }
      });

      invItem.storageLocation = "solto";
      invItem.equipped = true;
    } else {
      if (mountSlot === "alforge" && OS.getContainerItems("alforge").length > 0) {
        var unequipErr =
          "Não é possível desequipar " +
          invItem.name +
          " enquanto houver itens guardados no alforje (" +
          formatVolume(OS.volumeOcupado("alforge")) +
          " vol. ocupados).";
        OS.showStorageFeedback(unequipErr, true);
        return { ok: false, error: unequipErr };
      }
      invItem.equipped = false;
    }
  } else {
    if (willEquip && normalizeStorageLocation(invItem.storageLocation) !== "solto") {
      if (invItem.qty > 1) {
        invItem.qty -= 1;
        var singleEquip = Object.assign({}, invItem, {
          id: uid(),
          qty: 1,
          equipped: false,
          storageLocation: "solto",
          attrs: Object.assign({}, invItem.attrs || {}),
          originalAttrs: invItem.originalAttrs ? Object.assign({}, invItem.originalAttrs) : null
        });
        OS.inventoryItems.push(singleEquip);
        invItem = singleEquip;
        detailItemId = singleEquip.id;
      } else {
        invItem.storageLocation = "solto";
      }
    }
    invItem.equipped = willEquip;
    if (invItem.equipped && invItem.group === "armas") {
      ensureWeaponAmmoInitialized(invItem);
    }
  }

  syncEquipamentosTextarea();
  OS.renderInventory();
  syncInvTextarea();
  OS.scheduleSave();
  return { ok: true, item: invItem };
}
OS.toggleEquipItem = toggleEquip;

function buildEquipLine(i) {
  var line = EQUIP_LINE_PREFIX + i.name;
  if (i.qty > 1) line += " (x" + i.qty + ")";
  var attrs = i.attrs || {};
  var parts = [];
  Object.keys(attrs).forEach(function (k) {
    if (EQUIP_LINE_SKIP.indexOf(k) >= 0 || isEmptyVal(attrs[k])) return;
    parts.push(attrLabel(k) + ": " + attrs[k]);
  });
  if (parts.length) line += " — " + parts.join(" | ");
  return line;
}

function syncEquipamentosTextarea(options) {
  options = options || {};
  var ta = document.getElementById("equipamentos");
  if (!ta) return;

  var hasRealInventory = Array.isArray(OS.inventoryItems) && OS.inventoryItems.length > 0;
  var hasExistingGearLines = ta.value.split("\n").some(function (l) {
    return l.indexOf(EQUIP_LINE_PREFIX) === 0;
  });

  if (!hasRealInventory && hasExistingGearLines && !options.forceRebuild) {
    return;
  }

  var manualText = ta.value
    .split("\n")
    .filter(function (l) { return l.indexOf(EQUIP_LINE_PREFIX) !== 0; })
    .join("\n")
    .replace(/\s+$/, "");

  var equippedLines = OS.inventoryItems
    .filter(function (i) { return i.equipped; })
    .map(buildEquipLine);

  var next = manualText;
  if (equippedLines.length) {
    next += (manualText ? "\n" : "") + equippedLines.join("\n");
  }

  if (next !== ta.value) {
    ta.value = next;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/* ─── save/load hooks ─────────────────────────────────────────── */

OS.collectInventoryState = function () {
  return OS.inventoryItems.map(function (i) {
    var entry = {
      id: i.id,
      name: i.name,
      qty: i.qty,
      group: i.group,
      listId: i.listId,
      equipped: !!i.equipped,
      storageLocation: normalizeStorageLocation(i.storageLocation),
      upgraded: !!i.upgraded,
      originalAttrs: i.originalAttrs ? Object.assign({}, i.originalAttrs) : null,
      attrs: Object.assign({}, i.attrs)
    };
    if (i.group === "armas") {
      entry.ammoCurrent = i.ammoCurrent;
      entry.ammoMax = i.ammoMax;
      entry.autoReloadCount = i.autoReloadCount || 0;
      if (typeof i.lastWeaponRoll === "number") entry.lastWeaponRoll = i.lastWeaponRoll;
      entry.lastWeaponRollText = i.lastWeaponRollText || "";
      entry.lastMeleeRollText = i.lastMeleeRollText || "";
      entry.lastRangedRollText = i.lastRangedRollText || "";
    }
    return entry;
  });
};

OS.applyInventoryState = function (state) {
  state = state || {};
  OS.receivedDeliveryIds = Array.isArray(state.receivedDeliveryIds) ? state.receivedDeliveryIds.slice() : [];
  if (Array.isArray(state.inventoryItems)) {
    OS.inventoryItems = normalizeSavedItems(state.inventoryItems);
  } else {
    OS.inventoryItems = migrateLegacyText(state.inventario);
  }
  OS.renderInventory();
  syncInvTextarea();
  syncEquipamentosTextarea();
};

/* ─── limpar inventário ───────────────────────────────────────── */

OS.clearInventoryItems = function () {
  OS.inventoryItems = [];
  OS.receivedDeliveryIds = [];
  closeInvDetailModal();
  OS.closeTransferModal();
  if (OS.closeUpgradeItemModal) OS.closeUpgradeItemModal();
  OS.renderInventory();
};

/* ─── Item 6: Aprimoramento de Equipamentos ──────────────────── */

OS._upgradeModalState = {
  invId: null,
  testPassed: false,
  lastTestResult: null
};

var UPGRADE_SKIP_KEYS = [
  "preco",
  "descricao",
  "mutagenico",
  "group",
  "listId",
  "id",
  "volume",
  "capacidade_volumes"
];

function getUpgradableAttributeKeys(invItem) {
  var attrs = (invItem && invItem.attrs) || {};
  var keys = Object.keys(attrs).filter(function (k) {
    return UPGRADE_SKIP_KEYS.indexOf(k) < 0 && !isEmptyVal(attrs[k]);
  });
  if (!keys.length) {
    if (invItem && invItem.group === "armas") {
      keys = ["dano", "alcance", "recarga", "tambor", "detalhes"];
    } else if (invItem && invItem.group === "vestuario") {
      keys = ["protecao", "detalhes"];
    } else {
      keys = ["efeitos", "duracao", "detalhes"];
    }
  }
  return keys;
}

OS.updateUpgradeDiffDisplay = function () {
  var dbEl = document.getElementById("upgrade-db-input");
  var modEl = document.getElementById("upgrade-mod-input");
  var totalEl = document.getElementById("upgrade-total-diff");

  var db = dbEl ? parseInt(dbEl.value, 10) : 6;
  if (isNaN(db)) db = 6;
  var mod = modEl ? parseInt(modEl.value, 10) : 0;
  if (isNaN(mod)) mod = 0;

  var terror = OS.getSceneTerrorLevel ? OS.getSceneTerrorLevel() : 0;
  var total = db + terror + mod;
  if (totalEl) totalEl.textContent = String(total);

  // Sincroniza também com a calculadora genérica da ficha
  var calcDb = document.getElementById("test-calc-db");
  var calcMod = document.getElementById("test-calc-mod");
  if (calcDb) calcDb.value = String(db);
  if (calcMod) calcMod.value = String(mod);
  if (OS.updateTestCalculatorUI) OS.updateTestCalculatorUI();

  return total;
};

OS.renderUpgradeComparisonForm = function (invItem) {
  var listEl = document.getElementById("upgrade-attrs-list");
  if (!listEl || !invItem) return;
  listEl.innerHTML = "";

  var attrs = invItem.attrs || {};
  var keys = getUpgradableAttributeKeys(invItem);

  keys.forEach(function (key) {
    var origVal = attrs[key] !== undefined && attrs[key] !== null ? String(attrs[key]) : "—";
    var row = document.createElement("div");
    row.className = "upgrade-attr-row";
    row.dataset.attrKey = key;

    var lbl = document.createElement("span");
    lbl.className = "upgrade-attr-label";
    lbl.textContent = attrLabel(key);

    var origSpan = document.createElement("span");
    origSpan.className = "upgrade-attr-original";
    origSpan.dataset.attrKey = key;
    origSpan.textContent = origVal;

    var arrow = document.createElement("span");
    arrow.className = "upgrade-attr-arrow";
    arrow.innerHTML = "&rarr;";

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "field-line upgrade-attr-input";
    inp.dataset.attrKey = key;
    inp.value = "";
    inp.placeholder = "Novo valor para " + attrLabel(key);

    row.appendChild(lbl);
    row.appendChild(origSpan);
    row.appendChild(arrow);
    row.appendChild(inp);
    listEl.appendChild(row);
  });
};

OS.openUpgradeItemModal = function (invId) {
  var invItem = OS.inventoryItems.find(function (i) { return i.id === invId; });
  if (!invItem) return;

  var modal = document.getElementById("upgrade-item-modal");
  if (!modal) return;

  OS._upgradeModalState = {
    invId: invItem.id,
    testPassed: false,
    lastTestResult: null
  };

  var titleEl = document.getElementById("upgrade-item-title");
  if (titleEl) titleEl.textContent = "Aprimorar — " + invItem.name;

  var skillSel = document.getElementById("upgrade-skill-select");
  if (skillSel) {
    skillSel.value = invItem.group === "itens" ? "alquimia" : "engenharia";
  }

  var calcDb = document.getElementById("test-calc-db");
  var calcMod = document.getElementById("test-calc-mod");
  var upgDb = document.getElementById("upgrade-db-input");
  var upgMod = document.getElementById("upgrade-mod-input");
  if (upgDb && calcDb) upgDb.value = calcDb.value || "6";
  if (upgMod && calcMod) upgMod.value = calcMod.value || "0";

  OS.updateUpgradeDiffDisplay();

  var compSec = document.getElementById("upgrade-comparison-section");
  if (compSec) compSec.setAttribute("hidden", "");

  var confirmBtn = document.getElementById("upgrade-item-confirm");
  if (confirmBtn) confirmBtn.disabled = true;

  var fb = document.getElementById("upgrade-test-feedback");
  if (fb) {
    fb.textContent = "Role o teste de perícia para liberar os campos de aprimoramento.";
    fb.classList.remove("test-result-pass", "test-result-fail");
  }

  OS.renderUpgradeComparisonForm(invItem);
  modal.classList.add("open");
};

OS.closeUpgradeItemModal = function () {
  var modal = document.getElementById("upgrade-item-modal");
  if (modal) modal.classList.remove("open");
  OS._upgradeModalState.invId = null;
  OS._upgradeModalState.testPassed = false;
};

OS.runUpgradeItemTest = function (forcedRollTotal) {
  var st = OS._upgradeModalState || {};
  var invItem = OS.inventoryItems.find(function (i) { return i.id === st.invId; });
  if (!invItem) return null;

  var skillSel = document.getElementById("upgrade-skill-select");
  var skillId = skillSel ? skillSel.value : "engenharia";
  var diffTotal = OS.updateUpgradeDiffDisplay();

  var testRes;
  if (typeof forcedRollTotal === "number" && !isNaN(forcedRollTotal)) {
    testRes = {
      total: forcedRollTotal,
      skillId: skillId,
      skillLabel: skillId === "alquimia" ? "Alquimia" : "Engenharia",
      detailText: "Rolagem = " + forcedRollTotal
    };
  } else if (OS.performPassiveSkillTest) {
    testRes = OS.performPassiveSkillTest(skillId);
  } else {
    var r = OS.generateDiceResult ? OS.generateDiceResult("d6") : 4;
    testRes = {
      total: r + 4,
      skillId: skillId,
      skillLabel: skillId === "alquimia" ? "Alquimia" : "Engenharia",
      detailText: "Teste (" + (r + 4) + ")"
    };
  }

  var passed = testRes.total >= diffTotal;
  OS._upgradeModalState.testPassed = passed;
  OS._upgradeModalState.lastTestResult = {
    total: testRes.total,
    difficulty: diffTotal,
    passed: passed,
    skillId: skillId
  };

  if (OS.evaluateTestResult) {
    OS.evaluateTestResult(testRes.total, "Aprimorar " + invItem.name + " (" + testRes.skillLabel + ")");
  }

  var fb = document.getElementById("upgrade-test-feedback");
  var compSec = document.getElementById("upgrade-comparison-section");
  var confirmBtn = document.getElementById("upgrade-item-confirm");

  if (passed) {
    if (fb) {
      fb.textContent = "✓ SUCESSO no teste de " + testRes.skillLabel + " (" + testRes.total + " vs Dif. " + diffTotal + ")! Preencha os novos valores abaixo.";
      fb.classList.remove("test-result-fail");
      fb.classList.add("test-result-pass");
    }
    if (compSec) compSec.removeAttribute("hidden");
    if (confirmBtn) confirmBtn.disabled = false;
  } else {
    if (fb) {
      fb.textContent = "✗ FALHA no teste de " + testRes.skillLabel + " (" + testRes.total + " vs Dif. " + diffTotal + "). Nenhuma alteração permitida.";
      fb.classList.remove("test-result-pass");
      fb.classList.add("test-result-fail");
    }
    if (compSec) compSec.setAttribute("hidden", "");
    if (confirmBtn) confirmBtn.disabled = true;
  }

  return OS._upgradeModalState.lastTestResult;
};

OS.confirmUpgradeItem = function () {
  var st = OS._upgradeModalState || {};
  if (!st.testPassed || !st.invId) return false;

  var invItem = OS.inventoryItems.find(function (i) { return i.id === st.invId; });
  if (!invItem) return false;

  if (!invItem.originalAttrs) {
    invItem.originalAttrs = Object.assign({}, invItem.attrs || {});
  }
  if (!invItem.attrs) invItem.attrs = {};

  var inputs = document.querySelectorAll("#upgrade-attrs-list .upgrade-attr-input");
  var anyChanged = false;
  inputs.forEach(function (inp) {
    var key = inp.dataset.attrKey;
    var val = String(inp.value || "").trim();
    if (key && val !== "") {
      invItem.attrs[key] = val;
      anyChanged = true;
    }
  });

  if (anyChanged) {
    invItem.upgraded = true;
    if (invItem.group === "armas") {
      invItem.ammoMax = getWeaponMaxAmmo(invItem);
      invItem.ammoCurrent = invItem.ammoMax;
    }
  }

  OS.closeUpgradeItemModal();
  OS.renderInventory();
  syncInvTextarea();
  if (invItem.equipped) syncEquipamentosTextarea();
  OS.scheduleSave();
  return anyChanged;
};

/* ─── bind ───────────────────────────────────────────────────── */

OS.bindInventoryUI = function () {
  var btnRollUpg = document.getElementById("btn-upgrade-roll-test");
  if (btnRollUpg && !btnRollUpg._bound) {
    btnRollUpg._bound = true;
    btnRollUpg.addEventListener("click", function () {
      OS.runUpgradeItemTest();
    });
  }

  var btnCancelUpg = document.getElementById("upgrade-item-cancel");
  if (btnCancelUpg && !btnCancelUpg._bound) {
    btnCancelUpg._bound = true;
    btnCancelUpg.addEventListener("click", function () {
      OS.closeUpgradeItemModal();
    });
  }

  var btnConfirmUpg = document.getElementById("upgrade-item-confirm");
  if (btnConfirmUpg && !btnConfirmUpg._bound) {
    btnConfirmUpg._bound = true;
    btnConfirmUpg.addEventListener("click", function () {
      OS.confirmUpgradeItem();
    });
  }

  var upgDb = document.getElementById("upgrade-db-input");
  var upgMod = document.getElementById("upgrade-mod-input");
  [upgDb, upgMod].forEach(function (el) {
    if (el && !el._bound) {
      el._bound = true;
      el.addEventListener("input", function () {
        OS.updateUpgradeDiffDisplay();
      });
    }
  });

  var upgOverlay = document.getElementById("upgrade-item-modal");
  if (upgOverlay && !upgOverlay._bound) {
    upgOverlay._bound = true;
    upgOverlay.addEventListener("click", function (e) {
      if (e.target === upgOverlay) OS.closeUpgradeItemModal();
    });
  }

  ["btn-open-transfer-modal", "btn-montaria-transfer"].forEach(function (btnId) {
    var btn = document.getElementById(btnId);
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", function () {
        OS.openTransferModal();
      });
    }
  });

  var btnCloseTransfer = document.getElementById("transfer-modal-close");
  if (btnCloseTransfer && !btnCloseTransfer._bound) {
    btnCloseTransfer._bound = true;
    btnCloseTransfer.addEventListener("click", function () {
      OS.closeTransferModal();
    });
  }

  var transferOverlay = document.getElementById("transfer-storage-modal");
  if (transferOverlay && !transferOverlay._bound) {
    transferOverlay._bound = true;
    transferOverlay.addEventListener("click", function (e) {
      if (e.target === transferOverlay) OS.closeTransferModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && transferOverlay.classList.contains("open")) {
        OS.closeTransferModal();
      }
    });
  }

  var equipTextarea = document.getElementById("equipamentos");
  if (equipTextarea && !equipTextarea._naturalAttacksBound) {
    equipTextarea._naturalAttacksBound = true;
    equipTextarea.addEventListener("input", function () {
      if (!Array.isArray(OS.inventoryItems) || OS.inventoryItems.length === 0) {
        OS.renderFichaEquippedItems();
      }
    });
  }

  OS.renderInventory();
};
