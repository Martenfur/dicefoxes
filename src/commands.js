/**
 * Line-based chat command parser.
 *
 * Pure text in, text out: this module never touches Discord, `process.env`,
 * or the clock, so it can be unit tested without a client.
 *
 * To add a command, create `src/commands/<name>.js` exporting a
 * `CommandDefinition` (`name`, `aliases`, `args`, `description`, `handle`;
 * see `roll.js`), then register it in {@link COMMANDS}:
 *
 * ```js
 * import { greetCommand } from './commands/greet.js';
 *
 * export const COMMANDS = [rollCommand, greetCommand];
 * ```
 */

import { dfhelpCommand } from './commands/dfhelp.js';
import { rollCommand } from './commands/roll.js';

/**
 * @typedef {object} CommandDefinition
 * @property {string} name canonical command name.
 * @property {string[]} aliases trigger words, matched as whole words anywhere in a line (case-insensitive).
 * @property {string} args usage placeholder, e.g. `<formula>`; empty when the command takes none.
 * @property {string} description one-two sentence summary for the help listing.
 * @property {(argument: string) => string} handle builds one reply line from the trimmed argument.
 */

/**
 * @typedef {object} ParsedCommand
 * @property {string} name canonical command name.
 * @property {string} alias the alias actually typed, lower-cased.
 * @property {string} argument everything after the keyword, trimmed.
 * @property {string} text the trimmed command string, starting at the trigger keyword.
 */

/**
 * @typedef {object} LineTrigger
 * @property {CommandDefinition} command the matched command.
 * @property {string} keyword the trigger word as typed.
 * @property {number} index 0-based offset of the trigger word inside the line.
 */

/**
 * Registry of known commands. Order decides nothing; aliases must be unique
 * across entries. Each entry lives in its own `src/commands/<name>.js` file.
 *
 * @type {CommandDefinition[]}
 */
export const COMMANDS = [rollCommand, dfhelpCommand];

/**
 * Find a command by name or alias (case-insensitive).
 *
 * @param {string} token command name or alias as typed.
 * @returns {CommandDefinition|null} the matching command, or null.
 */
export function findCommand(token)
{
	if (typeof token !== 'string' || token.length === 0)
	{
		return null;
	}

	const lowered = token.toLowerCase();
	for (const command of COMMANDS)
	{
		if (command.name.toLowerCase() === lowered || command.aliases.some((alias) => alias.toLowerCase() === lowered))
		{
			return command;
		}
	}

	return null;
}

/**
 * Escape a string for use inside a regular expression.
 *
 * @param {string} text raw text.
 * @returns {string} text with every metacharacter backslash-escaped.
 */
function escapeRegExp(text)
{
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive whole-word pattern for every known trigger.
 *
 * Longest triggers come first so overlapping aliases prefer the longest
 * match. Word edges are Unicode-aware: a trigger counts only when neither
 * neighbour is a letter, a number, or an underscore.
 *
 * @returns {RegExp} pattern with two groups: separator, then keyword.
 */
function buildTriggerPattern()
{
	const seen = new Set();
	const triggers = [];
	for (const command of COMMANDS)
	{
		for (const trigger of [command.name, ...command.aliases])
		{
			const lowered = trigger.toLowerCase();
			if (!seen.has(lowered))
			{
				seen.add(lowered);
				triggers.push(trigger);
			}
		}
	}

	if (triggers.length === 0)
	{
		return /(?!)/u;
	}

	triggers.sort((a, b) => b.length - a.length);
	const source = `(^|[^\\p{L}\\p{N}_])(${triggers.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`;
	return new RegExp(source, 'iu');
}

/**
 * Find the first command trigger inside one line.
 *
 * @param {string} line one raw line, newline already stripped.
 * @param {RegExp} [pattern] optional prebuilt {@link buildTriggerPattern} result.
 * @returns {LineTrigger|null} the match, or null when the line holds no trigger.
 */
export function findTrigger(line, pattern = buildTriggerPattern())
{
	if (typeof line !== 'string' || line.length === 0)
	{
		return null;
	}

	const match = pattern.exec(line);
	if (!match)
	{
		return null;
	}

	const command = findCommand(match[2]);
	if (!command)
	{
		return null;
	}

	const trigger =
	{
		command,
		keyword: match[2],
		index: match.index + match[1].length,
	};
	return trigger;
}

/**
 * Parse a message into its valid command lines.
 *
 * Each line is scanned for the first whole-word trigger (`roll`, `ролл`,
 * ...), wherever it sits in the line, so `kok: roll 1d20` counts. Matching
 * is case-insensitive but never fires inside another word (`rolling`,
 * `troll` are ignored). Text before the trigger is dropped; everything
 * after it (trimmed) is the argument. Lines without a trigger are skipped,
 * so one message can carry several commands.
 *
 * @param {string} content raw message text.
 * @returns {ParsedCommand[]} one entry per valid command line, in order.
 */
export function parseCommands(content)
{
	if (typeof content !== 'string' || content.length === 0)
	{
		return [];
	}

	const pattern = buildTriggerPattern();
	const found = [];
	for (const rawLine of content.split('\n'))
	{
		const line = rawLine.replace(/\r$/, '');
		const trigger = findTrigger(line, pattern);
		if (!trigger)
		{
			continue;
		}

		const text = line.slice(trigger.index).trim();
		const argument = text.slice(trigger.keyword.length).trim();
		found.push(
		{
			name: trigger.command.name,
			alias: trigger.keyword.toLowerCase(),
			argument,
			text,
		});
	}

	return found;
}

/**
 * Collect the valid command strings of a message.
 *
 * @param {string} content raw message text.
 * @returns {string[]} trimmed command lines, e.g. `['roll 1d20', 'roll 2d20']`.
 */
export function extractCommands(content)
{
	return parseCommands(content).map((command) => command.text);
}

/**
 * @typedef {object} SkippedCommand
 * @property {string} name canonical command name.
 * @property {string} text the trimmed command string that produced no reply.
 * @property {string} reason why it was skipped.
 */

/**
 * @typedef {object} RenderedMessage
 * @property {string[]} lines reply blocks, one per successful command.
 * @property {SkippedCommand[]} skipped recognised commands with no reply.
 */

/**
 * Run a message's commands and collect the reply blocks.
 *
 * A command that fails with a `DiceError` (a trigger word in ordinary
 * chatter, e.g. `roll call tomorrow`) is skipped, not answered: it lands in
 * `skipped` with the reason, for the caller to log internally. Anything
 * else is a bug and propagates.
 *
 * @param {string} content raw message text.
 * @returns {RenderedMessage} reply blocks plus skips, in message order.
 */
export function renderCommands(content)
{
	const lines = [];
	const skipped = [];
	for (const parsed of parseCommands(content))
	{
		const command = findCommand(parsed.alias);
		if (!command)
		{
			continue;
		}

		try
		{
			lines.push(command.handle(parsed.argument));
		}
		catch (error)
		{
			if (error && error.name === 'DiceError')
			{
				skipped.push({ name: parsed.name, text: parsed.text, reason: error.message });
				continue;
			}

			throw error;
		}
	}

	return { lines, skipped };
}
