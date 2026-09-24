import { simple, ephemeral } from '../lib/cv2.js';
import { config } from '../config.js';
import { isStaff } from '../lib/staff.js';
import { handleTicketButton, handleTicketModal } from '../tickets/ticketActions.js';

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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketModal(interaction, client);
    }
  } catch (err) {
    console.error(`[interaction] Error handling ${interaction.commandName ?? interaction.customId}:`, err);
    await safeError(interaction, '❌ Something went wrong while handling that interaction.');
  }
}
