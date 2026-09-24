const TLDS = [
  'com', 'net', 'org', 'io', 'gg', 'co', 'me', 'tv', 'gl', 'ly', 'be', 'cc', 'to', 'ws',
  'uk', 'us', 'ca', 'de', 'fr', 'nl', 'ru', 'su', 'eu', 'info', 'biz', 'xyz', 'app', 'dev',
  'site', 'online', 'store', 'shop', 'link', 'click', 'top', 'pro', 'vip', 'club', 'live',
  'fun', 'space', 'icu', 'tk', 'ml', 'ga', 'cf', 'gq',
];

const PATTERNS = [
  /\b(?:https?|ftp):\/\/\S+/i,
  /\bwww\.\S+/i,
  new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLDS.join('|')})\\b(?:[\\/?#]\\S*)?`, 'i'),
];

// Catches "discord dot gg" / "discord(dot)gg" style evasion.
function deobfuscate(text) {
  return text.replace(/\s*[([{]?\s*\bdot\b\s*[)\]}]?\s*/gi, '.');
}

export function findLink(content) {
  if (!content) return null;
  for (const text of [content, deobfuscate(content)]) {
    for (const pattern of PATTERNS) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
  }
  return null;
}
