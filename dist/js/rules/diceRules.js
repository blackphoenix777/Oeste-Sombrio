import { OS } from "../app.js";

export function getDieSides(die) {
  var sides = parseInt(String(die || "").replace(/^d/, ""), 10);
  if (!sides || isNaN(sides) || sides <= 0) return 0;
  return sides;
}

export function generateDiceResult(die) {
  var sides = getDieSides(die);
  if (!sides) return 0;
  return ((Math.random() * sides) | 0) + 1;
}

export function rollExplodingDie(die) {
  var sides = getDieSides(die);
  var parts = [];
  var total = 0;
  var exploded = false;
  if (!sides) {
    return { die: die, total: 0, exploded: false, parts: parts };
  }
  while (true) {
    var r = ((Math.random() * sides) | 0) + 1;
    parts.push(r);
    total += r;
    if (r === sides) {
      exploded = true;
      continue;
    }
    break;
  }
  return { die: die, total: total, exploded: exploded, parts: parts };
}

export function rollSelectedDice(dice) {
  var results = [];
  for (var i = 0; i < dice.length; i++) {
    results.push(generateDiceResult(dice[i]));
  }
  return results;
}

export function rollSelectedDiceDetailed(dice) {
  var details = [];
  var results = [];
  for (var i = 0; i < dice.length; i++) {
    var detail = rollExplodingDie(dice[i]);
    details.push(detail);
    results.push(detail.total);
  }
  return { results: results, details: details };
}

export function hasAnyExplosion(details) {
  if (!details || !details.length) return false;
  for (var i = 0; i < details.length; i++) {
    if (details[i] && details[i].exploded) return true;
  }
  return false;
}

export function getHighestRoll(results) {
  var max = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i] > max) max = results[i];
  }
  return max;
}

export function calculateRollTotal(results) {
  var total = 0;
  for (var i = 0; i < results.length; i++) total += results[i];
  return total;
}

export function calculateFinalRoll(baseTotal, selectedIndices) {
  if (arguments.length === 0) {
    var st = OS.chamberSelectionState || {};
    baseTotal = st.baseTotal || 0;
    selectedIndices = st.selectedChambers || [];
  }
  return (baseTotal || 0) + OS.calculateChamberBonus(selectedIndices || []);
}
