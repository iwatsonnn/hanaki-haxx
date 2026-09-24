# Hanaki bots

Three bots, three Discord accounts, one command.

```
npm start                      # start all three
npm run list                   # show what would start, then exit
node start-all.mjs --only=admin,guild2
```

Ctrl+C stops everything. Each bot runs as its own process, so one crashing never
takes the others down — it restarts on its own with a backoff.

## The bots

| key | folder | account | guild |
|---|---|---|---|
| `manager` | `hanaki-vps/` | `…19731` | `1469742995619446794` |
| `guild2` | `hanaki-guild2/` | `…89771` | `1493376457450193077` |
| `admin` | `HanakaiAdmin/Admintrack/` | Haxxor | RCON log watcher |

## What was wrong, and what fixed it

**Symptoms:** tickets rolled back to an older state, and closing a ticket failed
with *"This is not a ticket channel."*

**Cause:** `4man/Manager/` and `hanaki-vps/` held the **same bot token** — byte
for byte, the same Discord account on the same guild. They were not two bots;
they were one bot started twice. Both processes received every interaction, and
each one held the whole of `tickets.json` in memory and wrote it back whole, so
whichever saved last silently erased the other's changes. A ticket opened by one
process was missing from the other's file, so Close couldn't find it.

The `.env` files had also been crossed over between folders, which is how the
duplicate arose in the first place.

Three fixes, so it cannot recur:

1. **One process per account.** Each bot claims a lock keyed on its *token* (in
   the OS temp dir, so a copied folder is caught too) and refuses to start if
   that account is already running. `start-all.mjs` also refuses to launch two
   bots sharing a token before anything starts.
2. **Locked writes.** `src/lib/store.js` does its read-modify-write inside an
   exclusive lock, so concurrent writes can't clobber each other. A lock left by
   a crashed process goes stale after 10s and is broken automatically. *(Without
   this, a 4-way concurrency test lost 172 of 240 writes and crashed on
   Windows.)*
3. **Close always works.** Any channel in the configured ticket category is a
   ticket. If one is missing from the store, it's rebuilt from the channel
   (recovering the opener from the permission overwrites), adopted, and closed
   normally instead of being refused.

## Ticket history

The two accounts' histories were separated and merged:

- `hanaki-vps` — **1385** tickets (the 1371 from `4man/Manager` plus 14 only in
  `hanaki-vps`; zero conflicts), 15 open.
- `hanaki-guild2` — **581** tickets for its own guild, 10 open.

`_archived/` holds the retired folders (`4man/`, `Hanaki Manager OLD/`). Don't
run them; see `_archived/README.txt`.

## If a bot won't start

- *"already running (pid N)"* — that account is live in another window. Stop it,
  or delete the lock file named in the message if you're sure it's stale.
- *"share the SAME bot token"* — two entries in `start-all.mjs` point at one
  account. Give one its own token or drop it with `--only=`.
- *Missing intents / invalid token* — the bot prints the exact portal steps.
  These exit without restart-looping, so read the error above the exit line.
