/**
 * Regras de progressão de perícias
 * Centraliza a conversão entre nível efetivo e dados
 */

export function levelToDice(effectiveLevel) {
  var level = parseInt(String(effectiveLevel || 0), 10);
  if (isNaN(level) || level < 1) return [];
  
  var dice = [];
  var dieValues = ["d4", "d6", "d8", "d10", "d12"];
  
  // Calcular quantos grupos de 5 níveis completos
  var fullGroups = Math.floor((level - 1) / 5);
  var remainder = ((level - 1) % 5) + 1;
  
  // Adicionar dados para grupos completos (todos d12)
  for (var i = 0; i < fullGroups; i++) {
    dice.push("d12");
  }
  
  // Adicionar dado atual baseado no remainder
  if (remainder > 0) {
    dice.push(dieValues[remainder - 1]);
  }
  
  return dice;
}

export function diceToLevel(diceArray) {
  if (!Array.isArray(diceArray) || diceArray.length === 0) return 0;
  
  var dieValues = { "d4": 1, "d6": 2, "d8": 3, "d10": 4, "d12": 5 };
  var totalLevel = 0;
  
  // Ordenar dados do maior para o menor para processar corretamente
  var sortedDice = diceArray.slice().sort(function(a, b) {
    return (dieValues[b] || 0) - (dieValues[a] || 0);
  });
  
  sortedDice.forEach(function(die) {
    var value = dieValues[die];
    if (value) {
      totalLevel += value;
    }
  });
  
  return totalLevel;
}

export function getNextLevel(currentLevel) {
  var level = parseInt(String(currentLevel || 0), 10);
  if (isNaN(level) || level < 1) return 1;
  return level + 1;
}

export function getEvolutionCost(targetLevel) {
  var level = parseInt(String(targetLevel || 0), 10);
  if (isNaN(level) || level < 1) return 1;
  
  // Níveis 1-5: 1 ponto
  if (level <= 5) return 1;
  // Níveis 6-10: 2 pontos
  if (level <= 10) return 2;
  // Nível 11+: 3 pontos
  return 3;
}

export function formatDiceDisplay(diceArray) {
  if (!Array.isArray(diceArray) || diceArray.length === 0) return "";
  return diceArray.join(" + ");
}
