/**
 * Regras centrais de Volumes, Capacidade de Containers (Mochila / Alforges),
 * Fallback de Catálogos, Divisão de Pilhas e Carga Solta por Quantidade.
 */

export var DEFAULT_BACKPACK_CAPACITY = 15;
export var DEFAULT_FALLBACK_VOLUME = 1;
export var BASE_MOVEMENT_METERS = 6;

var ANIMAL_NAMES_NORMALIZED = ["aguia", "coruja", "cavalo", "cabra", "vaca"];

export function roundVolume(value) {
  var n = Number(value);
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function formatVolume(value) {
  return String(roundVolume(value)).replace(".", ",");
}

export function normalizeStorageLocation(loc) {
  if (loc === "mochila" || loc === "alforge" || loc === "solto") {
    return loc;
  }
  return "solto";
}

export function normalizeItemKey(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getRawItemName(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.name || item.nome || item.kit || item.mutagenico || "").trim();
}

export function isAnimalItem(item) {
  if (!item || typeof item !== "object") return false;
  var listId = normalizeItemKey(item.listId);
  if (listId === "animais") return true;
  if (
    listId &&
    listId !== "animais" &&
    listId !== "animais_e_equipamentos"
  ) {
    return false;
  }
  var normName = normalizeItemKey(getRawItemName(item));
  return ANIMAL_NAMES_NORMALIZED.indexOf(normName) >= 0;
}

export function isHorseItem(item) {
  return isAnimalItem(item) && normalizeItemKey(getRawItemName(item)) === "cavalo";
}

export function getMountSlotType(item) {
  if (!item || typeof item !== "object" || isAnimalItem(item)) return null;
  var normName = normalizeItemKey(getRawItemName(item));
  var listId = normalizeItemKey(item.listId);
  var group = normalizeItemKey(item.group);
  var isMountCatalog =
    listId === "equipamentos_de_montaria" ||
    group === "equipamentos_de_montaria" ||
    group === "animais e equipamentos";

  if (/^alforjes?\b/.test(normName)) return "alforge";
  if (/^sela\b/.test(normName)) return "sela";
  if (/^barda\b/.test(normName)) return "barda";

  if (isMountCatalog) {
    var cap = parseVolumeNumber(
      (item.attrs && item.attrs.capacidade_volumes !== undefined)
        ? item.attrs.capacidade_volumes
        : item.capacidade_volumes
    );
    if (cap && cap > 0) return "alforge";
  }
  return null;
}

export function parseVolumeNumber(raw) {
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") {
    return null;
  }
  if (typeof raw === "number") {
    if (isNaN(raw) || raw < 0) return null;
    return roundVolume(raw);
  }
  if (typeof raw === "string") {
    var s = raw.trim().replace(",", ".");
    if (!s) return null;
    var n = Number(s);
    if (isNaN(n) || n < 0) return null;
    return roundVolume(n);
  }
  return null;
}

export function getContainerCapacityFromItem(item) {
  if (!item || typeof item !== "object") return 0;
  var raw =
    item.attrs && item.attrs.capacidade_volumes !== undefined
      ? item.attrs.capacidade_volumes
      : item.capacidade_volumes;
  var parsed = parseVolumeNumber(raw);
  if (parsed !== null && parsed > 0) return parsed;

  var normName = normalizeItemKey(getRawItemName(item));
  if (normName.indexOf("alforjes 2 bolsos") === 0) return 5;
  if (normName.indexOf("alforjes 4 bolsos") === 0) return 10;
  if (normName.indexOf("alforjes 6 bolsos") === 0) return 15;
  if (normName === "mochila") return DEFAULT_BACKPACK_CAPACITY;
  return 0;
}

/**
 * Centraliza a resolução de volume de um item (catálogo ou inventário),
 * incluindo exclusão de animais e fallback volume = 1 para kits / itens criados sem volume.
 */
