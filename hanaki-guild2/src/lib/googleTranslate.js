const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * Translates via Google's public translate endpoint. No API key required.
 * Returns { text, from }, { rateLimited: true }, or null on other failures.
 */
export async function googleTranslate(text, target, timeoutMs) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: target,
    dt: 't',
    q: text,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) {
      console.error(`[translate] Google HTTP ${res.status}`);
      return null;
    }

    const body = await res.json();
    // Shape: [[["translated","original",...], ...], null, "detectedLang", ...]
    const chunks = body?.[0];
    if (!Array.isArray(chunks)) return null;

    const translated = chunks.map((c) => c?.[0] ?? '').join('').trim();
    const from = body?.[2] ?? null;
    if (!translated || !from) return null;

    return { text: translated, from };
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[translate] Google request failed:', err.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
