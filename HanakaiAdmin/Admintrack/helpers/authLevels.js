/**
 * Discover the admin/moderator roster from the server itself.
 *
 * Rust's `getauthlevels` reports who holds ownerid (auth 2) and moderatorid
 * (auth 1). Reading it beats a hardcoded name list on every count: it survives
 * renames, picks up staff added after deploy, carries SteamID64s (which cannot
 * be changed), and tells us the *level* rather than just "is staff".
 *
 * Output format varies across server builds and Oxide versions, so the parser
 * accepts several shapes rather than assuming one, and falls back to scraping
 * any 17-digit ID it can find.
 */

const { sendRconCommand } = require('./rcon');

const AUTH_LABELS = {
    2: 'Owner',
    1: 'Moderator',
    0: 'Player'
};

/**
 * Parse a `getauthlevels` response into structured entries.
 *
 * Handles the common layouts:
 *   "76561198012345678" "PlayerName" 2
 *   76561198012345678/PlayerName/2
 *   Level 2: 76561198012345678 (PlayerName)
 *   76561198012345678 PlayerName
 *
 * @param {string} response Raw console output
 * @returns {Array<{steamId: string, name: string|null, level: number}>}
 */
function parseAuthLevels(response) {
    if (!response || typeof response !== 'string') return [];

    const entries = [];
    const seen = new Set();

    // A "Level N:" / "Owner" / "Moderator" header applies to the lines beneath
    // it in grouped output.
    let currentHeaderLevel = null;

    // Some builds return the whole listing as one line containing literal
    // backslash-n characters rather than real newlines. Normalise both, so the
    // same line-oriented logic handles either.
    const normalised = response.replace(/\\r\\n|\\n|\\r/g, '\n');

    for (const rawLine of normalised.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        // Grouped header, e.g. "Auth Level 2:" / "Level 1"
        const header = line.match(/^(?:auth\s*)?level\s*(\d)\s*:?\s*$/i);
        if (header) {
            currentHeaderLevel = parseInt(header[1], 10);
            continue;
        }

        // Word-form headers: a bare "Owner" / "Moderator" line labels the
        // names that follow. This is the shape Rust actually returns.
        const wordHeader = line.match(/^(owner|moderator|mod|admin)s?\s*:?\s*$/i);
        if (wordHeader) {
            currentHeaderLevel = /^owner/i.test(wordHeader[1]) ? 2 : 1;
            continue;
        }

        // Skip the console's echo of the command itself.
        if (/^(?:log|executing|console system command|getauthlevels)\b/i.test(line)) continue;
        if (/executing console system command/i.test(line)) continue;

        // A SteamID64 when present, but it is optional: the common format
        // lists bare names under a header with no IDs at all.
        const idMatch = line.match(/\b(7656\d{13})\b/);
        const steamId = idMatch ? idMatch[1] : null;

        // Bare-name line under a header — no ID, nothing else to parse.
        if (!steamId) {
            // Only trust these while a header has told us the level; a stray
            // line outside any section is not a roster entry.
            if (currentHeaderLevel == null) continue;

            const name = line.replace(/^[-*•\s]+/, '').trim();
            // Reject anything that looks structural rather than like a name.
            if (!name || name.length > 64 || /[:{}\[\]]/.test(name)) continue;

            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            entries.push({
                steamId: null,
                name,
                level: currentHeaderLevel,
                label: AUTH_LABELS[currentHeaderLevel] || `Auth ${currentHeaderLevel}`
            });
            continue;
        }

        // Name: prefer a quoted string, else parenthesised, else the token
        // sitting next to the id once the id and stray separators are removed.
        let name = null;
        const quoted = line.match(/"([^"]+)"/g);
        if (quoted) {
            // Skip a quoted value that is just the id repeated.
            const candidate = quoted
                .map(q => q.replace(/"/g, '').trim())
                .find(q => q && !/^\d{17}$/.test(q));
            if (candidate) name = candidate;
        }
        if (!name) {
            const paren = line.match(/\(([^)]+)\)/);
            if (paren && !/^\d{17}$/.test(paren[1].trim())) name = paren[1].trim();
        }
        if (!name) {
            const leftover = line
                .replace(steamId, ' ')
                .replace(/[\/,:|]+/g, ' ')
                .replace(/\b\d\b/g, ' ')      // bare auth level digit
                .replace(/\b(?:auth|level|owner|moderator|user)\b/gi, ' ')
                .trim();
            if (leftover) name = leftover.replace(/\s+/g, ' ');
        }

        // Level: an explicit trailing/labelled digit wins over the group header.
        let level = currentHeaderLevel;
        const explicit =
            line.match(/(?:level|auth)\s*[:=]?\s*(\d)\b/i) ||
            line.match(/[\/|,]\s*(\d)\s*$/) ||
            line.match(/\s(\d)\s*$/);
        if (explicit) level = parseInt(explicit[1], 10);

        // Word forms, when the build prints those instead of a digit.
        if (level == null) {
            if (/\bowner\b/i.test(line)) level = 2;
            else if (/\bmoderator\b|\bmod\b/i.test(line)) level = 1;
        }

        if (level == null) level = 1; // present in the list at all ⇒ staff

        // Namespaced so an id-keyed entry cannot collide with a name-keyed one.
        if (seen.has(steamId)) continue;
        seen.add(steamId);
        if (name) seen.add(name.toLowerCase());

        entries.push({
            steamId,
            name: name || null,
            level,
            label: AUTH_LABELS[level] || `Auth ${level}`
        });
    }

    return entries;
}

/**
 * Query one server for its admin roster.
 *
 * @param {{host,port,password}} rconConfig
 * @returns {Promise<Array<{steamId,name,level,label}>>}
 */
async function fetchAuthLevels(rconConfig) {
    const response = await sendRconCommand(rconConfig, 'getauthlevels');
    return parseAuthLevels(response);
}

module.exports = {
    parseAuthLevels,
    fetchAuthLevels,
    AUTH_LABELS
};
