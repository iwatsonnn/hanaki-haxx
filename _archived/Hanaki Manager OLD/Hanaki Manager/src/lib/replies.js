import { config } from '../config.js';
import { simple, ephemeral } from './cv2.js';

export function ok(lines, accent = config.colors.success, isEphemeral = false) {
  const pay = simple({ accent, lines: [].concat(lines) });
  return isEphemeral ? ephemeral(pay) : pay;
}

export function fail(lines) {
  return ephemeral(simple({ accent: config.colors.danger, lines: [].concat(lines) }));
}

export async function dmUser(user, lines, accent = config.colors.warning) {
  try {
    await user.send(simple({ accent, lines: [].concat(lines) }));
    return true;
  } catch {
    return false;
  }
}
