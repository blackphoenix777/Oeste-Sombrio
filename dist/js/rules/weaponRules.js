export function applyWeaponModifiers(baseRoll, weaponModifiers) {
  return (baseRoll || 0) + (weaponModifiers || 0);
}
