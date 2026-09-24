import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk-delete recent messages in this channel.')
  .addIntegerOption((o) => o.setName('count').setDescription('How many messages to delete (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
  .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this member'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  const count = interaction.options.getInteger('count', true);
  const user = interaction.options.getUser('user');

  if (!interaction.channel?.isTextBased?.()) return interaction.reply(fail('This command can only be used in a text channel.'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let toDelete;
  if (user) {
    const fetched = await interaction.channel.messages.fetch({ limit: 100 });
    toDelete = [...fetched.filter((m) => m.author.id === user.id).values()].slice(0, count);
  } else {
    toDelete = count;
  }

  let deleted;
  try {

    const result = await interaction.channel.bulkDelete(toDelete, true);
    deleted = result.size;
  } catch (err) {
    console.error('[purge] failed:', err);
    return interaction.editReply(ok('Failed to delete messages (they may be older than 14 days).', config.colors.danger));
  }

  await interaction.editReply(ok([`🧹 Deleted **${deleted}** message(s)${user ? ` from ${user.tag}` : ''}.`], config.colors.success));
  await logAction(interaction.guild, {
    action: 'Purge',
    emoji: '🧹',
    moderator: interaction.user,
    extra: [`**Channel:** <#${interaction.channel.id}>`, `**Deleted:** ${deleted}`, ...(user ? [`**Filter:** ${user.tag}`] : [])],
    color: config.colors.primary,
  });
}
