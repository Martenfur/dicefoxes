/**
 * Roll command.
 *
 * Echo stage: returns the dice argument untouched so the parser and the
 * Discord wiring can be exercised end to end. Real dice resolution will
 * replace the body of {@link handleRoll} later.
 */

/**
 * Echo a dice expression back as a reply line.
 *
 * @param {string} argument everything after the trigger keyword, trimmed.
 * @returns {string} one reply line.
 */
function handleRoll(argument)
{
	return argument ? `Rolled ${argument}` : 'Rolled';
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
	handle: handleRoll,
};
