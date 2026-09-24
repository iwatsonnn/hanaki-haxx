import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  FileBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { config } from '../config.js';
import { read, update } from '../lib/store.js';
import { container, td, separator, simple, ephemeral, CV2_FLAG } from '../lib/cv2.js';
import { discordTime } from '../lib/timeParse.js';
import { logAction } from '../lib/modlog.js';
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

/**
 * Apply a change to one ticket under the store's write lock.
 *
 * Reading the whole list, editing it and writing it back is only safe if
 * nothing else writes in between, so the read-modify-write happens inside
 * update(). `mutate` receives the matching ticket and returns its replacement;
 * returning nothing leaves the list untouched.
 */
function updateTicket(channelId, mutate) {
  let updated = null;
  update(STORE, [], (list) => {
    const tickets = Array.isArray(list) ? list : [];
    const i = tickets.findIndex((t) => t.channelId === channelId);
    if (i === -1) return tickets;
    const next = mutate({ ...tickets[i] });
    if (!next) return tickets;
    tickets[i] = next;
    updated = next;
    return tickets;
  });
  return updated;
}

function addTicket(ticket) {
  update(STORE, [], (list) => {
    const tickets = Array.isArray(list) ? list : [];
    // A channel id is unique, so a repeat means a retry — replace, don't duplicate.
    const i = tickets.findIndex((t) => t.channelId === ticket.channelId);
    if (i === -1) tickets.push(ticket);
    else tickets[i] = ticket;
    return tickets;
  });
}

function findByChannel(channelId) {
  return loadTickets().find((t) => t.channelId === channelId);
}

/**
 * Find a ticket, falling back to rebuilding one from the channel itself.
 *
 * Tickets used to be split across several copies of this bot, so a channel
 * created by one copy can be missing from this copy's store — which used to
 * make Close fail with "This is not a ticket channel" on a real ticket. Any
 * channel sitting in the configured ticket category is a ticket, so recover a
 * usable record from it and adopt it into the store rather than refusing.
 */
function resolveTicket(channel) {
  if (!channel) return null;

  const known = findByChannel(channel.id);
  if (known) return known;

  if (!config.tickets.categoryId || channel.parentId !== config.tickets.categoryId) return null;

  const recovered = {
    channelId: channel.id,
    guildId: channel.guildId,
    // The opener is recorded in the channel's permission overwrites: the one
    // member (non-role) granted access when the ticket was created.
    userId:
      [...(channel.permissionOverwrites?.cache?.values() ?? [])]
        .find((o) => o.type === 1 && o.id !== channel.client.user.id)?.id ?? null,
    category: config.tickets.categories?.[0]?.key ?? 'general',
    server: null,
    claimedBy: null,
    status: 'open',
    createdAt: channel.createdTimestamp ?? Date.now(),
    recovered: true,
  };

  addTicket(recovered);
  console.warn(`[tickets] Adopted untracked ticket channel #${channel.name} (${channel.id}) into the store.`);
  return recovered;
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

function serverLabel(key) {
  const servers = config.tickets.servers ?? [];
  return servers.find((s) => s.key === key)?.label ?? null;
}

/**
 * Step 1 of the ticket flow: the user picked a category, now ask which server.
 * With a single configured server we skip straight to the form.
 */
function openServerPicker(interaction, categoryKey) {
  // A button interaction token is only valid for ~3s and showModal must be the
  // FIRST response to it, so this path stays synchronous — no awaits, no I/O.
  const servers = config.tickets.servers ?? [];
  if (servers.length <= 1) {
    return openTicketForm(interaction, categoryKey, servers[0]?.key ?? null);
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket:server:${categoryKey}`)
    .setPlaceholder('Choose a server')
    .addOptions(
      servers.slice(0, 25).map((s) => ({ label: s.label.slice(0, 100), value: s.key })),
    );

  return interaction.reply(
    ephemeral({
      ...simple({
        accent: config.colors.primary,
        lines: [`### ${categoryLabel(categoryKey)}`, 'Which server is this ticket for?'],
        rows: [new ActionRowBuilder().addComponents(menu)],
      }),
    }),
  );
}

/**
 * Step 2: show the support form. The category and server ride along in the
 * modal's custom id so the submit handler knows what was chosen.
 */
function openTicketForm(interaction, categoryKey, serverKey) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket:form:${categoryKey}:${serverKey ?? 'none'}`)
    .setTitle(`${config.tickets.formTitle ?? 'Support Ticket'}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ign')
        .setLabel('In-game username / Gamertag')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('topic')
        .setLabel('What do you need help with?')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(200)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('details')
        .setLabel('Please describe the issue')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1500)
        .setRequired(true),
    ),
  );

  return interaction.showModal(modal);
}

