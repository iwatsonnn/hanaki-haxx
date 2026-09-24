import { read, update } from './store.js';

const WORDS = 'blacklist';
const VIOLATIONS = 'blacklistViolations';

const LEET = {
  '@': 'a', '4': 'a', '8': 'b', '(': 'c', '3': 'e', '6': 'g',
  '1': 'i', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '2': 'z',
};

function normalize(text) {

  return text
    .toLowerCase()
    .normalize('NFKD')
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('');
}

export function getWords(guildId) {
  const all = read(WORDS, {});
  return all[guildId] ?? [];
}

export function addWord(guildId, word) {
  const w = word.trim().toLowerCase();
  let added = false;
  update(WORDS, {}, (all) => {
    const list = all[guildId] ?? [];
    if (!list.includes(w)) {
      list.push(w);
      added = true;
    }
    all[guildId] = list;
    return all;
  });
  return added;
}

export function removeWord(guildId, word) {
  const w = word.trim().toLowerCase();
  let removed = false;
  update(WORDS, {}, (all) => {
    const list = all[guildId] ?? [];
    const next = list.filter((x) => x !== w);
    removed = next.length !== list.length;
    all[guildId] = next;
    return all;
  });
  return removed;
}

export function findMatch(content, words, mode = 'word') {
  if (!words.length) return null;
  const normContent = normalize(content);
  const tokens = normContent.split(/[^a-z0-9]+/).filter(Boolean);
  const collapsed = normContent.replace(/[^a-z0-9]/g, '');

  for (const word of words) {
    const nw = normalize(word).replace(/[^a-z0-9]/g, '');
    if (!nw) continue;
    if (mode === 'substring') {
      if (collapsed.includes(nw)) return word;
    } else if (tokens.includes(nw)) {
      return word;
    }
  }
  return null;
}

export function bumpViolation(guildId, userId) {
  const key = `${guildId}:${userId}`;
  let count = 0;
  update(VIOLATIONS, {}, (all) => {
    count = (all[key] ?? 0) + 1;
    all[key] = count;
    return all;
  });
  return count;
}

export function resetViolation(guildId, userId) {
  const key = `${guildId}:${userId}`;
  update(VIOLATIONS, {}, (all) => {
    delete all[key];
    return all;
  });
}
