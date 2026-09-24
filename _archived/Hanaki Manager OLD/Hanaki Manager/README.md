# Hanaki Manager

A Discord management bot for a **Rust server community**. Every message it sends is rendered with **Discord Components V2** (no classic embeds).

## Features

- **Welcome messages** — greets new members in a configured channel.
- **Advanced ticket system** — a support panel with category buttons; each ticket opens a private channel with claim / close / transcript controls.
- **Wipe scheduler** — `/send wipe` posts a wipe announcement with a live countdown **and** auto-posts reminders + a "wipe is LIVE" message at the scheduled time.
- **Word blacklist** — auto-deletes messages containing blacklisted words, with optional auto-timeout for repeat offenders.
- **Moderation** — `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/warnings`, `/clearwarn`, `/purge`, all logged to a mod-log channel.

## Requirements

- **Node.js 20 LTS or newer**
- A Discord application + bot token

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create the bot & get credentials** at <https://discord.com/developers/applications>
   - Create a New Application.
   - Go to **Bot** → *Reset Token* → copy the token.
   - Go to **General Information** → copy the *Application ID* (this is `CLIENT_ID`).
   - On the **Bot** page, enable these **Privileged Gateway Intents**:
     - ✅ **Server Members Intent** (welcome messages)
     - ✅ **Message Content Intent** (word blacklist scanning)

3. **Configure secrets** — copy `.env.example` to `.env` and fill it in:
   ```
   DISCORD_TOKEN=your-bot-token
   CLIENT_ID=your-application-id
   GUILD_ID=your-test-server-id   # optional; enables instant command deploys
   ```

4. **Configure the bot** — edit `config.json` and fill in the channel / role / category IDs
   (enable Developer Mode in Discord → right-click → *Copy ID*).

5. **Invite the bot** to your server with the `bot` and `applications.commands` scopes and these
   permissions: *Manage Channels, Kick Members, Ban Members, Moderate Members, Manage Messages,
   Read Message History, Send Messages*.

6. **Register slash commands**
   ```bash
   npm run deploy
   ```

7. **Start the bot**
   ```bash
   npm start
   ```

## Commands

| Command | Description |
|---------|-------------|
| `/send panel` | Post the ticket support panel in the current channel. |
| `/send wipe month: day: year: hour: [minute] [type] [channel] [note]` | Announce a server wipe and schedule reminders. |
| `/ban` `/unban` `/kick` | Remove or re-admit members. |
| `/timeout` `/untimeout` | Temporarily mute a member (duration like `10m`, `1h`, `1d`). |
| `/warn` `/warnings` `/clearwarn` | Manage a member's warning history. |
| `/purge <count> [user]` | Bulk-delete recent messages. |
| `/blacklist add\|remove\|list` | Manage the blacklisted-words list. |

## Notes

- Data is stored as JSON files under `src/data/` (auto-created, git-ignored).
- Moderation and admin commands are gated by Discord permissions via `setDefaultMemberPermissions`,
  so they only appear for staff who have the relevant permission.
