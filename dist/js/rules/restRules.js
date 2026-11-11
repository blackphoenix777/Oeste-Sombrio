import { diceToLevel } from "./skill-progression.js";

export function applyShortRest(currentFatigue) {
  return Math.max(0, (currentFatigue || 0) - 1);
}

export function applyLongRest(currentFatigue) {
  return 0;
}

export function getMisticismoLevel() {
  var checkboxes = document.querySelectorAll("input[name^='pericia-misticismo-']:checked");
  if (!checkboxes || checkboxes.length === 0) return 0;
  
  var diceArray = [];
  checkboxes.forEach(function(cb) {
    var dieMatch = cb.name.match(/pericia-misticismo-(d4|d6|d8|d10|d12)$/);
    if (dieMatch) {
      diceArray.push(dieMatch[1]);
    }
  });
  
  return diceToLevel(diceArray);
}

export function getAtletismoLevel() {
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

export function calculateRemMax(nivel) {
  var n = parseInt(String(nivel || 0), 10);
  if (isNaN(n)) n = 0;
  var misticismo = getMisticismoLevel();
  return Math.floor(n / 2) + misticismo;
}
