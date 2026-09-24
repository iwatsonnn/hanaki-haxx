require('dotenv').config();

/**
 * Haxxor configuration.
 *
 * Standalone admin-logging bot: watches Rust server consoles over RCON, mirrors
 * admin actions into Discord, and exposes a small set of console commands to a
 * single trusted role.
 */

/** Role permitted to run console commands (!hammer1 / !hammer0). */
const HAMMER_ROLE_ID = process.env.HAMMER_ROLE_ID || '1481437074870632662';

/**
 * Build an RCON config from a per-server env prefix, e.g. buildRcon('EU')
 * reads EU_RCON_HOST / EU_RCON_PORT / EU_RCON_PASSWORD.
 * Returns null when the server has no RCON configured.
 */
function buildRcon(prefix) {
    const host = process.env[`${prefix}_RCON_HOST`];
    const port = process.env[`${prefix}_RCON_PORT`];
    const password = process.env[`${prefix}_RCON_PASSWORD`];

    if (!host || !port || !password) return null;
    return { host, port, password };
}

/**
 * Servers Haxxor watches. A server appears here only when its RCON env vars
 * are set, so adding a server is purely an .env change.
 */
const SERVER_CONFIGS = {
    eu: { name: 'EU', guildId: process.env.EU_GUILD_ID, rcon: buildRcon('EU') },
    au: { name: 'AU', guildId: process.env.AU_GUILD_ID, rcon: buildRcon('AU') },
    eu2x: { name: 'EU 2x', guildId: process.env.EU_2X_GUILD_ID, rcon: buildRcon('EU_2X') },
    au2x: { name: 'AU 2x', guildId: process.env.AU_2X_GUILD_ID, rcon: buildRcon('AU_2X') },
    eu3x: { name: 'EU 3x', guildId: process.env.EU_3X_GUILD_ID, rcon: buildRcon('EU_3X') },
    au3x: { name: 'AU 3x', guildId: process.env.AU_3X_GUILD_ID, rcon: buildRcon('AU_3X') }
};

/** All server configs, keyed by server key. */
function getAllConfigs() {
    return SERVER_CONFIGS;
}

/**
 * Find the server config bound to a Discord guild.
 * @param {string} guildId
 * @returns {object|null} Config with its key attached, or null when unmapped.
 */
function getServerConfig(guildId) {
    for (const [key, config] of Object.entries(SERVER_CONFIGS)) {
        if (config.guildId && config.guildId === guildId) {
            return { ...config, key };
        }
    }
    return null;
}

/** Guild IDs Haxxor is configured for. */
function getAllGuildIds() {
    return Object.values(SERVER_CONFIGS)
        .map(config => config.guildId)
        .filter(id => id && id.trim() !== '');
}

module.exports = {
    SERVER_CONFIGS,
    HAMMER_ROLE_ID,
    getAllConfigs,
    getServerConfig,
    getAllGuildIds
};
