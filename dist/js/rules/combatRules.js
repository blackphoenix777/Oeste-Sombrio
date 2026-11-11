export function calculateCombatResult(baseRoll, modifiers) {
  return (baseRoll || 0) + (modifiers || 0);
}

export function applyCombatModifiers(baseRoll, modifiers) {
  return (baseRoll || 0) + (modifiers || 0);
}