export function getItemVolumeInfo(item, catalogLookupFn) {
  if (!item || typeof item !== "object") {
    return { volume: 0, isFallback: false, isExempt: true };
  }
  if (isAnimalItem(item)) {
    return { volume: 0, isFallback: false, isExempt: true };
  }

  var directAttrVol =
    item.attrs && typeof item.attrs === "object"
      ? parseVolumeNumber(item.attrs.volume)
      : null;
  if (directAttrVol !== null) {
    return { volume: directAttrVol, isFallback: false, isExempt: false };
  }

  var directItemVol = parseVolumeNumber(item.volume);
  if (directItemVol !== null) {
    return { volume: directItemVol, isFallback: false, isExempt: false };
  }

  if (typeof catalogLookupFn === "function") {
    var name = getRawItemName(item);
    var found = name ? catalogLookupFn(name) : null;
    var catItem = found && (found.item || found);
    if (catItem && typeof catItem === "object") {
      if (
        item.attrs &&
        typeof item.attrs === "object" &&
        item.attrs.capacidade_volumes === undefined &&
        catItem.capacidade_volumes !== undefined
      ) {
        item.attrs.capacidade_volumes = catItem.capacidade_volumes;
      }
      var catVol = parseVolumeNumber(catItem.volume);
      if (catVol !== null) {
        if (item.attrs && typeof item.attrs === "object") {
          item.attrs.volume = catVol;
        }
        return { volume: catVol, isFallback: false, isExempt: false };
      }
    }
  }

  return { volume: DEFAULT_FALLBACK_VOLUME, isFallback: true, isExempt: false };
}

export function getItemVolume(item, catalogLookupFn) {
  return getItemVolumeInfo(item, catalogLookupFn).volume;
}

/**
 * Soma o volume de todos os itens dentro do container, arredondando cada soma parcial
 * para 2 casas decimais (Math.round(v * 100) / 100).
 */
export function volumeOcupado(container, catalogLookupFn) {
  var list = Array.isArray(container)
    ? container
    : container && Array.isArray(container.items)
    ? container.items
    : [];
  var total = 0;
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (!it) continue;
    var info = getItemVolumeInfo(it, catalogLookupFn);
    if (info.isExempt) continue;
    var qty = Math.max(1, parseInt(it.qty !== undefined ? it.qty : 1, 10) || 1);
    for (var q = 0; q < qty; q++) {
      total = roundVolume(total + info.volume);
    }
  }
  return roundVolume(total);
}

/**
 * Retorna capacidade_volumes - volumeOcupado(container), arredondado para 2 casas decimais.
 */
export function volumeLivre(container, catalogLookupFn) {
  var cap = roundVolume(Number(container && container.capacidade_volumes) || 0);
  var occupied = volumeOcupado(container, catalogLookupFn);
  return roundVolume(cap - occupied);
}

/**
 * Retorna false se o volume total exigido pelo item exceder volumeLivre(container),
 * se o container não tiver capacidade ativa ou se o item for um animal/montaria.
 */
export function podeReceberItem(container, item, qtyOverride, catalogLookupFn) {
  if (!container || !item) return false;
  var cap = roundVolume(Number(container.capacidade_volumes) || 0);
  if (cap <= 0) return false;

  var info = getItemVolumeInfo(item, catalogLookupFn);
  if (info.isExempt) return false;

  var qty =
    qtyOverride !== undefined && qtyOverride !== null
      ? Math.max(1, parseInt(qtyOverride, 10) || 1)
      : Math.max(1, parseInt(item.qty !== undefined ? item.qty : 1, 10) || 1);

  var needed = 0;
  for (var q = 0; q < qty; q++) {
    needed = roundVolume(needed + info.volume);
  }
  var free = volumeLivre(container, catalogLookupFn);
  return !(needed > free);
}

