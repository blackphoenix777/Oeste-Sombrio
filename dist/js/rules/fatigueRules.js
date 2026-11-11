export function incrementFatigue(current) {
  return Math.min(40, (current || 0) + 1);
}

export function decrementFatigue(current) {
  return Math.max(0, (current || 0) - 1);
}

export function isFatigueMaxed(current) {
  return (current || 0) >= 40;
}

export function calculateFatiguePenalty(chamberValues, fatigueLevel) {
  if (fatigueLevel <= 0) return { values: (chamberValues || []).slice(), chosenIndex: -1 };
  
  var highestValue = -1;
  var chosenIndex = -1;

  for (var i = 0; i < 6; i++) {
    var val = chamberValues[i] || 0;
    if (val > highestValue) {
      highestValue = val;
      chosenIndex = i;
    }
  }

  var newValues = (chamberValues || []).slice();
  if (chosenIndex !== -1) {
    newValues[chosenIndex] = Math.max(0, highestValue - fatigueLevel);
  }

  return {
    values: newValues,
    chosenIndex: chosenIndex
  };
}

/**
 * Aplica fadiga aos 6 resultados do 6B.
 * Sempre reduz o maior valor disponível no momento.
 * Em caso de empate, usa o primeiro índice (sentido horário).
 * Dados zerados são ignorados e considerados inutilizados.
 * Não altera o tambor, defesa ou iniciativa.
 */
export function applyFatigueTo6BRoll(results, fatigue) {
  var values = (results || []).slice();
  var remaining = Math.max(0, fatigue || 0);
  var zeroedIndices = [];

  while (remaining > 0) {
    var highestValue = -1;
    var highestIndex = -1;

    for (var i = 0; i < values.length; i++) {
      var val = values[i] || 0;
      // Ignorar dados zerados (inutilizados)
      if (val <= 0) continue;
      // Critério de desempate: primeiro índice com maior valor (sentido horário)
      if (val > highestValue) {
        highestValue = val;
        highestIndex = i;
      }
    }

    if (highestIndex === -1 || highestValue <= 0) break;

    var reduction = Math.min(remaining, highestValue);
    values[highestIndex] = highestValue - reduction;
    remaining -= reduction;

    // Se o dado zerou, marcar como inutilizado
    if (values[highestIndex] === 0 && zeroedIndices.indexOf(highestIndex) === -1) {
      zeroedIndices.push(highestIndex);
    }
  }

  return {
    values: values,
    zeroedIndices: zeroedIndices
  };
}
