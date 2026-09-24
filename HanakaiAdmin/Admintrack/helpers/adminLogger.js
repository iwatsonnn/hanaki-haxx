const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { RconListener } = require('./rconListener');
const { classify } = require('./adminLogParse');
const { fetchAuthLevels } = require('./authLevels');
const { getAllConfigs } = require('./config');

/**
 * Admin action logging.
 *
 * Opens a persistent RCON listener per configured server, classifies every
 * console line, and mirrors it to (a) a Discord channel for staff to read and
 * (b) a JSONL file on disk as the tamper-evident record.
 *
 * Discord is the convenience copy — it is rate-limited, editable and
 * deletable. The JSONL file is the copy that actually matters for an
 * investigation, so it is written first and always, even when Discord fails.
 */

// Where audit lines land. One file per UTC day keeps them greppable and stops
// a single file from growing without bound.
const LOG_DIR = path.join(__dirname, '..', 'data', 'adminlogs');

// Channel that receives the readable feed. Per-server override:
// ADMIN_LOG_CHANNEL_EU, ADMIN_LOG_CHANNEL_AU_3X, … else ADMIN_LOG_CHANNEL.
const DEFAULT_LOG_CHANNEL = process.env.ADMIN_LOG_CHANNEL;

// Optional second channel for critical-only events, so the important things
// aren't buried under routine console noise.
const ALERT_CHANNEL = process.env.ADMIN_ALERT_CHANNEL;

/**
 * The admin roster, discovered from each server via `getauthlevels` rather
 * than hardcoded. Staff actions get flagged 👁️ and mirrored to the alert
 * channel regardless of severity.
 *
 * Sourcing this from the server means it survives renames, picks up staff
 * added after deploy, and keys on SteamID64 — which, unlike a name, cannot be
 * changed to slip off the list.
 *
 * This narrows *attention*, never what gets recorded: everyone is still logged
 * in full, so a player who is not staff is captured exactly the same. That is
 * why the unmatched-line catch-all in adminLogParse.js stays.
 *
 * ADMIN_LOG_WATCHLIST in .env adds extra names/IDs on top of what the server
 * reports — useful for staff who hold no in-game auth level.
 */
