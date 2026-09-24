import { config } from '../config.js';
import { openRouterTranslate } from './openrouter.js';
import { googleTranslate } from './googleTranslate.js';

const LANGUAGE_NAMES = {
  af: 'Afrikaans', ar: 'Arabic', az: 'Azerbaijani', be: 'Belarusian', bg: 'Bulgarian',
  bn: 'Bengali', bs: 'Bosnian', ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish',
  de: 'German', el: 'Greek', en: 'English', eo: 'Esperanto', es: 'Spanish', et: 'Estonian',
  eu: 'Basque', fa: 'Persian', fi: 'Finnish', fr: 'French', ga: 'Irish', gl: 'Galician',
  he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian', hy: 'Armenian',
  id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese', ka: 'Georgian',
  kk: 'Kazakh', ko: 'Korean', ku: 'Kurdish', ky: 'Kyrgyz', la: 'Latin', lt: 'Lithuanian',
  lv: 'Latvian', mk: 'Macedonian', ms: 'Malay', mt: 'Maltese', nl: 'Dutch',
  no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian',
  sk: 'Slovak', sl: 'Slovenian', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish',
  sw: 'Swahili', ta: 'Tamil', th: 'Thai', tl: 'Filipino', tr: 'Turkish', uk: 'Ukrainian',
  ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', zh: 'Chinese', 'zh-CN': 'Chinese',
  'zh-TW': 'Chinese (Traditional)',
};

const LANGUAGE_FLAGS = {
  ar: '🇸🇦', bg: '🇧🇬', cs: '🇨🇿', da: '🇩🇰', de: '🇩🇪', el: '🇬🇷', en: '🇬🇧', es: '🇪🇸',
  et: '🇪🇪', fa: '🇮🇷', fi: '🇫🇮', fr: '🇫🇷', he: '🇮🇱', hi: '🇮🇳', hr: '🇭🇷', hu: '🇭🇺',
  id: '🇮🇩', it: '🇮🇹', ja: '🇯🇵', ko: '🇰🇷', lt: '🇱🇹', lv: '🇱🇻', ms: '🇲🇾', nl: '🇳🇱',
  no: '🇳🇴', pl: '🇵🇱', pt: '🇵🇹', ro: '🇷🇴', ru: '🇷🇺', sk: '🇸🇰', sl: '🇸🇮', sq: '🇦🇱',
  sr: '🇷🇸', sv: '🇸🇪', th: '🇹🇭', tl: '🇵🇭', tr: '🇹🇷', uk: '🇺🇦', ur: '🇵🇰', vi: '🇻🇳',
  zh: '🇨🇳', 'zh-CN': '🇨🇳', 'zh-TW': '🇹🇼',
};

export function languageName(code) {
  if (!code) return 'Unknown';
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES[code.split('-')[0]] ?? code.toUpperCase();
}

export function languageFlag(code) {
  if (!code) return '🌐';
  return LANGUAGE_FLAGS[code] ?? LANGUAGE_FLAGS[code.split('-')[0]] ?? '🌐';
}

/**
 * Strips the parts of a message that carry no translatable meaning and would
 * otherwise skew language detection: mentions, custom emoji, links, code blocks.
 */
export function stripNoise(content) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<@[!&]?\d+>/g, ' ')
    .replace(/<#\d+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the text is too short, too symbol-heavy, or too number-heavy for
 * language detection to be meaningful. Short chat like "gg" or "?" detects as
 * random languages, so we skip it.
 */
export function isTranslatable(text) {
  const cfg = config.translate ?? {};

  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return false;

  // Mostly punctuation/numbers/emoji -> not real prose.
  if (letters.length / text.length < (cfg.minLetterRatio ?? 0.4)) return false;

  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));

  // Sentences are the target: a real sentence carries enough context for both
  // accurate detection and a translation worth posting. Single words are
  // ambiguous ("голд", "gracias"), translate to noise, and still cost a request.
  const minWords = cfg.minWords ?? 2;

  // Non-Latin script (Cyrillic, CJK, Arabic, Greek, Hebrew, Thai...) is
  // unambiguously foreign, so it needs a far lower bar than Latin text.
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}\p{M}]/u.test(text)) {
    // Logographic scripts pack a whole sentence into very few characters and
    // are often written without spaces, so word count does not apply.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) {
      return letters.length >= (cfg.minLettersCjk ?? 3);
    }
    // Alphabetic non-Latin: want a phrase, or a single word long enough to be
    // more than chat filler.
    return words.length >= minWords || letters.length >= (cfg.minLettersNonLatin ?? 8);
  }

  // Latin script must look like a sentence, not a one-word reaction.
  if (words.length < minWords) return false;

  // Latin script: this is where English slang lives, so keep a floor to avoid
  // misfiring on "bruh", "lmao", "gg wp" and the like.
  if (text.length < (cfg.minLength ?? 6)) return false;
  if (letters.length < (cfg.minLetters ?? 4)) return false;

  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Requests are spaced out and serialised so a busy channel cannot burst past
// the provider quota. The gap adapts upward if we ever do get a 429.
let lastCall = 0;
let pending = 0;

// The gap adapts: it grows when we get rate-limited and decays back toward the
// configured floor on success, so a temporary clampdown does not stay costly.
let currentGap = null;

