import { simple, ephemeral } from '../lib/cv2.js';
import { config } from '../config.js';
import { isStaff } from '../lib/staff.js';
import { handleTicketButton, handleTicketModal, handleTicketSelect } from '../tickets/ticketActions.js';

export const name = 'interactionCreate';

async function safeError(interaction, message) {
  const payload = ephemeral(simple({ accent: config.colors.danger, lines: [message] }));
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {

  }
}

export async function execute(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // /timedmsg has its own user allowlist and bypasses the staff-only gate.
      if (interaction.commandName !== 'timedmsg' && !isStaff(interaction.member)) {
        return interaction.reply(
          ephemeral(simple({ accent: config.colors.danger, lines: ['⛔ This command is staff-only.'] })),
        );
      }

      return await command.execute(interaction, client);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketButton(interaction, client);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketSelect(interaction, client);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketModal(interaction, client);
    }
  } catch (err) {
    const id = interaction.commandName ?? interaction.customId;
    // 10062 means Discord expired the interaction token (3s to respond, and a
    // modal must be the first response). Nothing can be sent back at this point.
    if (err?.code === 10062) {
      const age = Date.now() - interaction.createdTimestamp;
      console.error(`[interaction] ${id}: interaction expired before we responded (${age}ms). Discord allows 3s.`);
      return;
    }
    console.error(`[interaction] Error handling ${id}:`, err);
    await safeError(interaction, '❌ Something went wrong while handling that interaction.');
  }
}