async function createTicket(interaction, categoryKey, forUser = null, details = null) {
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

  const memberAccess = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];

  // Only include staff roles that actually exist in this guild — Discord rejects
  // the entire create() call if any overwrite target can't be resolved.
  const staffRoleIds = config.tickets.staffRoleIds.filter((id) => guild.roles.cache.has(id));
  const missingRoles = config.tickets.staffRoleIds.filter((id) => !guild.roles.cache.has(id));
  if (missingRoles.length) {
    console.warn(`[tickets] Ignoring staff role IDs not found in guild: ${missingRoles.join(', ')}`);
  }

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: memberAccess },
    ...staffRoleIds.map((id) => ({ id, allow: memberAccess })),
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
    server: details?.server ?? null,
    claimedBy: null,
    status: 'open',
    createdAt: Date.now(),
  };
  addTicket(ticket);

  const mentions = [`<@${user.id}>`, ...config.tickets.staffRoleIds.map((id) => `<@&${id}>`)].join(' ');
  await channel.send({
    ...simple({ lines: [mentions] }),
    allowedMentions: { users: [user.id], roles: config.tickets.staffRoleIds },
  });
  await channel.send(buildControl(ticket));

  // Post the submitted form so staff see the details without asking again.
  if (details) {
    const c = container(config.colors.primary);
    c.addTextDisplayComponents(td('### 📝 Ticket details'));
    c.addSeparatorComponents(separator());
    const lines = [
      `**In-game username:** ${details.ign}`,
      `**Needs help with:** ${details.topic}`,
    ];
    const label = serverLabel(details.server);
    if (label) lines.splice(1, 0, `**Server:** ${label}`);
    c.addTextDisplayComponents(td(lines.join('\n')));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(td(`**Issue:**\n${details.details}`));
    await channel.send({
      components: [c],
      flags: CV2_FLAG,
      allowedMentions: { parse: [] },
    });
  }

  return interaction.editReply(
    simple({ accent: config.colors.success, lines: [`✅ Ticket created: <#${channel.id}>`] }),
  );
}

async function claimTicket(interaction) {
  const ticket = resolveTicket(interaction.channel);
  if (!ticket) return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  if (!isStaff(interaction.member)) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['Only staff can claim tickets.'] })));
  }
  if (ticket.claimedBy) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.warning, lines: [`Already claimed by <@${ticket.claimedBy}>.`] })));
  }

  // Claim under the lock so two staff clicking at once can't both win.
  const claimed = updateTicket(ticket.channelId, (t) => {
    if (t.claimedBy) return null;
    t.claimedBy = interaction.user.id;
    return t;
  });

  if (!claimed) {
    const current = findByChannel(ticket.channelId);
    return interaction.reply(
      ephemeral(simple({ accent: config.colors.warning, lines: [`Already claimed by <@${current?.claimedBy ?? 'someone else'}>.`] })),
    );
  }

  await interaction.update(buildControl(claimed));
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
  const ticket = resolveTicket(channel);
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

  const closed = updateTicket(channel.id, (t) => ({
    ...t,
    status: 'closed',
    closedAt: Date.now(),
    closedBy: interaction.user.id,
  }));

  // The channel is about to be deleted, so a ticket that somehow still isn't in
  // the store must be recorded now or its close is lost entirely.
  if (!closed) {
    addTicket({ ...ticket, status: 'closed', closedAt: Date.now(), closedBy: interaction.user.id });
  }

  await interaction.editReply(simple({ accent: config.colors.danger, lines: [`🔒 Ticket closed by <@${interaction.user.id}>. This channel will be deleted in 5 seconds.`] }));
  setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => {}), 5000);
}

/**
 * The confirm button on /ticket purge.
 *
 * The reply is edited to a "working" state first: deleting many channels takes
 * well past the 3s interaction window, and this also disarms the button so a
 * second click cannot start a concurrent purge.
 */
async function confirmPurge(interaction, scope) {
  if (!isStaff(interaction.member)) {
    return interaction.reply(
      ephemeral(simple({ accent: config.colors.danger, lines: ['Only staff can purge tickets.'] })),
    );
  }

  await interaction.update(
    simple({ accent: config.colors.warning, lines: ['🗑️ Purging tickets…'] }),
  );

  const { deleted, cleared, failed } = await purgeTickets(
    interaction.guild,
    scope === 'all' ? 'all' : 'closed',
    interaction.user,
  );

  const lines = [
    '## 🗑️ Ticket purge complete',
    `**Channels deleted:** ${deleted}`,
    `**Records cleared:** ${cleared}`,
  ];
  if (failed.length) {
    lines.push(`⚠️ **Failed to delete ${failed.length}:** ${failed.slice(0, 10).join(', ')}`);
  }

  await interaction.editReply(simple({ accent: config.colors.success, lines }));

  return logAction(interaction.guild, {
    action: 'Ticket purge',
    emoji: '🗑️',
    moderator: interaction.user,
    reason: scope === 'all' ? 'Purged all tickets' : 'Purged closed tickets',
    extra: [`**Channels deleted:** ${deleted}`, `**Records cleared:** ${cleared}`],
    color: config.colors.danger,
  });
}

