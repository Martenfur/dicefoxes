/**
 * Roll command.
 *
 * Parses a dice formula out of the argument, expands saved macros, rolls
 * every die through the shared randomness module, and answers with the
 * total plus the annotated formula.
 */

import { rollFormula } from '../dice.js';
import { expandMacros } from './macro.js';
import { macroStore } from '../macrostore.js';

/**
 * Roll a dice formula.
 *
 * @param {string} argument everything after the trigger keyword, trimmed.
 * @param {object} [context] command context.
 * @param {string|null} [context.userId] author id for character-prefix lookup.
 * @param {import('../macrostore.js').MacroStore} [context.macros] macro store.
 * @returns {string} reply block: total plus annotated formula.
 * @throws {import('../dice.js').DiceError} on a bad formula; the caller
 *   skips it silently and logs the reason instead of answering.
 */
function handleRoll(argument, context = {})
{
	if (!argument)
	{
		return '❌ roll what? Try: roll 2d6 + 3';
	}

	const store = context.macros ?? macroStore;
	const result = rollFormula(expandMacros(argument, store, context.userId ?? null));
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
