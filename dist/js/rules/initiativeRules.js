export function calculateInitiative(chamberValues) {
  // Initiative is chambers 1, 2, 3 (indices 0, 1, 2)
  return (
    (chamberValues[0] || 0) +
    (chamberValues[1] || 0) +
    (chamberValues[2] || 0)
  );
}

/**
 * Calcula ações por turno derivadas da Iniciativa (regras_combate.json → regra_acoes_por_iniciativa)
 * aplicando a perda de ações bônus por sobrecarga (itens_e_equipamentos.json → acoes_bonus_perdidas: 2),
 * sem nunca perder a 1 ação padrão.
 */
export function calculateActionsFromInitiative(initiativeScore, isOverloaded, lostBonusActions) {
  var baseActions = 1;
  var init = Math.max(0, Number(initiativeScore) || 0);
  var baseBonusActions = Math.floor(init / 5);
  var penalty = isOverloaded
    ? (typeof lostBonusActions === "number" ? lostBonusActions : 2)
    : 0;
  var effectiveBonusActions = Math.max(0, baseBonusActions - penalty);
  return {
    baseActions: baseActions,
    baseBonusActions: baseBonusActions,
    effectiveBonusActions: effectiveBonusActions,
    lostBonusActions: penalty,
    totalActions: baseActions + effectiveBonusActions
  };
}

/**
 * Calcula o deslocamento em metros por ação (base 6m = 4 quadrados × 1,5m),
 * aplicando -3m/ação quando sobrecarregado.
 */
export function calculateMovementPerAction(baseMeters, isOverloaded, penaltyMeters) {
  var base = typeof baseMeters === "number" && !isNaN(baseMeters) ? baseMeters : 6;
  var pen = isOverloaded ? (typeof penaltyMeters === "number" ? penaltyMeters : 3) : 0;
  return {
    baseMeters: base,
    penaltyMeters: pen,
    effectiveMeters: Math.max(0, base - pen)
  };
}
