import { config } from '../config.js';
import { simple } from './cv2.js';
import { isStaff } from './staff.js';
import {
  translate,
  stripNoise,
  isTranslatable,
  languageName,
  languageFlag,
} from './translate.js';

const cooldowns = new Map(); // `${guildId}:${userId}` -> timestamp

function onCooldown(guildId, userId, ms) {
  if (ms <= 0) return false;
  const key = `${guildId}:${userId}`;
  const last = cooldowns.get(key) ?? 0;
  const now = Date.now();
  if (now - last < ms) return true;
  cooldowns.set(key, now);
  return false;
}

// Keep the cooldown map from growing without bound on a busy server.
setInterval(() => {
  const cutoff = Date.now() - 600000;
  for (const [key, ts] of cooldowns) if (ts < cutoff) cooldowns.delete(key);
}, 600000).unref();

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

let warnedNoKey = false;

export async function handleAutoTranslate(message) {
  const cfg = config.translate ?? {};
  if (!cfg.enabled) return;

  if (!process.env.OPENROUTER_API_KEY) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.error(
        '[translate] OPENROUTER_API_KEY is not set — auto-translation is disabled.\n' +
          '            Add it to .env (get a key at https://openrouter.ai/keys),\n' +
          '            or set "translate.enabled": false in config.json to silence this.',
      );
    }
    return;
  }

  const target = cfg.targetLanguage ?? 'en';

  // Channel scoping: allowlist wins if set, otherwise everything minus ignores.
  const allow = cfg.channelIds ?? [];
  const ignore = cfg.ignoreChannelIds ?? [];
  if (allow.length > 0 && !allow.includes(message.channel.id)) return;
  if (ignore.includes(message.channel.id)) return;

  if (cfg.ignoreStaff && isStaff(message.member)) return;

  const cleaned = stripNoise(message.content ?? '');
  if (!isTranslatable(cleaned)) return;

  if (onCooldown(message.guild.id, message.author.id, cfg.cooldownMs ?? 10000)) return;

  const result = await translate(truncate(cleaned, cfg.maxInputLength ?? 900), target);
  if (!result) return;

  // Already in the target language — nothing worth posting.
  const base = result.from.split('-')[0];
  if (base === target.split('-')[0]) return;

  if ((cfg.ignoreLanguages ?? []).includes(base)) return;

  // If the "translation" is basically the original, detection was wrong.
  if (result.text.trim().toLowerCase() === cleaned.trim().toLowerCase()) return;

  const flag = languageFlag(result.from);
  const from = languageName(result.from);
  const to = languageName(target);

  const lines = [
    `${flag} **${from}** → **${to}**`,
    truncate(result.text, 1500),
  ];

  await message
    .reply({
      ...simple({ accent: config.colors.primary, lines }),
      allowedMentions: { repliedUser: false },
    })
    .catch((err) => console.error('[translate] reply failed:', err.message));
}
