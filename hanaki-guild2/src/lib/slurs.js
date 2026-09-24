import { findMatch } from './blacklist.js';

/**
 * Racial and ethnic slurs, matched separately from the general blacklist.
 *
 * Held here rather than in `blacklist.json` for two reasons: they are not
 * editable at runtime (a slur list should not be one `/blacklist remove` away
 * from being switched off), and they get their own response while the
 * configurable blacklist keeps its milder "that word was removed" notice.
 *
 * Matching reuses findMatch() from blacklist.js, so leetspeak substitution
 * (n1gg3r) and Unicode normalisation are handled identically.
 */
const SLURS = [
  // Anti-Black
  'nigger', 'niger', 'nigga', 'niggah', 'niggers', 'niggas', 'coon',
  'jigaboo', 'porchmonkey', 'tarbaby', 'spearchucker',
  // Anti-Hispanic/Latino
  'spic', 'spick', 'wetback', 'beaner',
  // Anti-Asian
  'chink', 'chinky', 'gook', 'slopehead', 'zipperhead', 'dothead',
  // Antisemitic
  'kike', 'heeb', 'hymie',
  // Anti-Arab / Muslim / South Asian
  'towelhead', 'sandnigger', 'raghead', 'cameljockey', 'currymuncher', 'pajeet',
  'muzzie',
  // Anti-Indigenous
  'redskin', 'injun', 'squaw', 'prairienigger', 'timbernigger', 'wagonburner',
  // Anti-Roma / Traveller
  'gyppo', 'gypo',
  // Anti-Pacific Islander / other ethnic
  'boong', 'coonass', 'kanaka', 'wog', 'wop', 'dago', 'polack', 'golliwog',
  'honky', 'roundeye',
];

/**
 * Words that legitimately CONTAIN a slur as a substring.
 *
 * Substring matching is what catches padded evasions ("aaaniggerbbb"), but it
 * also flags ordinary English: "niggardly" (stingy), "snigger" (to laugh),
 * "Scunthorpe". Checking these first means a real word is never punished.
 * Compare against the same normalised form the matcher uses.
 */
const ALLOWLIST = [
  'niggard', 'niggardly', 'niggardliness', 'snigger', 'sniggered', 'sniggering',
  'sniggers', 'renege', 'reneged', 'reneges', 'reneging', 'nigeria', 'nigerian',
  'nigerien', 'niger', 'cooning', 'cocoon', 'cocoons', 'raccoon', 'raccoons',
  'tycoon', 'tycoons', 'lagoon', 'lagoons', 'spicy', 'spice', 'spices', 'spiced',
  'suspicion', 'suspicious', 'auspicious', 'conspicuous', 'despicable',
  'wogan', 'swop', 'swops', 'dagos',
];

const LEET = {
  '@': 'a', '4': 'a', '8': 'b', '(': 'c', '3': 'e', '6': 'g',
  '1': 'i', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '2': 'z',
};

// Mirrors normalize() in blacklist.js so the allowlist sees the same text the
// matcher does — otherwise "n1ggardly" would slip past the allowlist.
function normalizeTokens(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Return the matched slur, or null.
 *
 * Two passes, because neither alone is right:
 *   1. Word mode — exact tokens. No false positives, but misses padding.
 *   2. Substring mode — catches padding, but only once every token that could
 *      explain the hit has been cleared by the allowlist.
 */
export function findSlur(content) {
  if (!content) return null;

  const wordHit = findMatch(content, SLURS, 'word');
  if (wordHit) return wordHit;

  const tokens = normalizeTokens(content);
  // A token that is a known innocent word cannot be the basis of a match, so
  // drop it before the substring pass rather than after.
  const suspect = tokens.filter((t) => !ALLOWLIST.includes(t));
  if (!suspect.length) return null;

  return findMatch(suspect.join(' '), SLURS, 'substring');
}

export function slurCount() {
  return SLURS.length;
}
