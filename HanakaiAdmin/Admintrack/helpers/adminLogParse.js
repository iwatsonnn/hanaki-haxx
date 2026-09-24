/**
 * Classify raw Rust/Oxide console lines into admin-audit events.
 *
 * The brief was "log everything from kits spawning to commands ran and more to
 * be extra safe", so this errs heavily toward over-capturing: anything that
 * looks like a privileged action is matched, and anything unmatched but
 * suspicious still falls through to a catch-all `unknown` category rather than
 * being dropped. It is far cheaper to log a boring line than to miss an abuse.
 *
 * Rust console formats vary by plugin and server version, so every pattern is
 * written loosely and the raw line is always preserved on the event.
 */

/** Categories, ordered by how loudly they should be surfaced. */
const SEVERITY = {
    critical: 3, // item spawning, ownership/permission changes, server-altering
    high: 2,     // bans, kicks, teleports, kits, godmode, vanish
    normal: 1,   // ordinary admin commands, chat by admins
    low: 0       // noise kept for completeness
};

/**
 * Each rule: { id, label, emoji, severity, pattern, extract? }
 *
 * `pattern` is tested against the raw line. `extract` pulls structured fields
 * out of the match for nicer embeds; it may return null to fall back to raw.
 *
 * Order matters — the first matching rule wins, so specific rules precede
 * general ones.
 */
const RULES = [
    // ---------------------------------------------------------------- spawning
    {
        id: 'item_give',
        label: 'Item Given',
        emoji: '🎁',
        severity: 'critical',
        // "[player] gave [target] 1000 x Rifle Body" / inventory.giveto etc.
        pattern: /\bgave\b|\binventory\.give(?:to|arm|bp|id)?\b|\bgiveall\b/i,
        extract: (line) => {
            const m = line.match(/(.+?)\s+gave\s+(.+?)\s+([\d,]+)\s*x?\s*(.+)/i);
            if (!m) return null;
            // Strip the "[conn/steamid]" tag so the field reads as a plain name.
            const admin = m[1].trim().replace(/\s*\[\d+\/\d{17}\]\s*$/, '');
            return { Admin: admin, Target: m[2].trim(), Amount: m[3], Item: m[4].trim() };
        }
    },
    {
        id: 'entity_spawn',
        label: 'Entity Spawned',
        emoji: '🐉',
        severity: 'critical',
        pattern: /\bentity\.spawn(?:item|here)?\b|\bspawn\s+(?:assets|ch47|bradley|patrolhelicopter|cargoship)/i
    },
    {
        id: 'kit_given',
        label: 'Kit Given',
        emoji: '📦',
        severity: 'high',
        // Oxide Kits: "player received kit 'starter'" / "kit give <kit> <player>".
        // The verb sits on either side of "kit" depending on the plugin, so
        // match both orders rather than assuming one.
        pattern: /\bkit\b.*\b(?:give|given|received|redeem(?:ed)?|granted)\b|\b(?:give|given|received|redeem(?:ed)?|granted)\b.*\bkit\b|\bkit\.(?:give|add)\b/i,
        extract: (line) => {
            const m = line.match(/(.+?)\s+(?:received|redeemed)\s+(?:the\s+)?kit\s+'?"?([^'"]+)'?"?/i);
            if (m) return { Player: m[1].trim(), Kit: m[2].trim() };
            const g = line.match(/kit\s+give\s+"?([^"\s]+)"?\s+"?([^"]+)"?/i);
            if (g) return { Kit: g[1], Target: g[2].trim() };
            return null;
        }
    },
    {
        id: 'kit_edit',
        label: 'Kit Modified',
        emoji: '🧰',
        severity: 'critical',
        pattern: /\bkit\s+(?:create|edit|remove|delete|reset)\b/i
    },

    // ------------------------------------------------------------ moderation
    {
        id: 'ban',
        label: 'Ban',
        emoji: '🔨',
        severity: 'high',
        pattern: /\b(?:global\.)?ban(?:id|ned|ning)?\b|\bkicking.*banned\b/i,
        extract: (line) => {
            const m = line.match(/ban(?:id)?\s+"?([^"\s]+)"?\s*(?:"([^"]*)")?/i);
            if (!m) return null;
            return { Target: m[1], Reason: m[2] || 'none given' };
        }
    },
    {
        id: 'unban',
        label: 'Unban',
        emoji: '🕊️',
        severity: 'high',
        pattern: /\b(?:global\.)?unban(?:id)?\b|\bwas unbanned\b/i
    },
    {
        id: 'kick',
        label: 'Kick',
        emoji: '👢',
        severity: 'high',
        pattern: /\b(?:global\.)?kick(?:all|id|ed|ing)?\b/i,
        extract: (line) => {
            // "Admin (steamid) kicked Target "reason"" — active voice.
            const active = line.match(/kicked\s+"?([^"\s]+)"?\s*(?:"([^"]*)")?/i);
            if (active) return { Target: active[1], Reason: active[2] || 'none given' };

            const m = line.match(/kick(?:id)?\s+"?([^"\s]+)"?\s*(?:"([^"]*)")?/i);
            if (!m) return null;
            return { Target: m[1], Reason: m[2] || 'none given' };
        }
    },
    {
        id: 'mute',
        label: 'Mute / Unmute',
        emoji: '🔇',
        severity: 'normal',
        pattern: /\b(?:un)?mute\b|\bchat\.mute\b/i
    },

    // ------------------------------------------------------------- movement
    {
        id: 'teleport',
        label: 'Teleport',
        emoji: '📍',
        severity: 'high',
        pattern: /\bteleport(?:any|pos|los|2me|everyone)?\b|\btp(?:pos|r|a)?\b|\bteleported\b/i,
        extract: (line) => {
            const m = line.match(/teleport(?:any)?\s+"?([^"]+?)"?\s+"?([^"]+?)"?$/i);
            if (!m) return null;
            return { From: m[1].trim(), To: m[2].trim() };
        }
    },

    // ------------------------------------------------- privilege / state abuse
    {
        id: 'godmode',
        label: 'Godmode',
        emoji: '🛡️',
        severity: 'high',
        pattern: /\bgod(?:mode)?\b/i
    },
    {
        id: 'vanish',
        label: 'Vanish',
        emoji: '👻',
        severity: 'high',
        pattern: /\bvanish\b|\bnoclip\b|\bdebugcamera\b/i
    },
    {
        id: 'permission',
        label: 'Permission / Group Change',
        emoji: '🔑',
        severity: 'critical',
        pattern: /\b(?:o\.|oxide\.)?(?:grant|revoke|usergroup|group)\b|\bmoderatorid\b|\bownerid\b|\bremovemoderator\b|\bremoveowner\b/i,
        extract: (line) => {
            const m = line.match(/(?:grant|revoke)\s+(user|group)\s+"?([^"\s]+)"?\s+"?([^"\s]+)"?/i);
            if (!m) return null;
            return { Scope: m[1], Target: m[2], Permission: m[3] };
        }
    },
    {
        id: 'plugin',
        label: 'Plugin Load / Unload',
        emoji: '🧩',
        severity: 'critical',
        pattern: /\b(?:o\.|oxide\.)?(?:load|unload|reload)\b\s|\bplugin\b.*\b(?:loaded|unloaded)\b/i
    },

    // --------------------------------------------------------- server-altering
    {
        id: 'server_state',
        label: 'Server State Change',
        emoji: '⚙️',
        severity: 'critical',
        pattern: /\bserver\.(?:save|restart|stop|writecfg)\b|\bquit\b|\bglobal\.restart\b/i
    },
    {
        id: 'destructive',
        label: 'Destructive Cleanup',
        emoji: '🧹',
        severity: 'critical',
        pattern: /\bremovedroppeditems\b|\bai\.removecorpses\b|\bdel(?:ete)?\b.*\bentity\b|\bkillall\b/i
    },
    {
        id: 'env',
        label: 'Environment / Time Change',
        emoji: '🌤️',
        severity: 'normal',
        pattern: /\benv\.time\b|\bweather\.\w+\b|\btime\s+\d+/i
    },

    // -------------------------------------------------------------- chat / f7
    {
        id: 'admin_chat',
        label: 'Admin Chat',
        emoji: '💬',
        severity: 'low',
        pattern: /^\[(?:CHAT|BETTERCHAT)\]|\bsay\b/i
    },
    {
        id: 'report',
        label: 'Player Report',
        emoji: '🚩',
        severity: 'normal',
        pattern: /\bF7 report\b|\breport\b.*\bsubmitted\b/i
    }
];

