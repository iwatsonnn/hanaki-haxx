import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  MessageFlags,
} from 'discord.js';

export const CV2_FLAG = MessageFlags.IsComponentsV2;

export function td(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function separator() {
  return new SeparatorBuilder();
}

export function section(lines, button) {
  const s = new SectionBuilder();
  for (const line of [].concat(lines)) s.addTextDisplayComponents(td(line));
  if (button) s.setButtonAccessory(button);
  return s;
}

export function container(accent) {
  const c = new ContainerBuilder();
  if (accent != null) c.setAccentColor(accent);
  return c;
}

export function payload(...components) {
  return { components: components.flat(), flags: CV2_FLAG };
}

export function ephemeral(pay) {
  return { ...pay, flags: (pay.flags ?? 0) | MessageFlags.Ephemeral };
}

export function simple({ accent, lines = [], rows = [] } = {}) {
  const c = container(accent);
  for (const line of lines) {
    if (line === '---') c.addSeparatorComponents(separator());
    else c.addTextDisplayComponents(td(line));
  }
  for (const row of rows) c.addActionRowComponents(row);
  return payload(c);
}
