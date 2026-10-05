/**
 * Help command.
 *
 * Renders every registered command in the `# DICEFOXES HELP` format.
 */

// Circular import back into the registry: safe because COMMANDS is only
// read when the command runs, long after both modules have loaded.
import { COMMANDS } from '../commands.js';

/**
 * List all commands with short descriptions.
 *
 * The listing is built from the registry, so new commands appear here as
 * soon as they are registered — no per-command edits needed. A command
 * with subcommands lists those instead of its own line.
 *
 * @param {string} _argument everything after the trigger keyword, ignored.
 * @returns {string} reply block with one entry per command and subcommand.
 */
function handleHelp(_argument)
{
	const lines = ['# DICEFOXES HELP'];
	for (const command of COMMANDS)
	{
		if (command.subcommands?.length)
		{
			for (const sub of command.subcommands)
			{
				lines.push(`- ${sub.syntax}:`);
				lines.push(`    ${sub.description}`);
			}
			continue;
		}

		const names = [command.name];
		for (const alias of command.aliases)
		{
			if (alias.toLowerCase() !== command.name.toLowerCase())
			{
				names.push(alias);
			}
		}

		const usage = command.args ? ` ${command.args}` : '';
		lines.push(`- ${names.join('/')}${usage}:`);
		lines.push(`    ${command.description}`);
	}

	return lines.join('\n');
}

/**
 * The `dfhelp` command.
 *
 * @type {import('../commands.js').CommandDefinition}
 */
export const dfhelpCommand =
{
	name: 'dfhelp',
	aliases: ['dfhelp'],
	args: '',
	description: 'Lists all available commands.',
	handle: handleHelp,
};
