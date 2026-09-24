import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { config } from '../config.js';
import { ok, fail } from '../lib/replies.js';
import { simple, ephemeral } from '../lib/cv2.js';
import { parseDuration, formatDuration, discordTime } from '../lib/timeParse.js';
import {
  loadTimedMessages,
  addTimedMessage,
  removeTimedMessage,
} from '../timedmsg/scheduler.js';

const MIN_INTERVAL_MS = 60_000; // 1 minute floor to avoid rate-limit abuse.

// This command is restricted to specific users (config.timedmsg.allowedUserIds),
// not the general staff gate. The interaction handler routes it here without the
// staff check, so we enforce access ourselves.
export function canUse(interaction) {
  const allowed = config.timedmsg?.allowedUserIds ?? [];
  return allowed.includes(interaction.user.id);
}

export const data = new SlashCommandBuilder()
  .setName('timedmsg')
  .setDescription('Schedule a recurring message in a channel.')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Create a recurring timed message.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((o) => o.setName('interval').setDescription('How often, e.g. 6h, 30m, 1d').setRequired(true))
      .addStringOption((o) => o.setName('body').setDescription('Main message text').setRequired(true))
      .addStringOption((o) => o.setName('title').setDescription('Optional bold title'))
      .addStringOption((o) => o.setName('footer').setDescription('Optional small footer text'))
      .addStringOption((o) => o.setName('image').setDescription('Optional image URL')),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List all timed messages.'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Delete a timed message by its ID.')
      .addStringOption((o) => o.setName('id').setDescription('The message ID (from /timedmsg list)').setRequired(true)),
  );

function isValidImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function runCreate(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const intervalRaw = interaction.options.getString('interval', true);
  const body = interaction.options.getString('body', true);
  const title = interaction.options.getString('title') ?? '';
  const footer = interaction.options.getString('footer') ?? '';
  const image = interaction.options.getString('image') ?? '';

  const intervalMs = parseDuration(intervalRaw);
  if (!intervalMs) return interaction.reply(fail('Invalid interval. Use formats like `30m`, `6h`, `1d`, or `1d12h`.'));
  if (intervalMs < MIN_INTERVAL_MS) return interaction.reply(fail('Interval must be at least **1 minute**.'));
  if (image && !isValidImageUrl(image)) return interaction.reply(fail('The image must be a valid http(s) URL.'));
  if (!channel?.isTextBased?.()) return interaction.reply(fail('Pick a text channel.'));

  const msg = {
    id: Date.now().toString(36),
    guildId: interaction.guild.id,
    channelId: channel.id,
    intervalMs,
    title,
    body,
    footer,
    image,
    createdBy: interaction.user.id,
    createdAt: Date.now(),
    nextRun: Date.now() + intervalMs,
  };
  addTimedMessage(msg);

  const nextUnix = Math.floor(msg.nextRun / 1000);
  return interaction.reply(
    ok(
      [
        `✅ Timed message created in <#${channel.id}>.`,
        `**ID:** \`${msg.id}\``,
        `**Every:** ${formatDuration(intervalMs)}`,
        `**First post:** ${discordTime(nextUnix, 'R')}`,
      ],
      config.colors.success,
      true,
    ),
  );
}

async function runList(interaction) {
  const list = loadTimedMessages().filter((m) => m.guildId === interaction.guild.id);
  const lines = ['## ⏱️ Timed messages', `**Total:** ${list.length}`];
  if (list.length === 0) {
    lines.push('_None yet. Create one with_ `/timedmsg create`.');
  } else {
    lines.push('---');
    for (const m of list) {
      const next = m.nextRun ? discordTime(Math.floor(m.nextRun / 1000), 'R') : '—';
      const label = m.title || m.body.slice(0, 40) + (m.body.length > 40 ? '…' : '');
      lines.push(`\`${m.id}\` • <#${m.channelId}> • every ${formatDuration(m.intervalMs)} • next ${next}\n> ${label}`);
    }
  }
  return interaction.reply(ephemeral(simple({ accent: config.colors.primary, lines })));
}

async function runDelete(interaction) {
  const id = interaction.options.getString('id', true).trim();
  const removed = removeTimedMessage(id);
  return interaction.reply(
    removed
      ? ok([`🗑️ Deleted timed message \`${id}\`.`], config.colors.success, true)
      : fail('No timed message with that ID. Check `/timedmsg list`.'),
  );
}

export async function execute(interaction) {
  if (!canUse(interaction)) {
    return interaction.reply(fail('⛔ You are not allowed to use this command.'));
  }
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return runCreate(interaction);
  if (sub === 'list') return runList(interaction);
  if (sub === 'delete') return runDelete(interaction);
}
