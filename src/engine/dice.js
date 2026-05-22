export function rollDie(sides = 20) {
  // crypto-safe random integer in [1, sides]
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % sides) + 1;
}

export function roll({ sides = 20, reason = "check" }) {
  const value = rollDie(sides);
  return { sides, reason, value, at: new Date().toISOString() };
}
