// Русское склонение числительных.
// plural(2, ['открытое замечание', 'открытых замечания', 'открытых замечаний'])
export function plural(n, forms) {
  const num = Math.abs(Number(n)) % 100;
  const last = num % 10;

  if (num > 10 && num < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
