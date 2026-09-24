import { AttachmentBuilder } from 'discord.js';

export async function buildTranscript(channel) {
  const all = [];
  let before;

  while (all.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  all.reverse();

  const header = `Transcript of #${channel.name} (${channel.id})\nGenerated: ${new Date().toISOString()}\nMessages: ${all.length}\n${'='.repeat(60)}\n\n`;

  const body = all
    .map((m) => {
      const time = new Date(m.createdTimestamp).toISOString();
      const author = `${m.author?.tag ?? m.author?.id ?? 'unknown'}`;
      let line = `[${time}] ${author}: ${m.content || ''}`;
      if (m.attachments.size) {
        line += ` ${[...m.attachments.values()].map((a) => `<attachment: ${a.url}>`).join(' ')}`;
      }
      if (m.embeds.length || m.components.length) {
        line += ' <rich message>';
      }
      return line;
    })
    .join('\n');

  const buffer = Buffer.from(header + body, 'utf8');
  return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}
