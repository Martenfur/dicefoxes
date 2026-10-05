# AGENTS.md — dicefoxes working rules

This file is for agents working in this repo. Follow it for every change.

## Scope

- Discord bot wiring, a pure line-based command parser, and a dice resolver
  with a batched randomness module.
- Do not touch `.env`. It already exists and holds secrets. If a new variable
  is needed, stop and ask the maintainer instead of editing it.
- Do not touch `README.md` either. The maintainer writes it; it is the spec,
  not a doc to keep in sync. If code and README disagree, ask instead of
  editing the README.

## Runtime

- Node.js `>=20.11.0`, ESM only (`"type": "module"` in `package.json`).
- Imports always use explicit `.js` extensions: `from './bot.js'`.
- `index.js` is the entry point. It loads `dotenv/config` first, then calls
  `startBot(process.env.DISCORD_TOKEN)`.
- Secrets come only from `process.env` (loaded from `.env` via `dotenv`).
  No second source, no fallback file, no hardcoded tokens.
- Dependencies: `discord.js@^14`, `dotenv@^16`.
- Scripts: `npm start` → `node index.js`, `npm run dev` → `node --watch index.js`.

## Code style

- Encoding UTF-8, line endings LF, one trailing newline, no trailing whitespace.
- Indentation: **tabs**, display width 2. Spaces only in `*.md` list nesting
  and in `*.json` files (2 spaces).
- Quotes: single quotes for strings. Semicolons at statement ends.
- Braces: **Allman style — opening brace on its own line**. This applies to
  everything: functions, classes, methods, `if` / `else`, `for`, `while`,
  `try` / `catch`, and multi-line arrow bodies.
- Correct:
  ```js
  export function findCommand(token)
  {
  	return COMMANDS.find((command) => command.aliases.includes(token)) ?? null;
  }
  ```
  (example only — real trigger logic lives in `src/commands.js`).
- Wrong: `function f() {` on one line.
- JSDoc on every exported function (params + return in `@param` / `@returns`).
- File layout: `src/bot.js` holds everything Discord-specific and stays thin.
  `src/commands.js` holds the pure command parser (text in, text out).
  Each command lives in its own `src/commands/<name>.js` and is registered
  in `COMMANDS` inside `src/commands.js`. Every entry needs `args` and
  `description`: `dfhelp` renders the whole registry from those fields.
  Commands with subcommands expose them via `subcommands`; `dfhelp`
  lists those instead of the parent line.
  `src/dice.js` is the pure formula resolver, `src/random.js` the batched
  randomness module behind it (one `rollBatch` call per formula).
  `src/macrostore.js` persists macros to `userdata.json` (gitignored,
  written on every mutation); it is the only module touching the filesystem.
  `src/dice.js`, `src/random.js`, and command files must not import Discord,
  `process.env`, or time.
- Log lines are prefixed `[dicefoxes]`.

## Discord bot rules

- Intents: `Guilds`, `GuildMessages`, `MessageContent` (privileged — also
  enable it in the developer portal), `DirectMessages`. Partial: `Channel`.
- Ignore any message from a bot author to avoid self-replies.
- Parsing lives in `src/commands.js` and is line-based: each line is scanned for
  the first whole-word trigger, anywhere in the line, so `kok: roll 1d20`
  counts. Matching is case-insensitive but never fires inside another word
  (`rolling`, `troll` are ignored). `roll` has alias `ролл`. Lines without a
  trigger are skipped; text before the trigger is dropped and the trimmed
  rest is the argument.
- Per-user state (character pins) arrives via the command context: the bot
  passes `{ userId: message.author?.id }` into `renderCommands`.
- `roll <formula>` replies with the total plus the annotated formula:
  `**<total>**` on the first line, `-# <annotated>` (subtext) on the second.
  With `DC<n>` / `ДС<n>` the total line gains `<emoji>` and the
  subtext gains `vs DC <n>`. Bad formulas are skipped silently (false
  positives) and logged with the reason and channel id; bare `roll`
  replies with a usage hint. Reply blocks are joined with `\n` into a single
  `channel.send`. Empty results send nothing.
- Replies wait `options.replyDelayMs` before sending (default 250ms).
  Pass `0` to reply immediately.
- Wrap `channel.send` in `try/catch` and log a warning with the channel id.
  Never let one message take down the bot.
- Missing `DISCORD_TOKEN` is a startup throw with a message telling the user
  to fill in `.env`. Never log the token value.