export function describeCapacityBlock(container, item, qtyOverride, catalogLookupFn) {
  if (!item || isAnimalItem(item)) {
    return "Animais e montarias não entram em mochilas ou alforges.";
  }
  var label = (container && container.label) || "destino";
  var cap = roundVolume(Number(container && container.capacidade_volumes) || 0);
  if (!container || cap <= 0) {
    return "Não há " + label.toLowerCase() + " equipado com capacidade disponível.";
  }

  var info = getItemVolumeInfo(item, catalogLookupFn);
  var qty =
    qtyOverride !== undefined && qtyOverride !== null
      ? Math.max(1, parseInt(qtyOverride, 10) || 1)
      : Math.max(1, parseInt(item.qty !== undefined ? item.qty : 1, 10) || 1);

  var needed = 0;
  for (var q = 0; q < qty; q++) {
    needed = roundVolume(needed + info.volume);
  }
  var free = Math.max(0, volumeLivre(container, catalogLookupFn));
  var missing = roundVolume(Math.max(0, needed - free));
  var itemName = getRawItemName(item) || "item";
  var qtySuffix = qty > 1 ? " (x" + qty + ")" : "";

  return (
    "Espaço insuficiente em " +
    label +
    " para " +
    itemName +
    qtySuffix +
    ": precisa de " +
    formatVolume(needed) +
    " vol., livre " +
    formatVolume(free) +
    " vol. (faltam " +
    formatVolume(missing) +
    " vol.)."
  );
}

function stableAttrsKey(attrs) {
  if (!attrs || typeof attrs !== "object") return "{}";
  var keys = Object.keys(attrs).sort();
  var pairs = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    pairs.push(k + ":" + JSON.stringify(attrs[k]));
  }
  return "{" + pairs.join(",") + "}";
}

export function canMergeInventoryStacks(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.equipped || b.equipped) return false;
  if (!!a.upgraded !== !!b.upgraded) return false;
  if (normalizeStorageLocation(a.storageLocation) !== normalizeStorageLocation(b.storageLocation)) {
    return false;
  }
  if (normalizeItemKey(a.name) !== normalizeItemKey(b.name)) return false;
  if (normalizeItemKey(a.group) !== normalizeItemKey(b.group)) return false;
  if (normalizeItemKey(a.listId) !== normalizeItemKey(b.listId)) return false;
  if (a.group === "armas" || b.group === "armas") {
    if (a.ammoCurrent !== a.ammoMax || b.ammoCurrent !== b.ammoMax) return false;
    if ((a.autoReloadCount || 0) !== (b.autoReloadCount || 0)) return false;
  }
  return stableAttrsKey(a.attrs) === stableAttrsKey(b.attrs);
}

/**
 * Move total ou parcialmente (1 <= moveQty <= item.qty) um item para targetLocation,
 * dividindo a linha de origem ou fazendo merge em pilha idêntica no destino, preservando attrs.
 */
