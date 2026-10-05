/**
 * Secret channel command.
 *
 * Binds the current channel as the server's secret-roll channel. Secret
 * rolls then answer with a placeholder here while the real result is
 * delivered to the bound channel.
 */

import { DiceError } from '../dice.js';
import { macroStore } from '../macrostore.js';

/**
 * Bind the current channel for secret rolls.
 *
 * @param {string} _argument everything after the trigger keyword, ignored.
 * @param {object} [context] command context.
 * @param {string|null} [context.guildId] server id, or null in DMs.
 * @param {string|null} [context.channelId] current channel id.
 * @param {import('../macrostore.js').MacroStore} [context.macros] macro store.
 * @returns {string} confirmation line.
 */
function handleSecret(_argument, context = {})
{
	const guildId = context.guildId ?? null;
	const channelId = context.channelId ?? null;
	if (!guildId || !channelId)
	{
		throw new DiceError('Secret channels need a server channel');
	}

	const store = context.macros ?? macroStore;
	store.setSecretChannel(guildId, channelId);
	return '✅ secret channel set — secret rolls will land here';
}

/**
 * The `dfsecret` command.
 *
 * @type {import('../commands.js').CommandDefinition}
 */
export const dfsecretCommand =
{
	name: 'dfsecret',
	aliases: ['dfsecret'],
	args: '',
	description: 'Sets this channel as the secret-roll channel for this server.',
	handle: handleSecret,
};
