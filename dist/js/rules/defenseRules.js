export function calculateDefense(chamberValues) {
  // Defense is chambers 6, 5, 4 (indices 5, 4, 3)
  return (
    (chamberValues[5] || 0) +
    (chamberValues[4] || 0) +
    (chamberValues[3] || 0)
  );
}
