/**
 * Roll command.
 *
 * Parses a dice formula out of the argument, rolls every die through the
 * shared randomness module, and answers with the total plus the annotated
 * formula.
 */

import { rollFormula } from '../dice.js';

/**
 * Roll a dice formula.
 *
 * @param {string} argument everything after the trigger keyword, trimmed.
 * @returns {string} reply block: total plus annotated formula.
 * @throws {import('../dice.js').DiceError} on a bad formula; the caller
 *   skips it silently and logs the reason instead of answering.
 */
function handleRoll(argument)
{
	if (!argument)
	{
		return '❌ roll what? Try: roll 2d6 + 3';
	}

	const result = rollFormula(argument);
	const head = result.degree === null
		? `**${result.total}**`
		: `**${result.total}** ${result.degree.emoji}`;
	const tail = result.dc === null ? result.annotated : `${result.annotated} vs DC ${result.dc}`;
	return `${head}\n-# ${tail}`;
}

/**
 * The `roll` command, with the `ролл` alias.
 *
 * @type {import('../commands.js').CommandDefinition}
 */
export const rollCommand =
{
	name: 'roll',
	aliases: ['roll', 'ролл'],
	args: '<formula>',
	description: 'Rolls dice. Example: `roll 1d20 + 2 DC15`.',
	handle: handleRoll,
};
