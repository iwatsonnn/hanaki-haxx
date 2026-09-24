import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { config } from '../config.js';
import { ok, fail } from '../lib/replies.js';
import { wipeUnix, discordTime, formatDuration } from '../lib/timeParse.js';
import { renderAnnouncement, WIPE_TYPES } from '../wipe/wipeMessage.js';
import { addWipe } from '../wipe/scheduler.js';

export const data = new SlashCommandBuilder()
  .setName('send')
  .setDescription('Announce a server wipe and schedule reminders.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('wipe')
      .setDescription('Announce a server wipe and schedule reminders.')
      .addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setMinValue(1).setMaxValue(12).setRequired(true))
      .addIntegerOption((o) => o.setName('day').setDescription('Day (1-31)').setMinValue(1).setMaxValue(31).setRequired(true))
      .addIntegerOption((o) => o.setName('year').setDescription('Year, e.g. 2026').setMinValue(2020).setMaxValue(2100).setRequired(true))
      .addIntegerOption((o) => o.setName('hour').setDescription('Hour, 24h clock (0-23) UTC').setMinValue(0).setMaxValue(23).setRequired(true))
      .addIntegerOption((o) => o.setName('minute').setDescription('Minute (0-59), default 0').setMinValue(0).setMaxValue(59))
      .addStringOption((o) => o.setName('type').setDescription('Wipe type').addChoices(
        { name: 'Full (map + BP)', value: 'full' },
        { name: 'Map only', value: 'map' },
        { name: 'Blueprint only', value: 'bp' },
      ))
      .addChannelOption((o) => o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('note').setDescription('Extra note to include')),
  );

async function resolveChannel(interaction, fallbackId) {
  const opt = interaction.options.getChannel('channel');
  if (opt) return opt;
  if (fallbackId) return interaction.guild.channels.fetch(fallbackId).catch(() => null);
  return interaction.channel;
}

async function runWipe(interaction) {
  const month = interaction.options.getInteger('month', true);
  const day = interaction.options.getInteger('day', true);
  const year = interaction.options.getInteger('year', true);
  const hour = interaction.options.getInteger('hour', true);
  const minute = interaction.options.getInteger('minute') ?? 0;
  const type = interaction.options.getString('type') ?? 'full';
  const note = interaction.options.getString('note') ?? '';

  const unix = wipeUnix({ year, month, day, hour, minute });
  if (!unix) return interaction.reply(fail('That date is invalid. Double-check the month/day combination.'));

  const channel = await resolveChannel(interaction, config.wipe.announceChannelId);
  if (!channel?.isTextBased?.()) return interaction.reply(fail('No valid announcement channel. Set `wipe.announceChannelId` or pass a channel.'));

  const wipe = {
    id: Date.now().toString(36),
    unix,
    type,
    note,
    channelId: channel.id,
    roleToPingId: config.wipe.roleToPingId || null,
    connect: config.wipe.connect || '',
    bannerUrl: config.wipe.bannerUrl || '',
    reminderOffsets: config.wipe.reminderOffsets ?? [],
    firedReminders: [],
    liveFired: false,
    createdBy: interaction.user.id,
  };

  await channel.send(renderAnnouncement(wipe));
  addWipe(wipe);

  const now = Math.floor(Date.now() / 1000);
  const ackLines = [
    `✅ Wipe announced in <#${channel.id}>.`,
    `**Type:** ${WIPE_TYPES[type]}`,
    `**When:** ${discordTime(unix, 'F')} (${discordTime(unix, 'R')})`,
  ];
  if (unix <= now) {
    ackLines.push('⚠️ That time is in the past — the "wipe is LIVE" message will fire on the next scheduler tick.');
  } else if (wipe.reminderOffsets.length) {
    ackLines.push(`**Reminders scheduled:** ${wipe.reminderOffsets.map((s) => formatDuration(s * 1000) + ' before').join(', ')}`);
  }
  return interaction.reply(ok(ackLines, config.colors.primary, true));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'wipe') return runWipe(interaction);
}
