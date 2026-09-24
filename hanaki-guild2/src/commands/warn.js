import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail, dmUser } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { addWarning } from '../lib/warnings.js';
import { formatDuration } from '../lib/timeParse.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a member.')
  .addUserOption((o) => o.setName('user').setDescription('The member to warn').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);

  if (target.bot) return interaction.reply(fail('You cannot warn a bot.'));
  if (target.id === interaction.user.id) return interaction.reply(fail('You cannot warn yourself.'));

  const warnings = addWarning(interaction.guild.id, target.id, reason, interaction.user.id);
  const count = warnings.length;

  await dmUser(target, [`You have been **warned** in **${interaction.guild.name}**.`, `**Reason:** ${reason}`, `You now have **${count}** warning(s).`]);

  const extra = [`**Total warnings:** ${count}`];

  const at = config.moderation?.warnAutoTimeoutAt ?? 0;
  const durationMs = config.moderation?.warnAutoTimeoutMs ?? 0;
  if (at > 0 && durationMs > 0 && count >= at && count % at === 0) {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member?.moderatable) {
      await member.timeout(durationMs, `Auto-timeout: reached ${count} warnings`).catch(() => {});
      extra.push(`⚠️ **Auto-timeout applied:** ${formatDuration(durationMs)} (reached ${count} warnings)`);
    }
  }

  await interaction.reply(ok([`⚠️ **Warned** ${target.tag}`, `**Reason:** ${reason}`, `**Total warnings:** ${count}`], config.colors.warning));
  await logAction(interaction.guild, { action: 'Warn', emoji: '⚠️', moderator: interaction.user, target, reason, extra, color: config.colors.warning });
}
