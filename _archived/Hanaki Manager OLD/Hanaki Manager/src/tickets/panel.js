import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { container, td } from '../lib/cv2.js';
import { CV2_FLAG } from '../lib/cv2.js';

export function buildPanel() {
  const c = container(config.colors.primary);
  c.addTextDisplayComponents(
    td(`# ${config.tickets.panelTitle}`),
    td(config.tickets.panelDescription),
  );

  const buttons = config.tickets.categories.map((cat) =>
    new ButtonBuilder()
      .setCustomId(`ticket:create:${cat.key}`)
      .setLabel(cat.label)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(cat.emoji),
  );

  for (let i = 0; i < buttons.length; i += 5) {
    c.addActionRowComponents(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  return { components: [c], flags: CV2_FLAG };
}
