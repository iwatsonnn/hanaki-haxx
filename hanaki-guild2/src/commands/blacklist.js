import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { simple, ephemeral } from '../lib/cv2.js';
import { getWords, addWord, removeWord } from '../lib/blacklist.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Manage the blacklisted-words filter.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((s) => s.setName('add').setDescription('Add a word to the blacklist').addStringOption((o) => o.setName('word').setDescription('Word or phrase to block').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a word from the blacklist').addStringOption((o) => o.setName('word').setDescription('Word or phrase to unblock').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('List all blacklisted words'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'add') {
    const word = interaction.options.getString('word', true);
    const added = addWord(guildId, word);
    return interaction.reply(added ? ok([`✅ Added \`${word.toLowerCase()}\` to the blacklist.`], config.colors.success, true) : fail('That word is already blacklisted.'));
  }

  if (sub === 'remove') {
    const word = interaction.options.getString('word', true);
    const removed = removeWord(guildId, word);
    return interaction.reply(removed ? ok([`🗑️ Removed \`${word.toLowerCase()}\` from the blacklist.`], config.colors.success, true) : fail('That word is not on the blacklist.'));
  }

  const words = getWords(guildId);
  const lines = ['## 🚫 Blacklisted words', `**Total:** ${words.length}`];
  lines.push(words.length ? words.map((w) => `\`${w}\``).join(', ') : '_The blacklist is empty._');
  return interaction.reply(ephemeral(simple({ accent: config.colors.warning, lines })));
}
