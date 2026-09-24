/**
 * Remove this application's GUILD-scoped slash commands.
 *
 * Deploying guild-scoped and then globally leaves both sets registered, and
 * Discord shows the union — so every command appears twice in that guild.
 * Clearing the guild set leaves the global one as the single source.
 *
 *   node src/clear-guild-commands.js            # uses GUILD_ID from .env
 *   node src/clear-guild-commands.js 123456789  # or an explicit guild id
 *
 * Global commands are untouched. Re-register them with deploy-commands.js.
 */
import { REST, Routes } from 'discord.js';
import { env } from './config.js';

const guildId = process.argv[2] || env.guildId;

if (!guildId) {
  console.error(
    '\n❌ No guild id.\n' +
      '   Pass one as an argument, or set GUILD_ID in .env:\n' +
      '     node src/clear-guild-commands.js <guild-id>\n',
  );
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(env.token);

try {
  console.log(`Clearing guild-scoped commands from guild ${guildId}...`);
  // An empty body replaces the guild's command list with nothing.
  await rest.put(Routes.applicationGuildCommands(env.clientId, guildId), { body: [] });
  console.log('✅ Guild-scoped commands cleared. Global commands are unaffected.');
  console.log('   Reload Discord (Ctrl+R) — duplicates should be gone.');
} catch (err) {
  console.error('Failed to clear guild commands:', err);
  process.exitCode = 1;
}
