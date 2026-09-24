const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { startAdminLogging, stopAdminLogging } = require('./adminLogger');

/**
 * Haxxor — standalone Rust admin-logging bot.
 *
 * Watches server consoles over RCON and mirrors admin actions into Discord,
 * plus a small set of console commands gated to a single trusted role.
 */

// Crash guards — a stray rejection should be logged, never take the bot down.
// A logger that dies is a logger that silently stops recording.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

const PREFIX = process.env.PREFIX || '!';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

client.messageCommands = new Collection();

// Load message commands. A file may export a single command object or an
// array of them (hammer.js exports two that share one implementation).
const commandsPath = path.join(__dirname, '..', 'commands');

if (fs.existsSync(commandsPath)) {
    for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
        const loaded = require(path.join(commandsPath, file));

        for (const command of [].concat(loaded)) {
            if (!command || !command.name || typeof command.execute !== 'function') continue;
            client.messageCommands.set(command.name, command);
            console.log(`✓ Loaded command: ${PREFIX}${command.name}`);
        }
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.messageCommands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args);
    } catch (error) {
        console.error(`Error executing ${commandName}:`, error);
        await message.reply('⚠️ There was an error executing this command.').catch(() => {});
    }
});

client.once('clientReady', () => {
    console.log(`✓ Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: 'admin actions', type: 3 }], // type 3 = Watching
        status: 'online'
    });

    startAdminLogging(client);
});

async function startBot() {
    if (!process.env.TOKEN) {
        console.error('✗ TOKEN is not set in .env — cannot start.');
        process.exit(1);
    }

    try {
        await client.login(process.env.TOKEN);
    } catch (error) {
        // Both of these are dashboard/config problems, not runtime faults, and
        // the raw stack trace buries the one line that says how to fix them.
        if (/disallowed intents/i.test(error.message)) {
            console.error(
                '\n✗ Discord rejected the login: "Used disallowed intents".\n\n' +
                '  Haxxor needs the MESSAGE CONTENT intent to read !hammer commands,\n' +
                '  and it must be enabled on the application first:\n\n' +
                '    1. https://discord.com/developers/applications\n' +
                '    2. Select this bot\'s application → "Bot"\n' +
                '    3. Under "Privileged Gateway Intents", enable MESSAGE CONTENT INTENT\n' +
                '    4. Save Changes, then start the bot again\n\n' +
                '  (Presence and Server Members intents are not needed.)\n'
            );
        } else if (/token/i.test(error.message)) {
            console.error(
                '\n✗ Discord rejected the token in .env.\n' +
                '  Check TOKEN is the bot token (Bot → Reset Token), not the client secret.\n'
            );
        } else {
            console.error('\n✗ Could not log in:', error.message, '\n');
        }
        process.exit(1);
    }

    return client;
}

function shutdown() {
    console.log('Shutting down...');
    stopAdminLogging();
    client.destroy();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { startBot, client };
