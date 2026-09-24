import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const file = readFileSync(join(root, 'config.json'), 'utf8');

const settings = JSON.parse(file);

export const env = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
};

if (!env.token || !env.clientId) {
  console.error(
    '\n❌ Missing credentials.\n' +
      '   Copy ".env.example" to ".env" and fill in:\n' +
      '     • DISCORD_TOKEN  (Developer Portal → Bot → Reset Token)\n' +
      '     • CLIENT_ID      (Developer Portal → General Information → Application ID)\n',
  );
  process.exit(1);
}

export const config = settings;
export default config;
