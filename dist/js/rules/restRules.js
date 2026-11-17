import { diceToLevel } from "./skill-progression.js";

export function applyShortRest(currentFatigue) {
  return Math.max(0, (currentFatigue || 0) - 1);
}

export function applyLongRest(currentFatigue) {
  return 0;
}

/**
 * Extrai o nível (quantidade de passos de dado) de uma perícia a partir de um objeto de ficha
 * sem acessar o DOM.
 */
export function getSkillLevelFromSheetData(sheetData, skillPrefix) {
  if (!sheetData || typeof sheetData !== "object" || !skillPrefix) return 0;
  var diceTypes = ["d4", "d6", "d8", "d10", "d12"];
  var diceArray = [];
  for (var i = 0; i < diceTypes.length; i++) {
    var d = diceTypes[i];
    if (sheetData[skillPrefix + "-" + d]) {
      diceArray.push(d);
    }
  }
  if (!diceArray.length && typeof sheetData[skillPrefix] === "string") {
    var legacy = sheetData[skillPrefix].trim().toLowerCase();
    if (diceTypes.indexOf(legacy) >= 0) {
      diceArray.push(legacy);
    }
  }
  return diceToLevel(diceArray);
}

export function getMisticismoLevel(sheetData) {
  if (sheetData && typeof sheetData === "object") {
    return getSkillLevelFromSheetData(sheetData, "pericia-misticismo");
  }
  if (typeof document === "undefined") return 0;
  var checkboxes = document.querySelectorAll("input[name^='pericia-misticismo-']:checked");
  if (!checkboxes || checkboxes.length === 0) return 0;

  var diceArray = [];
  checkboxes.forEach(function (cb) {
    var dieMatch = cb.name.match(/pericia-misticismo-(d4|d6|d8|d10|d12)$/);
    if (dieMatch) {
      diceArray.push(dieMatch[1]);
    }
  });

  return diceToLevel(diceArray);
}

export function getAtletismoLevel(sheetData) {
  if (sheetData && typeof sheetData === "object") {
    return getSkillLevelFromSheetData(sheetData, "pericia-atletismo");
  }
  if (typeof document === "undefined") return 0;
  var checkboxes = document.querySelectorAll("input[name^='pericia-atletismo-']:checked");
  if (!checkboxes || checkboxes.length === 0) return 0;

  var diceArray = [];
  checkboxes.forEach(function (cb) {
    var dieMatch = cb.name.match(/pericia-atletismo-(d4|d6|d8|d10|d12)$/);
    if (dieMatch) {
      diceArray.push(dieMatch[1]);
    }
  });

  return diceToLevel(diceArray);
}

export function calculateRemMax(nivel, sheetData) {
  var n = parseInt(String(nivel || 0), 10);
  if (isNaN(n)) n = 0;
  var misticismo = getMisticismoLevel(sheetData);
  return Math.floor(n / 2) + misticismo;
}
