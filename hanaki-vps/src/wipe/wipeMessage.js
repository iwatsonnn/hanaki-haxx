import { MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { config } from '../config.js';
import { container, td, separator, CV2_FLAG } from '../lib/cv2.js';
import { discordTime, formatDuration } from '../lib/timeParse.js';

export const WIPE_TYPES = {
  map: 'Map wipe',
  bp: 'Blueprint wipe',
  full: 'Map + Blueprint (full) wipe',
};

function typeLabel(wipe) {
  return WIPE_TYPES[wipe.type] ?? wipe.type;
}

function connectValue(wipe) {
  return wipe.connect || config.wipe.connect;
}

function finalize(c, wipe) {
  const roleId = wipe.roleToPingId || config.wipe.roleToPingId;
  const out = { components: [c], flags: CV2_FLAG };
  if (roleId) out.allowedMentions = { roles: [roleId] };
  return out;
}

function addPing(c, wipe) {
  const roleId = wipe.roleToPingId || config.wipe.roleToPingId;
  if (roleId) c.addTextDisplayComponents(td(`<@&${roleId}>`));
}

function addConnect(c, wipe) {
  const connect = connectValue(wipe);
  if (connect) c.addTextDisplayComponents(td(`**Connect:** \`${connect}\``));
}

export function renderAnnouncement(wipe) {
  const c = container(config.colors.primary);
  const url = wipe.bannerUrl || config.wipe.bannerUrl;
  if (url) {
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)),
    );
  }
  addPing(c, wipe);
  c.addTextDisplayComponents(
    td('# 🧨 SERVER WIPE'),
    td(`**When:** ${discordTime(wipe.unix, 'F')}  •  ${discordTime(wipe.unix, 'R')}`),
    td(`**Type:** ${typeLabel(wipe)}`),
  );
  addConnect(c, wipe);
  if (wipe.note) {
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(td(wipe.note));
  }
  return finalize(c, wipe);
}

export function renderReminder(wipe, secondsLeft) {
  const c = container(config.colors.warning);
  addPing(c, wipe);
  c.addTextDisplayComponents(
    td(`# ⏰ Wipe in ${formatDuration(secondsLeft * 1000)}`),
    td(`**${typeLabel(wipe)}** — ${discordTime(wipe.unix, 'R')} (${discordTime(wipe.unix, 't')})`),
  );
  addConnect(c, wipe);
  return finalize(c, wipe);
}

export function renderLive(wipe) {
  const c = container(config.colors.success);
  addPing(c, wipe);
  c.addTextDisplayComponents(
    td('# 🟢 Wipe is LIVE'),
    td(`The **${typeLabel(wipe)}** is complete — jump in now!`),
  );
  addConnect(c, wipe);
  return finalize(c, wipe);
}