export function transferItemStack(itemsList, invId, targetLocation, moveQty, makeIdFn) {
  if (!Array.isArray(itemsList)) return { ok: false, reason: "Lista inválida." };
  var destLoc = normalizeStorageLocation(targetLocation);
  var idx = -1;
  for (var i = 0; i < itemsList.length; i++) {
    if (itemsList[i] && itemsList[i].id === invId) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { ok: false, reason: "Item não encontrado." };

  var src = itemsList[idx];
  var srcLoc = normalizeStorageLocation(src.storageLocation);
  if (srcLoc === destLoc) {
    return { ok: true, item: src, movedQty: 0 };
  }

  var totalQty = Math.max(1, parseInt(src.qty, 10) || 1);
  var qtyToMove =
    moveQty !== undefined && moveQty !== null
      ? Math.max(1, Math.min(totalQty, parseInt(moveQty, 10) || totalQty))
      : totalQty;

  var idGen =
    typeof makeIdFn === "function"
      ? makeIdFn
      : function () {
          return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        };

  var probe = Object.assign({}, src, {
    id: "__probe__",
    qty: qtyToMove,
    equipped: false,
    storageLocation: destLoc,
    attrs: Object.assign({}, src.attrs || {}),
    originalAttrs: src.originalAttrs ? Object.assign({}, src.originalAttrs) : null
  });

  var mergeTarget = null;
  for (var m = 0; m < itemsList.length; m++) {
    var cand = itemsList[m];
    if (cand && cand.id !== src.id && canMergeInventoryStacks(cand, probe)) {
      mergeTarget = cand;
      break;
    }
  }

  if (qtyToMove < totalQty) {
    src.qty = totalQty - qtyToMove;
    if (mergeTarget) {
      mergeTarget.qty = Math.max(1, parseInt(mergeTarget.qty, 10) || 1) + qtyToMove;
      return { ok: true, item: mergeTarget, originItem: src, movedQty: qtyToMove, merged: true, split: true };
    }
    var splitItem = Object.assign({}, probe, { id: idGen() });
    itemsList.push(splitItem);
    return { ok: true, item: splitItem, originItem: src, movedQty: qtyToMove, merged: false, split: true };
  }

  // Movendo a pilha inteira
  if (destLoc !== "solto") {
    src.equipped = false;
  }
  if (mergeTarget) {
    mergeTarget.qty = Math.max(1, parseInt(mergeTarget.qty, 10) || 1) + totalQty;
    itemsList.splice(idx, 1);
    return { ok: true, item: mergeTarget, movedQty: totalQty, merged: true, split: false };
  }

  src.storageLocation = destLoc;
  return { ok: true, item: src, movedQty: totalQty, merged: false, split: false };
}

/* ─── Carga por quantidade de itens soltos (regras_de_carga) ─── */

export function calculateLooseLoadCapacity(atletismoPoints, baseItems, bonusPerPoint) {
  var base = typeof baseItems === "number" && !isNaN(baseItems) ? baseItems : 2;
  var bonus = typeof bonusPerPoint === "number" && !isNaN(bonusPerPoint) ? bonusPerPoint : 2;
  var pts = Math.max(0, parseInt(atletismoPoints, 10) || 0);
  return base + pts * bonus;
}

export function doesItemCountAsLooseLoad(invItem) {
  if (!invItem || typeof invItem !== "object") return false;
  if (normalizeStorageLocation(invItem.storageLocation) !== "solto") return false;
  if (isAnimalItem(invItem)) return false;
  // Equipamentos de montaria equipados no cavalo estão presos à montaria, não carregados pelo personagem
  if (getMountSlotType(invItem) !== null && invItem.equipped) return false;
  return true;
}

export function countLooseLoadItems(itemsList) {
  if (!Array.isArray(itemsList)) return 0;
  var count = 0;
  for (var i = 0; i < itemsList.length; i++) {
    var it = itemsList[i];
    if (!doesItemCountAsLooseLoad(it)) continue;
    count += Math.max(1, parseInt(it.qty, 10) || 1);
  }
  return count;
}

export function evaluateOverloadState(looseCount, capacity, rulesOverride) {
  var rules = rulesOverride || {};
  var defPen = typeof rules.penalidade_defesa === "number" ? rules.penalidade_defesa : 5;
  var movPen =
    typeof rules.penalidade_movimento_metros_por_acao === "number"
      ? rules.penalidade_movimento_metros_por_acao
      : 3;
  var actLost = typeof rules.acoes_bonus_perdidas === "number" ? rules.acoes_bonus_perdidas : 2;
  var overloaded = (Number(looseCount) || 0) > (Number(capacity) || 0);
  return {
    overloaded: overloaded,
    looseCount: Number(looseCount) || 0,
    capacity: Number(capacity) || 0,
    defensePenalty: overloaded ? defPen : 0,
    movementPenaltyMeters: overloaded ? movPen : 0,
    bonusActionsLost: overloaded ? actLost : 0
  };
}
