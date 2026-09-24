import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  FileBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { config } from '../config.js';
import { read, write } from '../lib/store.js';
import { container, td, separator, simple, ephemeral, CV2_FLAG } from '../lib/cv2.js';
import { discordTime } from '../lib/timeParse.js';
import { buildTranscript } from './transcript.js';

const STORE = 'tickets';
const EPHEMERAL = MessageFlags.Ephemeral;

function categoryLabel(key) {
  return config.tickets.categories.find((c) => c.key === key)?.label ?? key;
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  return config.tickets.staffRoleIds.some((id) => member.roles.cache.has(id));
}

function loadTickets() {
  const data = read(STORE, []);
  return Array.isArray(data) ? data : [];
}

function saveTickets(list) {
  write(STORE, list);
}

function findByChannel(channelId) {
  return loadTickets().find((t) => t.channelId === channelId);
}

function findOpenByUser(guildId, userId) {
  return loadTickets().find((t) => t.guildId === guildId && t.userId === userId && t.status === 'open');
}

function buildControl(ticket) {
  const c = container(config.colors.primary);
  c.addTextDisplayComponents(
    td(`# 🎫 ${categoryLabel(ticket.category)}`),
    td(`Opened by <@${ticket.userId}> • ${discordTime(Math.floor(ticket.createdAt / 1000), 'R')}`),
  );
  c.addSeparatorComponents(separator());
  c.addTextDisplayComponents(
    ticket.claimedBy
      ? td(`**Claimed by:** <@${ticket.claimedBy}>`)
      : td('A staff member will be with you shortly. Describe your issue in as much detail as you can.'),
  );
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:claim')
        .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🙋')
        .setDisabled(Boolean(ticket.claimedBy)),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId('ticket:transcript').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
    ),
  );
  return { components: [c], flags: CV2_FLAG };
}

function transcriptPayload(accent, lines, attachment) {
  const c = container(accent);
  for (const line of lines) c.addTextDisplayComponents(td(line));
  const out = { components: [c], flags: CV2_FLAG };
  if (attachment) {
    c.addFileComponents(new FileBuilder({ file: { url: `attachment://${attachment.name}` } }));
    out.files = [attachment];
  }
  return out;
}

async function createTicket(interaction, categoryKey, forUser = null) {
  const { guild } = interaction;
  // forUser lets staff open a ticket on someone else's behalf (/forceticket).
  const user = forUser ?? interaction.user;
  const onBehalf = Boolean(forUser) && forUser.id !== interaction.user.id;

  if (!config.tickets.categoryId) {
    return interaction.reply(
      ephemeral(simple({ accent: config.colors.danger, lines: ['⚠️ Tickets are not configured yet. Ask an admin to set `tickets.categoryId` in `config.json`.'] })),
    );
  }

  const existing = findOpenByUser(guild.id, user.id);
  if (existing && guild.channels.cache.has(existing.channelId)) {
    return interaction.reply(
      ephemeral(simple({ accent: config.colors.warning, lines: [`${onBehalf ? `<@${user.id}> already has` : 'You already have'} an open ticket: <#${existing.channelId}>`] })),
    );
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...config.tickets.staffRoleIds.map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    })),
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      parent: config.tickets.categoryId,
      topic: `Ticket for ${user.tag} • ${categoryLabel(categoryKey)}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    console.error('[tickets] channel create failed:', err);
    return interaction.editReply(
      simple({ accent: config.colors.danger, lines: ['❌ Failed to create your ticket channel. Check the bot has **Manage Channels** and that `tickets.categoryId` is valid.'] }),
    );
  }

  const ticket = {
    channelId: channel.id,
    guildId: guild.id,
    userId: user.id,
    category: categoryKey,
    claimedBy: null,
    status: 'open',
    createdAt: Date.now(),
  };
  const tickets = loadTickets();
  tickets.push(ticket);
  saveTickets(tickets);

  const mentions = [`<@${user.id}>`, ...config.tickets.staffRoleIds.map((id) => `<@&${id}>`)].join(' ');
  await channel.send({
    ...simple({ lines: [mentions] }),
    allowedMentions: { users: [user.id], roles: config.tickets.staffRoleIds },
  });
  await channel.send(buildControl(ticket));

  return interaction.editReply(
    simple({ accent: config.colors.success, lines: [`✅ Ticket created: <#${channel.id}>`] }),
  );
}