function baseGap() {
  return config.translate?.minRequestGapMs ?? 250;
}

function noteRateLimited() {
  const max = config.translate?.maxRequestGapMs ?? 4000;
  currentGap = Math.min(Math.max(currentGap ?? baseGap(), baseGap()) * 2, max);
}

function noteSuccess() {
  if (currentGap == null) return;
  const next = currentGap * 0.8;
  currentGap = next <= baseGap() ? null : next;
}

// Requests run through a small pool of lanes rather than one strict line, so
// model latency (~1-2s each) does not make the last reply in a burst land far
// too late. Each lane honours the shared gap, so spacing is preserved overall.
const lanes = [];

function laneCount() {
  return Math.max(1, config.translate?.concurrency ?? 3);
}

function enqueue(task) {
  // Under a flood, drop new work rather than building a backlog of replies
  // that would land long after the message they answer.
  const maxQueue = config.translate?.maxQueue ?? 40;
  if (pending >= maxQueue) {
    console.error(`[translate] queue full (${pending}), dropping request`);
    return Promise.resolve(null);
  }

  const want = laneCount();
  while (lanes.length < want) lanes.push(Promise.resolve());
  if (lanes.length > want) lanes.length = want;

  // Pick the lane expected to free up first.
  const idx = pending % lanes.length;

  pending++;
  const run = lanes[idx].then(async () => {
    // The gap is global across lanes, so overall request spacing is preserved.
    const gap = currentGap ?? baseGap();
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return task();
  });
  // Keep the lane alive even if this task throws.
  lanes[idx] = run.catch(() => {}).finally(() => { pending--; });
  return run;
}

// When rate-limited we stop sending entirely until the limit clears, rather
// than hammering the provider. `penaltyUntil` gates every request so queued
// messages wait behind one shared pause instead of each retrying separately.
let penaltyUntil = 0;
let penaltyStep = 0;

function penaltyRemaining() {
  return Math.max(0, penaltyUntil - Date.now());
}

function enterPenalty() {
  const cfg = config.translate ?? {};
  const base = cfg.penaltyBaseMs ?? 10000;
  const max = cfg.penaltyMaxMs ?? 120000;
  const wait = Math.min(base * 2 ** penaltyStep, max);
  penaltyStep++;
  penaltyUntil = Date.now() + wait;
  console.error(`[translate] rate-limited — pausing ${Math.round(wait / 1000)}s before retrying`);
  return wait;
}

function clearPenalty() {
  if (penaltyStep === 0) return;
  penaltyStep = 0;
  penaltyUntil = 0;
  console.log('[translate] rate limit cleared, resuming');
}

/**
 * Tries Google first (free, fast, reliable on sentences) and falls back to
 * OpenRouter only when Google fails outright. A Google rate limit is reported
 * up to the caller so the penalty gate can pause, but the fallback still gets
 * a chance first so the message is answered now rather than late.
 */
async function requestOnce(text, target, timeoutMs) {
  const cfg = config.translate ?? {};
  const useGoogle = cfg.useGoogle !== false;
  const useOpenRouter = cfg.useOpenRouter !== false && !!process.env.OPENROUTER_API_KEY;

  let googleRateLimited = false;

  if (useGoogle) {
    const result = await googleTranslate(text, target, timeoutMs);
    if (result && !result.rateLimited) return result;
    googleRateLimited = !!result?.rateLimited;
  }

  if (useOpenRouter) {
    const result = await openRouterTranslate(text, target, timeoutMs);
    if (result && !result.rateLimited) {
      if (googleRateLimited) console.log('[translate] Google limited, used OpenRouter fallback');
      return result;
    }
    // Both providers are unavailable: report the limit so we pause.
    if (result?.rateLimited || googleRateLimited) return { rateLimited: true };
    return null;
  }

  return googleRateLimited ? { rateLimited: true } : null;
}

/**
 * Translates one message, preferring Google and falling back to OpenRouter.
 *
 * On rate limit it waits out a global cooldown and keeps retrying rather than
 * giving up, so a message is translated late instead of not at all. Returns
 * null only on a hard failure or when the message waited longer than
 * `maxWaitMs` (by which point a reply would be pointless).
 */
export async function translate(text, target = 'en') {
  const cfg = config.translate ?? {};
  const timeoutMs = cfg.timeoutMs ?? 6000;
  const maxWaitMs = cfg.maxWaitMs ?? 180000;
  const deadline = Date.now() + maxWaitMs;

  return enqueue(async () => {
    while (true) {
      // Respect an active penalty before spending a request.
      const remaining = penaltyRemaining();
      if (remaining > 0) {
        if (Date.now() + remaining > deadline) {
          console.error('[translate] still rate-limited past max wait, dropping message');
          return null;
        }
        await sleep(remaining);
      }

      const result = await requestOnce(text, target, timeoutMs);

      if (result && !result.rateLimited) {
        clearPenalty();
        noteSuccess();
        return result;
      }
      if (!result) return null; // hard failure, retrying will not help

      // Rate-limited: widen the steady-state gap and pause everyone.
      noteRateLimited();
      const wait = enterPenalty();
      if (Date.now() + wait > deadline) {
        console.error('[translate] rate limit outlasted max wait, dropping message');
        return null;
      }
      lastCall = Date.now();
    }
  });
}
