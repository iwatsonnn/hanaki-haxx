import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { simple, ephemeral } from '../lib/cv2.js';
import { config } from '../config.js';
import { setTag, removeTag, listTags } from '../lib/tags.js';

const RESERVED = ['pop'];

export const data = new SlashCommandBuilder()
  .setName('autosay')
  .setDescription('Manage custom !trigger auto-say responses.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add or update a custom auto-say response.')
      .addStringOption((o) => o.setName('trigger').setDescription('The word typed after ! (no spaces)').setRequired(true))
      .addStringOption((o) => o.setName('response').setDescription('What the bot replies with').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a custom auto-say response.')
      .addStringOption((o) => o.setName('trigger').setDescription('The trigger to remove').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List all custom auto-say responses.'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const prefix = config.prefix || '!';

  if (sub === 'add') {
    const trigger = interaction.options.getString('trigger', true).trim().toLowerCase().replace(/^!+/, '');
    const response = interaction.options.getString('response', true);
    if (!trigger || /\s/.test(trigger)) return interaction.reply(fail('The trigger must be a single word with no spaces.'));
    if (RESERVED.includes(trigger)) return interaction.reply(fail(`\`${trigger}\` is a reserved word and can't be used as an auto-say command.`));
    setTag(guildId, trigger, response);
    return interaction.reply(ok([`✅ Saved. Members can now use \`${prefix}${trigger}\`.`], config.colors.success, true));
  }

  if (sub === 'remove') {
    const trigger = interaction.options.getString('trigger', true);
    const removed = removeTag(guildId, trigger);
    return interaction.reply(removed ? ok([`🗑️ Removed \`${prefix}${trigger.trim().toLowerCase().replace(/^!+/, '')}\`.`], config.colors.success, true) : fail('There is no auto-say command with that trigger.'));
  }

  const tags = listTags(guildId);
  const lines = ['## 🏷️ Auto-say commands', `**Total:** ${tags.length}`];
  lines.push(tags.length ? tags.map((t) => `\`${prefix}${t}\``).join(', ') : `_None yet. Add one with_ \`/autosay add\`.`);
  return interaction.reply(ephemeral(simple({ accent: config.colors.primary, lines })));
}