async function sendTranscript(interaction) {
  const channel = interaction.channel;
  const ticket = resolveTicket(channel);
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

// --- /ticket purge ------------------------------------------------------------
//
// Purging deletes ticket CHANNELS and drops their stored records. Transcripts
// already delivered to the log channel are untouched, so the audit trail of
// what was said survives even though the channel does not.

/**
 * Every channel in the ticket category, whether or not the store knows it.
 *
 * Orphans matter here: a channel created by an older copy of this bot has no
 * record, and a purge that only walked the store would leave it behind forever.
 */
function ticketChannels(guild) {
  const categoryId = config.tickets.categoryId;
  if (!categoryId) return [];
  return [...guild.channels.cache.values()].filter(
    (ch) => ch.parentId === categoryId && ch.type === ChannelType.GuildText,
  );
}

function isClosed(ticket) {
  // An unknown channel (no record at all) counts as closed: nobody is tracking
  // it, so it cannot be an active conversation anyone is waiting on.
  return !ticket || ticket.status !== 'open';
}

function selectForPurge(guild, scope) {
  const byId = new Map(loadTickets().map((t) => [t.channelId, t]));
  const channels = ticketChannels(guild).filter(
    (ch) => scope === 'all' || isClosed(byId.get(ch.id)),
  );

  const channelIds = new Set(channels.map((ch) => ch.id));
  // Records whose channel is already gone are cleared too — that is the
  // leftover state a purge is meant to tidy up.
  const records = loadTickets().filter((t) => {
    if (t.guildId !== guild.id) return false;
    if (channelIds.has(t.channelId)) return true;
    const gone = !guild.channels.cache.has(t.channelId);
    return gone && (scope === 'all' || isClosed(t));
  });

  return { channels, records };
}

export function countPurgeable(guild, scope) {
  const { channels, records } = selectForPurge(guild, scope);
  return { channels: channels.length, records: records.length };
}

/**
 * Delete the selected channels and drop their records.
 *
 * Channels are deleted one at a time rather than in parallel: Discord rate
 * limits channel deletion hard, and a burst of 50 gets throttled into failures.
 */
export async function purgeTickets(guild, scope, byUser) {
  const { channels, records } = selectForPurge(guild, scope);

  let deleted = 0;
  const failed = [];
  for (const channel of channels) {
    try {
      await channel.delete(`Ticket purge by ${byUser.tag}`);
      deleted += 1;
    } catch (err) {
      console.error(`[tickets] purge: failed to delete #${channel.name}:`, err);
      failed.push(channel.name);
    }
  }

  const purgedIds = new Set(records.map((t) => t.channelId));
  let cleared = 0;
  update(STORE, [], (list) => {
    const tickets = Array.isArray(list) ? list : [];
    const next = tickets.filter((t) => !(t.guildId === guild.id && purgedIds.has(t.channelId)));
    cleared = tickets.length - next.length;
    return next;
  });

  return { deleted, cleared, failed };
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
  const ticket = resolveTicket(channel);
  if (!ticket) {
    return interaction.reply(ephemeral(simple({ accent: config.colors.danger, lines: ['This is not a ticket channel.'] })));
  }
  await interaction.deferReply();
  return finalizeClose(interaction, channel, ticket, reason?.trim() || 'No reason provided');
}

// /addmember — add a specific member to the current ticket channel.
export async function addMemberToTicket(interaction, member) {
  const channel = interaction.channel;
  const ticket = resolveTicket(channel);
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

export async function handleTicketSelect(interaction) {
  const [, action, categoryKey] = interaction.customId.split(':');
  if (action !== 'server') return undefined;
  return openTicketForm(interaction, categoryKey, interaction.values[0]);
}

export async function handleTicketButton(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  switch (action) {
    case 'create':
      return openServerPicker(interaction, arg);
    case 'claim':
      return claimTicket(interaction);
    case 'close':
      return openCloseModal(interaction);
    case 'transcript':
      return sendTranscript(interaction);
    case 'purge':
      return confirmPurge(interaction, arg);
    case 'purge-cancel':
      return interaction.update(
        simple({ accent: config.colors.primary, lines: ['Purge cancelled. Nothing was deleted.'] }),
      );
    default:
      return undefined;
  }
}

export async function handleTicketModal(interaction) {
  if (interaction.customId === 'ticket:close-modal') return closeTicket(interaction);

  if (interaction.customId.startsWith('ticket:form:')) {
    const [, , categoryKey, serverKey] = interaction.customId.split(':');
    return createTicket(interaction, categoryKey, null, {
      ign: interaction.fields.getTextInputValue('ign').trim(),
      topic: interaction.fields.getTextInputValue('topic').trim(),
      details: interaction.fields.getTextInputValue('details').trim(),
      server: serverKey === 'none' ? null : serverKey,
    });
  }

  return undefined;
}
