import { startWipeScheduler } from '../wipe/scheduler.js';
import { startTimedMessageScheduler } from '../timedmsg/scheduler.js';
import { ensurePanel } from '../tickets/panelManager.js';

export const name = 'clientReady';
export const once = true;

export function execute(client) {
  console.log(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);

  const updateActivity = () => {

    const memberCount = client.guilds.cache.reduce(
      (total, guild) => total + guild.memberCount,
      0
    );

    client.user.setActivity(`${memberCount} members`, {
      type: 3,
    });
  };

  updateActivity();

  setInterval(updateActivity, 30 * 1000);

  startWipeScheduler(client);
  startTimedMessageScheduler(client);
  ensurePanel(client).catch((err) => console.error('[tickets] ensurePanel failed:', err));
}
