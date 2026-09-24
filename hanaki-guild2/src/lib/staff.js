import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

export function isStaff(member) {
  if (!member || !member.permissions) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const staffRoles = config.staffRoleIds ?? [];
  return staffRoles.some((id) => member.roles.cache.has(id));
}
