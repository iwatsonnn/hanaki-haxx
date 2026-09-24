/**
 * Show what THIS application currently has registered with Discord.
 *
 * Answers "which bot am I actually deploying to, and does it have /ticket?"
 * without guessing from .env: it reports the application's own name and id as
 * Discord knows them, then both its global and guild-scoped command lists.
 *
 *   node src/list-commands.js            # global + GUILD_ID from .env
 *   node src/list-commands.js 123456789  # global + that guild
 */
import { REST, Routes } from 'discord.js';
import { env } from './config.js';

const guildId = process.argv[2] || env.guildId;
const rest = new REST({ version: '10' }).setToken(env.token);

function show(label, list) {
  console.log(`\n--- ${label}: ${list.length} command(s) ---`);
  if (!list.length) return console.log('  (none)');
  console.log('  ' + list.map((c) => '/' + c.name).sort().join('  '));
  const ticket = list.find((c) => c.name === 'ticket');
  console.log(ticket ? '  ✅ /ticket IS registered here' : '  ❌ /ticket is NOT registered here');
}

try {
  // The token identifies the application, so this is the ground truth for
  // which bot .env actually points at — regardless of what CLIENT_ID says.
  const me = await rest.get(Routes.currentApplication());
  console.log(`\nToken belongs to: ${me.name}  (id ${me.id})`);
  if (me.id !== env.clientId) {
    console.log(`⚠️  .env CLIENT_ID is ${env.clientId} — it does NOT match the token's app.`);
  }

  show('GLOBAL', await rest.get(Routes.applicationCommands(me.id)));

  if (guildId) {
    show(`GUILD ${guildId}`, await rest.get(Routes.applicationGuildCommands(me.id, guildId)));
  } else {
    console.log('\n(no GUILD_ID set — skipped guild-scoped check)');
  }
} catch (err) {
  console.error('Failed to list commands:', err.message ?? err);
  process.exitCode = 1;
}
