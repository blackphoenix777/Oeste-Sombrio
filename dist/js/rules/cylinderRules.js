import { OS } from "../app.js";

export function canReloadCylinder(usedChambers) {
  if (OS && OS.freeEdit) {
    var dicePool = OS.get6BDiceArray ? OS.get6BDiceArray() : ["d6"];
    var activeLimit = Math.max(1, Math.min(6, dicePool.length || 1));
    var used = Array.isArray(usedChambers) ? usedChambers : [];
    var hasActiveValue = false;
    for (var i = 0; i < activeLimit; i++) {
      var val = 0;
      if (typeof OS.chamberValueAt === "function") {
        val = OS.chamberValueAt(i);
      } else if (typeof OS.$ === "function") {
        var inp = OS.$("chamber-" + i);
        val = inp ? parseInt(String(inp.value || "0"), 10) || 0 : 0;
      }
      if (val > 0) {
        hasActiveValue = true;
        if (used.indexOf(i) === -1) {
          return false;
        }
      }
    }
    return hasActiveValue ? true : true;
  }
  return (usedChambers || []).length === 6;
}

export function isCylinderEmpty(usedChambers) {
  return canReloadCylinder(usedChambers);
}

export function getUpdatedUsedChambers(usedChambers, indices) {
  if (!indices || !indices.length) return usedChambers;
  var updated = (usedChambers || []).slice();
  indices.forEach(function (idx) {
    if (updated.indexOf(idx) === -1) {
      updated.push(idx);
    }
  });
  return updated;
}

export function calculateChamberBonus(selectedIndices) {
  var bonus = 0;
  selectedIndices.forEach(function (idx) {
    bonus += OS.chamberValueAt(idx);
  });
  return bonus;
}

export function sanitizeChamberValue(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 2);
}
