import { REST, Routes } from 'discord.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config.js';
import { loadModules } from './lib/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const body = [];
for (const { file, mod } of await loadModules(join(__dirname, 'commands'))) {
  if (mod?.data?.toJSON) body.push(mod.data.toJSON());
  else console.warn(`[deploy] Skipping ${file}: missing "data" export.`);
}

const rest = new REST({ version: '10' }).setToken(env.token);

try {
  const route = env.guildId
    ? Routes.applicationGuildCommands(env.clientId, env.guildId)
    : Routes.applicationCommands(env.clientId);

  console.log(`Deploying ${body.length} command(s) ${env.guildId ? `to guild ${env.guildId}` : 'globally'}...`);
  const data = await rest.put(route, { body });
  console.log(`Successfully registered ${data.length} command(s).`);
} catch (err) {
  console.error('Failed to deploy commands:', err);
  process.exitCode = 1;
}