const EXTRA_WATCHLIST = (process.env.ADMIN_LOG_WATCHLIST || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Log only staff actions, discarding ordinary player activity.
 *
 * Note the tradeoff this buys: staff are matched by the roster `getauthlevels`
 * reports, and when that roster carries no SteamIDs (as ours does), matching is
 * by name alone. Someone who renames is no longer recognised as staff, so their
 * actions are dropped rather than merely unflagged — until the next roster
 * refresh picks the new name up.
 *
 * Set ADMIN_LOG_STAFF_ONLY=false to record everyone again.
 */
const STAFF_ONLY = process.env.ADMIN_LOG_STAFF_ONLY !== 'false';

// serverKey -> Map<steamId, {steamId, name, level, label}>
const rosters = new Map();

// How often to re-query each server's auth levels. Staff changes are rare, so
// this is about catching them eventually, not promptly.
const ROSTER_REFRESH_MS = Number(process.env.ADMIN_ROSTER_REFRESH_MS || 15 * 60 * 1000);
let rosterTimer = null;

/**
 * Flattened lookup set: every SteamID and name currently considered staff,
 * lowercased, across all servers plus the .env extras.
 */
function watchTerms() {
    const terms = new Set(EXTRA_WATCHLIST);
    for (const roster of rosters.values()) {
        for (const entry of roster.values()) {
            // steamId is null when the server lists staff by name only.
            if (entry.steamId) terms.add(entry.steamId.toLowerCase());
            if (entry.name) terms.add(entry.name.toLowerCase());
        }
    }
    return terms;
}

/**
 * Look up a known staff entry for labelling events.
 *
 * Matches on SteamID when we have one, and otherwise on name — `getauthlevels`
 * commonly reports bare names with no IDs at all, and a name is then the only
 * handle available.
 */
function staffEntry(actor) {
    if (!actor) return null;
    const steamId = typeof actor === 'string' ? actor : actor.steamId;
    const name = typeof actor === 'string' ? null : actor.name;

    for (const roster of rosters.values()) {
        if (steamId) {
            const hit = roster.get(steamId);
            if (hit) return hit;
        }
        if (name) {
            const needle = name.toLowerCase();
            for (const entry of roster.values()) {
                if (entry.name && entry.name.toLowerCase() === needle) return entry;
            }
        }
    }
    return null;
}

// Discord allows ~5 messages per 5s per channel. Batching well under that
// keeps a busy wipe-day server from getting the bot rate-limited into
// dropping lines.
const FLUSH_INTERVAL_MS = 5000;
const MAX_LINES_PER_EMBED = 15;

// Hard cap on the pending queue. A server dumping thousands of lines a second
// must not grow the buffer until the process runs out of memory — past this
// we drop and record how many were dropped.
const MAX_QUEUE = 500;

// Minimum severity mirrored to Discord. Everything reaches disk regardless.
//
// Defaults to 0 (everything) because the channel feed is now the only view
// staff have — there is no lookup command to recover an event that was
// filtered out here. Raise to 1 in .env if the channel proves too noisy.
const DISCORD_MIN_RANK = Number(process.env.ADMIN_LOG_MIN_RANK ?? 0);

const SEVERITY_COLOR = {
    critical: 0xED4245,
    high: 0xE67E22,
    normal: 0x3498DB,
    low: 0x95A5A6
};

const listeners = new Map();   // serverKey -> RconListener
const queues = new Map();      // serverKey -> pending event array
const dropped = new Map();     // serverKey -> count dropped since last flush
let flushTimer = null;
let botClient = null;

/* ------------------------------------------------------------------ disk */

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function logFilePath(date = new Date()) {
    return path.join(LOG_DIR, `${date.toISOString().slice(0, 10)}.jsonl`);
}

/**
 * Append one event to today's audit file.
 *
 * Synchronous and append-only on purpose: if the process dies mid-incident the
 * lines already written are on disk, and appends from a single process cannot
 * interleave into a corrupt record.
 */
function writeToDisk(event) {
    try {
        ensureLogDir();
        fs.appendFileSync(logFilePath(), JSON.stringify(event) + '\n', 'utf8');
    } catch (error) {
        // Never let a disk problem kill the listener — the Discord copy is
        // still going out, and a crashed logger logs nothing at all.
        console.error('[ADMINLOG] Failed writing audit line:', error.message);
    }
}

/* --------------------------------------------------------------- helpers */

/**
 * Is this event connected to a watched admin?
 *
 * Checks the parsed actor *and* the raw line. Matching the raw line as well
 * matters for two cases the actor alone misses: a watched admin appearing as
 * the target of someone else's command ("X gave <admin> …"), and lines whose
 * format the actor-parser doesn't recognise.
 *
 * Substring rather than equality, because Rust names arrive wrapped in clan
 * tags and decoration ("[SAT] MyScriptsAreGood") that an exact match drops.
 * A false 👁️ on a similar name is cheap; a miss is not.
 */
function isWatched(actor, raw = '') {
    const terms = watchTerms();
    if (!terms.size) return false;

    // A SteamID hit is exact and unambiguous — check it before falling back to
    // fuzzy name matching.
    if (actor?.steamId && terms.has(actor.steamId.toLowerCase())) return true;

    const haystack = [
        actor?.name || '',
        actor?.steamId || '',
        raw
    ].join(' ').toLowerCase();

    if (!haystack.trim()) return false;

    // Substring, because Rust names arrive wrapped in clan tags and decoration
    // ("[SAT] Beamedbyfb") that an exact match would drop. Matching the raw
    // line too catches staff named as the *target* of someone else's command.
    // A false 👁️ on a similar name is cheap; a miss is not.
    for (const term of terms) {
        if (term.length < 3) continue; // too short to match meaningfully
        if (haystack.includes(term)) return true;
    }
    return false;
}

function channelIdFor(serverKey) {
    const envKey = `ADMIN_LOG_CHANNEL_${serverKey.toUpperCase()}`;
    return process.env[envKey] || DEFAULT_LOG_CHANNEL;
}

/** Truncate for safe embedding — Discord field values cap at 1024 chars. */
function clip(text, max = 1000) {
    const s = String(text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function describeActor(actor) {
    if (!actor) return 'unknown';

    // Annotate with the auth level the server reports, so a reader can tell an
    // Owner action from a Moderator one without cross-referencing.
    const staff = staffEntry(actor);
    const rank = staff ? ` [${staff.label}]` : '';

    if (actor.name && actor.steamId) return `${actor.name} (${actor.steamId})${rank}`;
    if (actor.name) return `${actor.name}${rank}`;
    if (actor.steamId) return `${actor.steamId}${rank}`;
    return 'unknown';
}

/* -------------------------------------------------------------- dispatch */

/** One embed for a single high-signal event. */
function buildEventEmbed(event, serverName) {
    const embed = new EmbedBuilder()
        .setTitle(`${event.emoji} ${event.label}${event.watched ? ' 👁️' : ''}`)
        .setColor(SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.low)
        .setDescription('```\n' + clip(event.raw, 1800) + '\n```')
        .setFooter({ text: `${serverName} • ${event.severity}` })
        .setTimestamp(new Date(event.at));

    const actorText = describeActor(event.actor);
    if (actorText !== 'unknown') {
        embed.addFields({ name: 'Actor', value: clip(actorText, 256), inline: true });
    }

    if (event.fields) {
        for (const [name, value] of Object.entries(event.fields)) {
            if (value == null || value === '') continue;
            embed.addFields({ name, value: clip(value, 256), inline: true });
        }
    }

    return embed;
}

/** One embed summarising a batch of lower-signal events. */
function buildBatchEmbed(events, serverName) {
    const lines = events.map(e => {
        const who = describeActor(e.actor);
        const prefix = who === 'unknown' ? '' : `${who} — `;
        return `${e.emoji} ${prefix}${e.raw}`;
    });

    const body = lines.join('\n');

    return new EmbedBuilder()
        .setTitle(`📋 Server Activity — ${events.length} event${events.length === 1 ? '' : 's'}`)
        .setColor(SEVERITY_COLOR.low)
        .setDescription('```\n' + clip(body, 3800) + '\n```')
        .setFooter({ text: serverName })
        .setTimestamp(new Date());
}

async function sendToChannel(channelId, embeds) {
    if (!channelId || !botClient || !embeds.length) return;

    const channel = await botClient.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        console.error(`[ADMINLOG] Channel ${channelId} unreachable — check id/permissions.`);
        return;
    }

    // Discord caps at 10 embeds per message.
    for (let i = 0; i < embeds.length; i += 10) {
        try {
            await channel.send({ embeds: embeds.slice(i, i + 10) });
        } catch (error) {
            console.error(`[ADMINLOG] Could not post to ${channelId}:`, error.message);
        }
    }
}

/**
 * Flush every server's queue to Discord.
 *
 * High-signal events get their own embed so they're readable at a glance;
 * everything else is rolled into one batch embed to stay within rate limits.
 */
async function flush() {
    for (const [serverKey, queue] of queues.entries()) {
        if (!queue.length) {
            // Still report drops even when the queue emptied.
            if ((dropped.get(serverKey) || 0) > 0) await reportDrops(serverKey);
            continue;
        }

        const events = queue.splice(0, queue.length);
        const serverName = getAllConfigs()[serverKey]?.name || serverKey;

        const visible = events.filter(
            e => e.severityRank >= DISCORD_MIN_RANK || e.watched
        );

        const individual = visible.filter(e => e.severityRank >= 2 || e.watched);
        const batched = visible.filter(e => e.severityRank < 2 && !e.watched);

        const embeds = individual.map(e => buildEventEmbed(e, serverName));

        for (let i = 0; i < batched.length; i += MAX_LINES_PER_EMBED) {
            embeds.push(buildBatchEmbed(batched.slice(i, i + MAX_LINES_PER_EMBED), serverName));
        }

        await sendToChannel(channelIdFor(serverKey), embeds);

        // Critical + watchlist events also go to the alert channel.
        const alerts = events.filter(e => e.severity === 'critical' || e.watched);
        if (ALERT_CHANNEL && alerts.length) {
            await sendToChannel(ALERT_CHANNEL, alerts.map(e => buildEventEmbed(e, serverName)));
        }

        if ((dropped.get(serverKey) || 0) > 0) await reportDrops(serverKey);
    }
}

/**
 * Announce dropped lines loudly. A silent gap in an audit trail is worse than
 * a noisy one — staff need to know the record is incomplete.
 */
async function reportDrops(serverKey) {
    const count = dropped.get(serverKey) || 0;
    if (!count) return;
    dropped.set(serverKey, 0);

    const serverName = getAllConfigs()[serverKey]?.name || serverKey;
    console.error(`[ADMINLOG] ${serverName}: dropped ${count} lines (queue overflow)`);

    writeToDisk({
        at: new Date().toISOString(),
        server: serverKey,
        id: 'log_gap',
        label: 'Audit Gap',
        severity: 'critical',
        raw: `Log queue overflowed — ${count} console lines were not recorded.`
    });

    const embed = new EmbedBuilder()
        .setTitle('⚠️ Audit Gap')
        .setColor(SEVERITY_COLOR.critical)
        .setDescription(
            `**${count}** console line${count === 1 ? '' : 's'} from **${serverName}** were dropped ` +
            'because the log queue overflowed. The audit trail for this period is incomplete.'
        )
        .setTimestamp(new Date());

    await sendToChannel(ALERT_CHANNEL || channelIdFor(serverKey), [embed]);
}

/* ---------------------------------------------------------------- intake */

/**
 * Events with no player behind them — server saves, restarts, plugin loads,
 * RCON state. These are kept even in staff-only mode: they are not "some
 * player's activity" to filter out, and losing them would hide the server
 * state changes an investigation depends on.
 */
const SERVER_LEVEL_EVENTS = new Set([
    'server_state',
    'plugin',
    'destructive',
    'env',
    'entity_spawn',
    'rcon_up',
    'rcon_down',
    'log_gap',
    'auth_granted',
    'auth_revoked',
    'bot_command'
]);

function handleLine(serverKey, { message }) {
    const classified = classify(message);
    if (!classified) return; // known noise

    const watched = isWatched(classified.actor, classified.raw);

    // Staff-only mode: drop anything not tied to a known admin/mod/owner.
    // Server-level events stay, since they have no actor to match against.
    //
    // Skipped entirely until a roster has loaded: filtering against an empty
    // roster would silently discard *everything*, including the staff actions
    // in the window between the listener connecting and getauthlevels
    // returning. Log through, rather than lose that window.
    if (STAFF_ONLY && rosters.size > 0 && !watched &&
        !SERVER_LEVEL_EVENTS.has(classified.id)) {
        return;
    }

    const event = {
        at: new Date().toISOString(),
        server: serverKey,
        ...classified,
        watched
    };

    // Disk first, unconditionally — this is the copy that must survive.
    writeToDisk(event);

    const queue = queues.get(serverKey);
    if (!queue) return;

    if (queue.length >= MAX_QUEUE) {
        dropped.set(serverKey, (dropped.get(serverKey) || 0) + 1);
        return;
    }
    queue.push(event);
}

/**
 * Record a command this bot ran itself (e.g. !hammer1).
 *
 * These never appear in the console feed — they are our own RCON calls, not
 * server output — so without this they would be the one class of admin action
 * the audit trail misses. Always treated as critical: a Discord-triggered
 * console command is exactly what an investigation needs to see.
 *
 * @param {{server: string, command: string, actorName: string, actorId?: string, label?: string}} opts
 */
function logManualCommand({ server, command, actorName, actorId = null, label = 'Bot Command' }) {
    const event = {
        at: new Date().toISOString(),
        server,
        id: 'bot_command',
        label,
        emoji: '🤖',
        severity: 'critical',
        severityRank: 3,
        raw: `${actorName} ran via Discord: ${command}`,
        actor: { name: actorName, steamId: null, discordId: actorId },
        fields: { Command: command, Source: 'Discord' },
        watched: isWatched({ name: actorName }, actorName)
    };

    writeToDisk(event);

    const queue = queues.get(server);
    if (!queue) return; // logging not running for this server — disk copy stands

    if (queue.length >= MAX_QUEUE) {
        dropped.set(server, (dropped.get(server) || 0) + 1);
        return;
    }
    queue.push(event);
}

async function announceConnection(serverKey, up, reason) {
    const serverName = getAllConfigs()[serverKey]?.name || serverKey;

    writeToDisk({
        at: new Date().toISOString(),
        server: serverKey,
        id: up ? 'rcon_up' : 'rcon_down',
        label: up ? 'RCON Connected' : 'RCON Disconnected',
        severity: up ? 'normal' : 'critical',
        raw: up ? 'Log listener connected.' : `Log listener lost: ${reason}`
    });

    console.log(`[ADMINLOG] ${serverName}: ${up ? 'connected' : `disconnected — ${reason}`}`);

    // Only disconnects are worth pinging staff about: while it's down, nothing
    // is being logged, and that's a blind spot they need to know about.
    if (up || !ALERT_CHANNEL) return;

    const embed = new EmbedBuilder()
        .setTitle('🔌 RCON Log Listener Disconnected')
        .setColor(SEVERITY_COLOR.critical)
        .setDescription(
            `Lost the console connection to **${serverName}** (${reason}).\n` +
            '**Admin actions are not being logged until it reconnects.** ' +
            'Reconnection is automatic.'
        )
        .setTimestamp(new Date());

    await sendToChannel(ALERT_CHANNEL, [embed]);
}

/* ----------------------------------------------------------------- roster */

/**
 * Re-query one server's admin roster via `getauthlevels`.
 *
 * Failures are logged but never thrown: a roster we cannot refresh just keeps
 * its previous contents, and logging continues regardless — the roster only
 * controls the 👁️ flag, not what gets recorded.
 */
async function refreshRoster(serverKey, rconConfig) {
    const serverName = getAllConfigs()[serverKey]?.name || serverKey;

    let entries;
    try {
        entries = await fetchAuthLevels(rconConfig);
    } catch (error) {
        console.error(`[ADMINLOG] ${serverName}: could not read auth levels — ${error.message}`);
        return;
    }

    const previous = rosters.get(serverKey);
    // Key on SteamID where the server gives one, else on name — many builds
    // report bare names, and keying those all on `null` would collapse the
    // whole roster into a single entry.
    const rosterKey = e => e.steamId || `name:${(e.name || '').toLowerCase()}`;
    const next = new Map(entries.map(e => [rosterKey(e), e]));
    rosters.set(serverKey, next);

    if (!previous) {
        console.log(
            `[ADMINLOG] ${serverName}: roster loaded — ${next.size} staff ` +
            `(${entries.filter(e => e.level === 2).length} owner, ` +
            `${entries.filter(e => e.level === 1).length} mod)`
        );
        for (const e of entries) {
            const id = e.steamId ? `  ${e.steamId}` : '';
            console.log(`    ${e.label.padEnd(10)} ${e.name || '(name unknown)'}${id}`);
        }
        return;
    }

    // Announce changes — someone gaining or losing auth is itself an audit
    // event, and arguably the most important one this bot can surface.
    const added = [...next.values()].filter(e => !previous.has(rosterKey(e)));
    const removed = [...previous.values()].filter(e => !next.has(rosterKey(e)));

    // SteamID is frequently absent; render without an empty "(null)".
    const describe = e =>
        `${e.label} ${e.name || '(unnamed)'}${e.steamId ? ` (${e.steamId})` : ''}`;

    for (const e of added) {
        const detail = describe(e);
        writeToDisk({
            at: new Date().toISOString(),
            server: serverKey,
            id: 'auth_granted',
            label: 'Auth Level Granted',
            emoji: '🔑',
            severity: 'critical',
            severityRank: 3,
            raw: `Auth granted: ${detail}`,
            actor: { name: e.name, steamId: e.steamId },
            fields: { Level: e.label, SteamID: e.steamId || 'not reported' },
            watched: true
        });
        console.log(`[ADMINLOG] ${serverName}: auth GRANTED — ${detail}`);
    }

    for (const e of removed) {
        const detail = describe(e);
        writeToDisk({
            at: new Date().toISOString(),
            server: serverKey,
            id: 'auth_revoked',
            label: 'Auth Level Revoked',
            emoji: '🔒',
            severity: 'critical',
            severityRank: 3,
            raw: `Auth revoked: ${detail}`,
            actor: { name: e.name, steamId: e.steamId },
            fields: { Level: e.label, SteamID: e.steamId || 'not reported' },
            watched: true
        });
        console.log(`[ADMINLOG] ${serverName}: auth REVOKED — ${detail}`);
    }

    if (added.length || removed.length) {
        const queue = queues.get(serverKey);
        if (queue) {
            const embed = new EmbedBuilder()
                .setTitle('🔑 Admin Roster Changed')
                .setColor(SEVERITY_COLOR.critical)
                .setDescription(
                    [
                        ...added.map(e => `➕ ${describe(e)}`),
                        ...removed.map(e => `➖ ${describe(e)}`)
                    ].join('\n').slice(0, 3800)
                )
                .setFooter({ text: serverName })
                .setTimestamp(new Date());

            sendToChannel(ALERT_CHANNEL || channelIdFor(serverKey), [embed])
                .catch(err => console.error('[ADMINLOG] Roster alert failed:', err.message));
        }
    }
}

/** Refresh every configured server's roster. */
async function refreshAllRosters() {
    for (const [serverKey, config] of Object.entries(getAllConfigs())) {
        if (!config.rcon) continue;
        await refreshRoster(serverKey, config.rcon);
    }
}

/* ------------------------------------------------------------- lifecycle */

/**
 * Start listeners for every server that has RCON configured.
 * @param {import('discord.js').Client} client
 */
function startAdminLogging(client) {
    botClient = client;
    ensureLogDir();

    if (!DEFAULT_LOG_CHANNEL && !ALERT_CHANNEL) {
        console.warn(
            '[ADMINLOG] No ADMIN_LOG_CHANNEL set — logging to disk only. ' +
            'Set ADMIN_LOG_CHANNEL in .env to mirror events to Discord.'
        );
    }

    const configs = getAllConfigs();
    let started = 0;

    for (const [serverKey, config] of Object.entries(configs)) {
        if (!config.rcon) continue; // no RCON configured for this server

        const listener = new RconListener(serverKey, config.rcon);
        listener.on('line', (data) => handleLine(serverKey, data));
        listener.on('up', () => announceConnection(serverKey, true));
        listener.on('down', ({ reason }) => announceConnection(serverKey, false, reason));

        queues.set(serverKey, []);
        dropped.set(serverKey, 0);
        listeners.set(serverKey, listener);
        listener.start();
        started += 1;
    }

    if (!started) {
        console.warn('[ADMINLOG] No servers have RCON configured — admin logging is inactive.');
        return;
    }

    flushTimer = setInterval(() => {
        flush().catch(err => console.error('[ADMINLOG] Flush failed:', err));
    }, FLUSH_INTERVAL_MS);

    console.log(`✓ Admin logging started for ${started} server(s)`);
    if (EXTRA_WATCHLIST.length) {
        console.log(`  Extra watchlist from .env: ${EXTRA_WATCHLIST.join(', ')}`);
    }
    if (STAFF_ONLY) {
        console.log('  Mode: STAFF ONLY — non-staff player activity is discarded');
    } else {
        console.log('  Mode: ALL PLAYERS — everyone is logged');
    }

    // Pull the roster now, then on a timer. The first call is deliberately not
    // awaited — a slow or unreachable server must not delay the listeners.
    refreshAllRosters().catch(err =>
        console.error('[ADMINLOG] Initial roster load failed:', err.message)
    );

    rosterTimer = setInterval(() => {
        refreshAllRosters().catch(err =>
            console.error('[ADMINLOG] Roster refresh failed:', err.message)
        );
    }, ROSTER_REFRESH_MS);
}

function stopAdminLogging() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    if (rosterTimer) {
        clearInterval(rosterTimer);
        rosterTimer = null;
    }
    for (const listener of listeners.values()) {
        listener.stop();
    }
    listeners.clear();
    queues.clear();
}

module.exports = {
    startAdminLogging,
    stopAdminLogging,
    logManualCommand,
    LOG_DIR
};
