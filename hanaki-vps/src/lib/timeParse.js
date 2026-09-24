const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDuration(input) {
  if (!input) return null;
  const matches = String(input).toLowerCase().matchAll(/(\d+)\s*(s|m|h|d|w)/g);
  let total = 0;
  let found = false;
  for (const [, amount, unit] of matches) {
    total += Number(amount) * UNIT_MS[unit];
    found = true;
  }
  return found ? total : null;
}

export function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const parts = [];
  for (const [unit, size] of [['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]]) {
    const n = Math.floor(ms / size);
    if (n > 0) {
      parts.push(`${n}${unit}`);
      ms -= n * size;
    }
  }
  return parts.join(' ');
}

export function wipeUnix({ year, month, day, hour, minute = 0 }) {

  const ms = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (Number.isNaN(ms)) return null;

  const d = new Date(ms);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return Math.floor(ms / 1000);
}

export function discordTime(unix, style = 'F') {
  return `<t:${unix}:${style}>`;
}
