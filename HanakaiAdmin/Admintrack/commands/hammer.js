/**
 * !hammer1 / !hammer0 — toggle the demolish hammer over RCON.
 *
 *   !hammer1 → construct.demolishhammer 1   (enabled)
 *   !hammer0 → construct.demolishhammer 0   (disabled)
 *
 * Restricted to HAMMER_ROLE_ID. The role is re-checked on every invocation
 * rather than cached, so revoking the role takes effect immediately.
 */
const { EmbedBuilder } = require('discord.js');
const { HAMMER_ROLE_ID, getServerConfig } = require('../helpers/config');
const { sendRconCommand } = require('../helpers/rcon');
const { logManualCommand } = require('../helpers/adminLogger');

const STATES = {
    hammer1: {
        value: 1,
        label: 'Demolish Hammer Enabled',
        emoji: '🔨',
        color: 0x57F287
    },
    hammer0: {
        value: 0,
        label: 'Demolish Hammer Disabled',
        emoji: '🚫',
        color: 0xED4245
    }
};

function hasHammerRole(member) {
    return !!member?.roles?.cache?.has(HAMMER_ROLE_ID);
}

/**
 * Run one hammer state change.
 * Shared by both commands so the two differ only by the value sent.
 */
async function runHammer(message, stateKey) {
    const state = STATES[stateKey];
    if (!state || !message.guild) return;

    if (!hasHammerRole(message.member)) {
        await message.reply('❌ You do not have permission to use this command.');
        return;
    }

    const serverConfig = getServerConfig(message.guild.id);
    if (!serverConfig?.rcon) {
        await message.reply(
            '⚠️ RCON is not configured for this Discord, so the command cannot be run.'
        );
        return;
    }

    const command = `construct.demolishhammer ${state.value}`;

    let response;
    try {
        response = await sendRconCommand(serverConfig.rcon, command);
    } catch (error) {
        console.error(`!${stateKey}: RCON failed —`, error.message);
        await message.reply(`⚠️ Could not run the command: ${error.message}`);
        return;
    }

    // This bypasses the console feed (it is our own command, not server output),
    // so record it explicitly — an untracked admin action is the whole thing
    // this bot exists to prevent.
    logManualCommand({
        server: serverConfig.key,
        command,
        actorName: message.author.tag,
        actorId: message.author.id,
        label: state.label
    });

    console.log(
        `[HAMMER] ${message.author.tag} ran "${command}" on ${serverConfig.name}`
    );

    const embed = new EmbedBuilder()
        .setTitle(`${state.emoji} ${state.label}`)
        .setColor(state.color)
        .setDescription('```\n' + command + '\n```')
        .addFields(
            { name: 'Server', value: serverConfig.name, inline: true },
            { name: 'Ran by', value: `${message.author}`, inline: true }
        )
        .setTimestamp(new Date());

    // Rust often replies with an empty string on a successful convar set.
    if (response && response.trim()) {
        embed.addFields({ name: 'Response', value: '```\n' + response.slice(0, 500) + '\n```' });
    }

    await message.reply({ embeds: [embed] });
}

module.exports = [
    {
        name: 'hammer1',
        description: 'Enable the demolish hammer (construct.demolishhammer 1)',
        execute: (message) => runHammer(message, 'hammer1')
    },
    {
        name: 'hammer0',
        description: 'Disable the demolish hammer (construct.demolishhammer 0)',
        execute: (message) => runHammer(message, 'hammer0')
    }
];
