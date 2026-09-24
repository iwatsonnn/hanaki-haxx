import { MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { config } from '../config.js';
import { container, td, separator, CV2_FLAG } from '../lib/cv2.js';

// Render a single scheduled message container.
export function renderTimedMessage(msg) {
  const c = container(config.colors.primary);
  if (msg.image) {
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(msg.image)),
    );
  }
  if (msg.title) c.addTextDisplayComponents(td(`# ${msg.title}`));
  if (msg.body) c.addTextDisplayComponents(td(msg.body));
  if (msg.footer) {
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(td(`-# ${msg.footer}`));
  }
  return { components: [c], flags: CV2_FLAG };
}
