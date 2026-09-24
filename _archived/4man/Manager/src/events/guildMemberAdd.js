import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SectionBuilder, ThumbnailBuilder } from 'discord.js';
import { config } from '../config.js';
import { container, td, CV2_FLAG } from '../lib/cv2.js';

export const name = 'guildMemberAdd';

function fillTemplate(template, member) {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
}

export async function execute(member) {
  if (member.user.bot) return;
  const channelId = config.welcomeChannelId;
  if (!channelId) return;

  const channel = member.guild.channels.cache.get(channelId) ?? (await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return;

  const c = container(config.colors.success);

  c.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        td(`# ${config.welcome.title}`),
        td(fillTemplate(config.welcome.template, member)),
      )
      .setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(member.displayAvatarURL({ size: 256, extension: 'png' }))
          .setDescription(`${member.user.username}'s avatar`),
      ),
  );

  if (config.welcome.showRulesButton && config.rulesChannelId) {
    c.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Read the rules')
          .setStyle(ButtonStyle.Link)
          .setEmoji('📜')
          .setURL(`https://discord.com/channels/${member.guild.id}/${config.rulesChannelId}`),
      ),
    );
  }

  await channel
    .send({ components: [c], flags: CV2_FLAG, allowedMentions: { users: [member.id] } })
    .catch((err) => console.error('[welcome] Failed to send:', err));
}