/**
 * Lines matching these are pure server noise, never worth an audit entry.
 * Kept deliberately narrow so nothing meaningful is silently discarded.
 */
const IGNORE = [
    /^\s*$/,
    /\bsaving\s+\d+\s+entities\b/i,
    /\bSave complete\b/i,
    /\bCalling kill.*on\b/i,
    /\bLoaded\s+\d+\s+/i,
    /\bframerate\b/i,
    /^\s*<slot:/i
];

/** Extract a "who did it" name when the line carries one. */
function extractActor(line) {
    // "[ADMIN] Name (76561198…)" / "Name[123/765611…]" / "Name: command"
    const steamTag = line.match(/([^\s\[\]]+)\s*\[\d+\/(\d{17})\]/);
    if (steamTag) return { name: steamTag[1], steamId: steamTag[2] };

    const parens = line.match(/([A-Za-z0-9_\-. ]{2,32})\s*\((\d{17})\)/);
    if (parens) return { name: parens[1].trim(), steamId: parens[2] };

    const bare = line.match(/\b(\d{17})\b/);
    if (bare) return { name: null, steamId: bare[1] };

    return { name: null, steamId: null };
}

/**
 * Classify one console line.
 *
 * @param {string} line Raw console output
 * @returns {null|{id,label,emoji,severity,severityRank,raw,actor,fields}}
 *          null when the line is known noise.
 */
function classify(line) {
    if (typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (IGNORE.some(re => re.test(trimmed))) return null;

    const actor = extractActor(trimmed);

    for (const rule of RULES) {
        if (!rule.pattern.test(trimmed)) continue;

        const fields = (rule.extract && rule.extract(trimmed)) || null;
        return {
            id: rule.id,
            label: rule.label,
            emoji: rule.emoji,
            severity: rule.severity,
            severityRank: SEVERITY[rule.severity],
            raw: trimmed,
            actor,
            fields
        };
    }

    // Unmatched but non-noise. Logged as 'unknown' rather than dropped — the
    // whole point is not to miss anything, and unmatched lines are exactly
    // where a novel abuse would show up first.
    return {
        id: 'unknown',
        label: 'Console Output',
        emoji: '📝',
        severity: 'low',
        severityRank: SEVERITY.low,
        raw: trimmed,
        actor,
        fields: null
    };
}

module.exports = { classify, RULES, SEVERITY };
