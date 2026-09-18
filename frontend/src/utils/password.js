const CLASSES = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*()-_+=?'
};
const ALL_CHARS = Object.values(CLASSES).join('');

function randomIntegers(count) {
  const bytes = new Uint32Array(count);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value >>> 0);
}

export function generateStrongPassword(length = 16) {
  const size = Math.max(12, Math.min(64, length));
  const picks = Object.values(CLASSES).map(alphabet =>
    alphabet[randomIntegers(1)[0] % alphabet.length]
  );
  const rest = randomIntegers(size - picks.length)
    .map(value => ALL_CHARS[value % ALL_CHARS.length]);
  const chars = [...picks, ...rest];

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const swap = randomIntegers(1)[0] % (i + 1);
    [chars[i], chars[swap]] = [chars[swap], chars[i]];
  }
  return chars.join('');
}