import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config.js';
import { loadModules } from './lib/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message],
});

client.commands = new Collection();

for (const { file, mod } of await loadModules(join(__dirname, 'commands'))) {
  if (mod?.data?.name && typeof mod.execute === 'function') {
    client.commands.set(mod.data.name, mod);
  } else {
    console.warn(`[commands] Skipping ${file}: missing "data" or "execute" export.`);
  }
}

for (const { file, mod } of await loadModules(join(__dirname, 'events'))) {
  if (!mod?.name || typeof mod.execute !== 'function') {
    console.warn(`[events] Skipping ${file}: missing "name" or "execute" export.`);
    continue;
  }
  const handler = (...args) => mod.execute(...args, client);
  if (mod.once) client.once(mod.name, handler);
  else client.on(mod.name, handler);
}

function explainFatal(err) {
  const msg = String(err?.message ?? err);
  if (err?.code === 'TokenInvalid' || /invalid token/i.test(msg)) {
    console.error(
      '\n❌ Invalid bot token.\n' +
        '   Check DISCORD_TOKEN in your .env matches the token from\n' +
        '   Discord Developer Portal → your app → Bot → Reset Token.\n',
    );
    return true;
  }
  if (err?.code === 'DisallowedIntents' || /disallowed intents/i.test(msg)) {
    console.error(
      '\n❌ Discord rejected the bot\'s privileged intents.\n' +
        '   Open https://discord.com/developers/applications → your app → Bot,\n' +
        '   and enable BOTH toggles, then run `npm start` again:\n' +
        '     • Server Members Intent   (welcome messages)\n' +
        '     • Message Content Intent  (word blacklist)\n',
    );
    return true;
  }
  return false;
}

process.on('unhandledRejection', (err) => {
  if (explainFatal(err)) process.exit(1);
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  if (explainFatal(err)) process.exit(1);
  console.error('[uncaughtException]', err);
});

client.login(env.token).catch((err) => {
  if (!explainFatal(err)) console.error('[login] Failed to log in:', err);
  process.exit(1);
});
