import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

import { config } from '../config.js';
import { simple, ephemeral } from '../lib/cv2.js';
import { fail } from '../lib/replies.js';
import { countPurgeable } from '../tickets/ticketActions.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket administration.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((s) =>
    s
      .setName('purge')
      .setDescription('Delete ticket channels and clear their records.')
      .addStringOption((o) =>
        o
          .setName('scope')
          .setDescription('Which tickets to delete (default: closed only)')
          .addChoices(
            { name: 'Closed tickets only', value: 'closed' },
            { name: 'Every ticket, including open ones', value: 'all' },
          ),
      ),
  );

// Deliberately stricter than the command's ManageChannels default: purging is
// irreversible, so it is limited to the configured ticket staff roles.
function isTicketStaff(member) {
  if (!member) return false;
  return (config.tickets.staffRoleIds ?? []).some((id) => member.roles.cache.has(id));
}

export async function execute(interaction) {
  if (interaction.options.getSubcommand() !== 'purge') return undefined;

  if (!isTicketStaff(interaction.member)) {
    return interaction.reply(fail('⛔ Only ticket staff can purge tickets.'));
  }

  const scope = interaction.options.getString('scope') ?? 'closed';
  const { channels, records } = countPurgeable(interaction.guild, scope);

  if (!channels && !records) {
    return interaction.reply(
      ephemeral(
        simple({
          accent: config.colors.warning,
          lines: [
            scope === 'all'
              ? 'There are no ticket channels or records to purge.'
              : 'There are no **closed** tickets to purge. Use `scope: Every ticket` to include open ones.',
          ],
        }),
      ),
    );
  }

  // Confirmation is required rather than optional: the action deletes channels
  // and their conversation history outright, and cannot be undone.
  const lines = [
    '## ⚠️ Confirm ticket purge',
    scope === 'all'
      ? 'This deletes **every** ticket channel in the ticket category, **including open ones**.'
      : 'This deletes the ticket channels of **closed** tickets.',
    '',
    `**Channels to delete:** ${channels}`,
    `**Records to clear:** ${records}`,
    '',
    '-# Channels and their message history are deleted permanently. Transcripts already sent to the log channel are kept.',
  ];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:purge:${scope}`)
      .setLabel(`Delete ${channels} channel(s)`)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId('ticket:purge-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return interaction.reply(
    ephemeral(simple({ accent: config.colors.danger, lines, rows: [row] })),
  );
}
