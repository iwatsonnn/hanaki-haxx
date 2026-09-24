import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { fail } from '../lib/replies.js';
import { forceCreateTicket } from '../tickets/ticketActions.js';

const categoryChoices = config.tickets.categories.map((c) => ({ name: c.label, value: c.key }));

// Staff-role-only: must hold one of the configured ticket staff roles.
// Deliberately does NOT grant access via Administrator permission.
function isTicketStaff(member) {
  if (!member) return false;
  const staffRoles = config.tickets.staffRoleIds ?? [];
  return staffRoles.some((id) => member.roles.cache.has(id));
}

export const data = new SlashCommandBuilder()
  .setName('forceticket')
  .setDescription('Open a ticket on behalf of another member.')
  .addUserOption((o) => o.setName('member').setDescription('The member to open a ticket for').setRequired(true))
  .addStringOption((o) => {
    o.setName('category').setDescription('Ticket category').setRequired(true);
    if (categoryChoices.length) o.addChoices(...categoryChoices);
    return o;
  });

export async function execute(interaction) {
  if (!isTicketStaff(interaction.member)) {
    return interaction.reply(fail('⛔ Only staff can force-open tickets.'));
  }
  const target = interaction.options.getUser('member', true);
  const category = interaction.options.getString('category', true);
  return forceCreateTicket(interaction, target, category);
}