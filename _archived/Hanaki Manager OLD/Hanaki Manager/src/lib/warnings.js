import { read, update } from './store.js';

const STORE = 'warnings';

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function getWarnings(guildId, userId) {
  const all = read(STORE, {});
  return all[key(guildId, userId)] ?? [];
}

export function addWarning(guildId, userId, reason, moderatorId) {
  const entry = { id: Date.now().toString(36), reason, moderatorId, at: Date.now() };
  update(STORE, {}, (all) => {
    const k = key(guildId, userId);
    all[k] = [...(all[k] ?? []), entry];
    return all;
  });
  return getWarnings(guildId, userId);
}

export function clearWarnings(guildId, userId) {
  let removed = 0;
  update(STORE, {}, (all) => {
    const k = key(guildId, userId);
    removed = all[k]?.length ?? 0;
    delete all[k];
    return all;
  });
  return removed;
}
