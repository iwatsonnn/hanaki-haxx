import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { simple, ephemeral } from '../lib/cv2.js';
import { getWarnings } from '../lib/warnings.js';
import { discordTime } from '../lib/timeParse.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription("View a member's warning history.")
  .addUserOption((o) => o.setName('user').setDescription('The member to look up').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const warnings = getWarnings(interaction.guild.id, target.id);

  const lines = [`## ⚠️ Warnings for ${target.tag}`, `**Total:** ${warnings.length}`];
  if (warnings.length === 0) {
    lines.push('This member has no warnings.');
  } else {
    lines.push('---');
    for (const [i, w] of warnings.slice(-15).entries()) {
      lines.push(`**${i + 1}.** ${w.reason}\n-# By <@${w.moderatorId}> • ${discordTime(Math.floor(w.at / 1000), 'f')} • id \`${w.id}\``);
    }
    if (warnings.length > 15) lines.push(`-# …and ${warnings.length - 15} older warning(s).`);
  }

  return interaction.reply(ephemeral(simple({ accent: config.colors.warning, lines })));
}