async function claimTicket(interaction) {
  const ticket = findByChannel(interaction.channelId);
  if (!ticket) return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  if (!isStaff(interaction.member)) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['Only staff can claim tickets.'] })));
  }
  if (ticket.claimedBy) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.warning, lines: [`Already claimed by <@${ticket.claimedBy}>.`] })));
  }

  ticket.claimedBy = interaction.user.id;
  saveTickets(loadTickets().map((t) => (t.channelId === ticket.channelId ? ticket : t)));

  await interaction.update(buildControl(ticket));
  await interaction.followUp(simple({ accent: config.colors.success, lines: [`🙋 Claimed by <@${interaction.user.id}>.`] }));
}

function openCloseModal(interaction) {
  const modal = new ModalBuilder().setCustomId('ticket:close-modal').setTitle('Close ticket');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400),
    ),
  );
  return interaction.showModal(modal);
}

async function closeTicket(interaction) {
  const channel = interaction.channel;
  const ticket = findByChannel(channel.id);
  if (!ticket) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  }

  await interaction.deferReply();
  const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'No reason provided';
  return finalizeClose(interaction, channel, ticket, reason);
}

// Shared close routine used by both the modal button and the /close command.
async function finalizeClose(interaction, channel, ticket, reason) {
  const attachment = await buildTranscript(channel).catch((err) => {
    console.error('[tickets] transcript failed:', err);
    return null;
  });
  const logChannelId = config.tickets.logChannelId;
  if (logChannelId) {
    const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel?.isTextBased?.()) {
      const summaryLines = [
        '## 📄 Ticket closed',
        `**Channel:** #${channel.name}`,
        `**Opened by:** <@${ticket.userId}>`,
        ticket.claimedBy ? `**Claimed by:** <@${ticket.claimedBy}>` : '**Claimed by:** —',
        `**Closed by:** <@${interaction.user.id}>`,
        `**Reason:** ${reason}`,
      ];
      await logChannel
        .send(transcriptPayload(config.colors.primary, summaryLines, attachment))
        .catch((err) => console.error('[tickets] failed to send transcript to log channel:', err));
    }
  }

  saveTickets(loadTickets().map((t) => (t.channelId === channel.id ? { ...t, status: 'closed', closedAt: Date.now(), closedBy: interaction.user.id } : t)));

  await interaction.editReply(simple({ accent: config.colors.danger, lines: [`🔒 Ticket closed by <@${interaction.user.id}>. This channel will be deleted in 5 seconds.`] }));
  setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => {}), 5000);
}

async function sendTranscript(interaction) {
  const channel = interaction.channel;
  const ticket = findByChannel(channel.id);
  if (!ticket) return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  if (!isStaff(interaction.member) && interaction.user.id !== ticket.userId) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['You cannot generate a transcript for this ticket.'] })));
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const attachment = await buildTranscript(channel).catch(() => null);
  if (!attachment) {
    return interaction.editReply(simple({ accent: config.colors.danger, lines: ['Failed to generate transcript.'] }));
  }
  return interaction.editReply(transcriptPayload(config.colors.primary, ['📄 Transcript attached.'], attachment));
}

export { isStaff, findByChannel };

// --- Slash command entry points ---

// /forceticket — staff opens a ticket on behalf of another member.
export async function forceCreateTicket(interaction, targetUser, categoryKey) {
  return createTicket(interaction, categoryKey, targetUser);
}

// /close — close the current ticket channel without a required reason.
export async function closeTicketCommand(interaction, reason) {
  const channel = interaction.channel;
  const ticket = findByChannel(channel?.id);
  if (!ticket) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  }
  await interaction.deferReply();
  return finalizeClose(interaction, channel, ticket, reason?.trim() || 'No reason provided');
}

// /addmember — add a specific member to the current ticket channel.
export async function addMemberToTicket(interaction, member) {
  const channel = interaction.channel;
  const ticket = findByChannel(channel?.id);
  if (!ticket) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  }
  try {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
  } catch (err) {
    console.error('[tickets] addMember failed:', err);
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['❌ Failed to add that member. Check the bot has **Manage Channels**.'] })));
  }
  return interaction.reply(simple({ accent: config.colors.success, lines: [`➕ <@${member.id}> was added to this ticket by <@${interaction.user.id}>.`] }));
}

export async function handleTicketButton(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  switch (action) {
    case 'create':
      return createTicket(interaction, arg);
    case 'claim':
      return claimTicket(interaction);
    case 'close':
      return openCloseModal(interaction);
    case 'transcript':
      return sendTranscript(interaction);
    default:
      return undefined;
  }
}

export async function handleTicketModal(interaction) {
  if (interaction.customId === 'ticket:close-modal') return closeTicket(interaction);
  return undefined;
}
