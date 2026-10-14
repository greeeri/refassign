export function showGameConflictPopup(message: string) {
  if (/venue conflict|location double-booking|team double-booking/i.test(message) && typeof window !== "undefined") {
    window.alert(message);
  }
}
