import { read, update } from './store.js';

const STORE = 'tags';

function norm(trigger) {
  return String(trigger).trim().toLowerCase().replace(/^!+/, '');
}

export function getTag(guildId, trigger) {
  const all = read(STORE, {});
  return all[guildId]?.[norm(trigger)] ?? null;
}

export function setTag(guildId, trigger, response) {
  const key = norm(trigger);
  update(STORE, {}, (all) => {
    all[guildId] ??= {};
    all[guildId][key] = response;
    return all;
  });
}

export function removeTag(guildId, trigger) {
  const key = norm(trigger);
  let existed = false;
  update(STORE, {}, (all) => {
    if (all[guildId]?.[key] !== undefined) {
      existed = true;
      delete all[guildId][key];
    }
    return all;
  });
  return existed;
}

export function listTags(guildId) {
  const all = read(STORE, {});
  return Object.keys(all[guildId] ?? {}).sort();
}
